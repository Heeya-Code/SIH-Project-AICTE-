import type { DB } from './db';
import { clock } from './clock';
import { audit, actorOf } from './audit';
import { notifyRole } from './notify';
import { canSee, type User } from './auth';
import { addCalendarDays, badRequest, conflict, daysBetween, forbidden, getNumberSetting, isDate, notFound, unprocessable } from './util';
import { sweepEscalations } from './escalation';
import type { StoredFile } from './files';
import { originFlag } from './origin';

export type UndertakingState = 'upcoming' | 'due_soon' | 'submitted' | 'under_verification' | 'returned_for_correction' | 'verified' | 'overdue' | 'closed';

// Derived status shown to users. The stored `status` only changes through explicit actions; "overdue", "due soon"
// and "upcoming" are recalculated from the due date every time, so they can never go stale.
export function effectiveStatus(db: DB, u: { status: string; due_date: string }, today = clock.today()): UndertakingState {
  if (u.status === 'verified' || u.status === 'closed' || u.status === 'submitted' || u.status === 'under_verification') return u.status as UndertakingState;
  const d = daysBetween(today, u.due_date);
  if (d < 0) return 'overdue';
  if (u.status === 'returned') return 'returned_for_correction';
  return d <= getNumberSetting(db, 'undertaking_due_soon_days', 14) ? 'due_soon' : 'upcoming';
}

const code = (id: number) => `UT-${clock.today().slice(0, 4)}-${String(id).padStart(5, '0')}`;

function insertUndertaking(db: DB, a: { institution_id: number; region_id: number; application_id: number | null; condition_text: string; description: string; required_evidence: string; due_date: string; created_by: number | null }) {
  const now = clock.iso();
  const id = Number(db.prepare(`INSERT INTO undertakings (code,institution_id,region_id,application_id,condition_text,description,required_evidence,due_date,status,created_by,created_at)
    VALUES (?,?,?,?,?,?,?,?, 'pending', ?, ?)`).run(`TMP-${Math.random()}`, a.institution_id, a.region_id, a.application_id, a.condition_text, a.description, a.required_evidence, a.due_date, a.created_by, now).lastInsertRowid);
  db.prepare('UPDATE undertakings SET code=?, synthetic=? WHERE id=?').run(code(id), originFlag(), id);
  notifyRole(db, { role: 'institution', institutionId: a.institution_id }, {
    event: 'undertaking.created', vars: { code: code(id), condition: a.condition_text, due: a.due_date }, link: '/compliance',
    dedupeKey: `und-created:${id}`, entity: { type: 'undertaking', id },
  });
  return id;
}

// Obligations are created from configured templates when an application is approved.
export function createUndertakingsFromTemplates(db: DB, app: any, _key: number) {
  const tpls = db.prepare('SELECT * FROM undertaking_templates WHERE category_code=?').all(app.category_code) as any[];
  for (const t of tpls) {
    const exists = db.prepare('SELECT 1 FROM undertakings WHERE application_id=? AND condition_text=?').get(app.id, t.condition_text);
    if (exists) continue;
    const id = insertUndertaking(db, { institution_id: app.institution_id, region_id: app.region_id, application_id: app.id, condition_text: t.condition_text,
      description: t.description, required_evidence: t.required_evidence, due_date: addCalendarDays(clock.today(), t.due_after_days), created_by: null });
    audit(db, { actor: { id: null, label: 'system' }, type: 'undertaking.created', entity: 'undertaking', entityId: id, next: { from_template: t.id, application: app.ref } });
  }
}

export function createUndertaking(db: DB, user: User, input: { institution_id: number; application_id?: number | null; condition_text: string; description: string; required_evidence: string; due_date: string }) {
  if (!['regional_officer', 'bureau_officer'].includes(user.role)) throw forbidden('Only regional or bureau officers can record obligations');
  const inst = db.prepare('SELECT * FROM institutions WHERE id=?').get(input.institution_id) as any;
  if (!inst || !canSee(user, { institution_id: inst.id, region_id: inst.region_id })) throw notFound('Institution not found');
  if (!isDate(input.due_date)) throw badRequest('Due date must be a valid date (YYYY-MM-DD)');
  if (input.due_date < clock.today()) throw unprocessable('Due date cannot be in the past');
  if (input.application_id) {
    const app = db.prepare('SELECT institution_id FROM applications WHERE id=?').get(input.application_id) as any;
    if (!app || app.institution_id !== inst.id) throw badRequest('The application does not belong to this institution');
  }
  return db.transaction(() => {
    const id = insertUndertaking(db, { institution_id: inst.id, region_id: inst.region_id, application_id: input.application_id ?? null, condition_text: input.condition_text,
      description: input.description, required_evidence: input.required_evidence, due_date: input.due_date, created_by: user.id });
    audit(db, { actor: actorOf(user), type: 'undertaking.created', entity: 'undertaking', entityId: id, next: { institution_id: inst.id, due_date: input.due_date, condition: input.condition_text } });
    return id;
  })();
}

export function submitEvidence(db: DB, user: User, id: number, note: string, file: StoredFile) {
  return db.transaction(() => {
    const u = db.prepare('SELECT * FROM undertakings WHERE id=?').get(id) as any;
    if (!u || !canSee(user, u)) throw notFound('Obligation not found');
    if (user.role !== 'institution') throw forbidden('Only the institution can submit evidence');
    if (!['pending', 'returned'].includes(u.status)) throw conflict('Evidence cannot be submitted in the current status');
    if (!note?.trim()) throw badRequest('Add a note describing the evidence');
    const v = ((db.prepare('SELECT MAX(version) m FROM compliance_submissions WHERE undertaking_id=?').get(id) as any).m ?? 0) + 1;
    db.prepare(`INSERT INTO compliance_submissions (undertaking_id,version,note,file_name,storage_ref,mime,size,submitted_by,submitted_at) VALUES (?,?,?,?,?,?,?,?,?)`)
      .run(id, v, note.trim(), file.file_name, file.storage_ref, file.mime, file.size, user.id, clock.iso());
    db.prepare(`UPDATE undertakings SET status='submitted' WHERE id=?`).run(id);
    audit(db, { actor: actorOf(user), type: 'compliance.evidence_submitted', entity: 'undertaking', entityId: id, prev: { status: u.status }, next: { status: 'submitted', submission_version: v } });
    notifyRole(db, { role: u.verifier_role, regionId: u.region_id }, { event: 'compliance.submitted', vars: { code: u.code }, link: '/compliance', dedupeKey: `und-sub:${id}:${v}`, entity: { type: 'undertaking', id } });
    sweepEscalations(db, 'Evidence submitted');
    return v;
  })();
}

export function reviewUndertaking(db: DB, user: User, id: number, decision: 'begin_review' | 'verify' | 'return' | 'close', note?: string) {
  return db.transaction(() => {
    const u = db.prepare('SELECT * FROM undertakings WHERE id=?').get(id) as any;
    if (!u || !canSee(user, u)) throw notFound('Obligation not found');
    if (user.role !== u.verifier_role) throw forbidden('Your role is not the assigned verifier for this obligation');
    const latest = db.prepare('SELECT * FROM compliance_submissions WHERE undertaking_id=? ORDER BY version DESC LIMIT 1').get(id) as any;
    const now = clock.iso();
    let next: string;
    if (decision === 'begin_review') {
      if (u.status !== 'submitted') throw conflict('Nothing is waiting for review');
      next = 'under_verification';
    } else if (decision === 'verify') {
      if (!['submitted', 'under_verification'].includes(u.status) || !latest) throw conflict('Evidence must be submitted before it can be verified');
      next = 'verified';
      db.prepare(`UPDATE compliance_submissions SET review_status='verified', reviewed_by=?, reviewed_at=?, review_note=? WHERE id=?`).run(user.id, now, note ?? null, latest.id);
      db.prepare('UPDATE undertakings SET verified_by=?, verified_at=?, observations=? WHERE id=?').run(user.id, now, note ?? null, id);
    } else if (decision === 'return') {
      if (!['submitted', 'under_verification'].includes(u.status) || !latest) throw conflict('Nothing is waiting for review');
      if (!note?.trim()) throw unprocessable('Explain what needs to be corrected');
      next = 'returned';
      db.prepare(`UPDATE compliance_submissions SET review_status='returned', reviewed_by=?, reviewed_at=?, review_note=? WHERE id=?`).run(user.id, now, note, latest.id);
      db.prepare('UPDATE undertakings SET observations=? WHERE id=?').run(note, id);
    } else if (decision === 'close') {
      if (u.status !== 'verified') throw conflict('Only verified obligations can be closed');
      next = 'closed';
    } else throw badRequest('Unknown decision');
    db.prepare('UPDATE undertakings SET status=? WHERE id=?').run(next, id);
    audit(db, { actor: actorOf(user), type: `compliance.${decision}`, entity: 'undertaking', entityId: id, prev: { status: u.status }, next: { status: next }, reason: note });
    if (decision === 'verify' || decision === 'return')
      notifyRole(db, { role: 'institution', institutionId: u.institution_id }, {
        event: decision === 'verify' ? 'compliance.verified' : 'compliance.returned', vars: { code: u.code, note: note ?? '' }, link: '/compliance',
        dedupeKey: `und-${decision}:${id}:${latest?.version}`, ackRequired: decision === 'return', entity: { type: 'undertaking', id },
      });
    sweepEscalations(db, 'Obligation reviewed');
    return next;
  })();
}
