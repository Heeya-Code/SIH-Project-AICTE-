import { Router } from 'express';
import { z } from 'zod';
import type { DB } from '../db';
import { appScope, canSee, requireRole, type User } from '../auth';
import { h, parse, paging, paged, intParam, qs } from '../http';
import { clock } from '../clock';
import { addCalendarDays, notFound, forbidden, getNumberSetting } from '../util';
import { actorOf, audit } from '../audit';
import {
  addObservation, ageInfo, availableActions, createApplication, loadDefinition, performTransition, requiredDocs, submitApplication, updateDraft,
} from '../workflow';
import { effectiveStatus } from '../compliance';
import { evcState } from '../evc';
import { pendencyForecast } from '../insights';
import { docName, docCode, withDocLabels, submissionDocs } from '../docnames';

const SORTS: Record<string, string> = {
  ref: 'a.ref', institution: 'i.name', submitted: 'a.submitted_at', due: 'a.stage_due_date', stage: 'a.current_stage', status: 'a.status', updated: 'a.updated_at', category: 'a.category_code',
};

export function applicationQuery(db: DB, user: User, f: Record<string, any>, opts: { sort?: string; order?: string; limit?: number; offset?: number } = {}) {
  const s = appScope(user, 'a');
  const where = [s.sql]; const params: any[] = [...s.params];
  const today = clock.today();
  if (f.q) { where.push('(a.ref LIKE ? OR i.name LIKE ? OR a.title LIKE ?)'); params.push(`%${f.q}%`, `%${f.q}%`, `%${f.q}%`); }
  if (f.region_id) { where.push('a.region_id = ?'); params.push(Number(f.region_id)); }
  if (f.stage) { where.push('a.current_stage = ?'); params.push(f.stage); }
  if (f.category) { where.push('a.category_code = ?'); params.push(f.category); }
  if (f.status) { where.push('a.status = ?'); params.push(f.status); }
  if (f.institution_id) { where.push('a.institution_id = ?'); params.push(Number(f.institution_id)); }
  if (f.assigned_user_id) { where.push('a.assigned_user_id = ?'); params.push(f.assigned_user_id === 'me' ? user.id : Number(f.assigned_user_id)); }
  if (f.deadline === 'overdue') { where.push(`a.status IN ('in_progress','returned') AND a.stage_due_date < ?`); params.push(today); }
  if (f.deadline === 'due_soon') { where.push(`a.status IN ('in_progress','returned') AND a.stage_due_date BETWEEN ? AND ?`); params.push(today, addCalendarDays(today, 3)); }
  if (f.unassigned === '1') where.push(`a.status = 'in_progress' AND a.assigned_user_id IS NULL`);
  if (f.stalled === '1') { where.push(`a.status = 'in_progress' AND substr(a.stage_entered_at,1,10) <= ?`); params.push(addCalendarDays(today, -getNumberSetting(db, 'stall_days', 21))); }
  if (f.open === '1') where.push(`a.status IN ('in_progress','returned')`);
  if (f.from) { where.push('a.submitted_at >= ?'); params.push(f.from); }
  if (f.to) { where.push('a.submitted_at < ?'); params.push(addCalendarDays(f.to, 1)); }
  const base = `FROM applications a JOIN institutions i ON i.id=a.institution_id JOIN regions r ON r.id=a.region_id
    JOIN application_categories c ON c.code=a.category_code LEFT JOIN users u ON u.id=a.assigned_user_id WHERE ${where.join(' AND ')}`;
  const total = (db.prepare(`SELECT COUNT(*) c ${base}`).get(...params) as any).c;
  const sort = SORTS[opts.sort ?? ''] ?? 'a.updated_at', order = opts.order === 'asc' ? 'ASC' : 'DESC';
  const lim = opts.limit != null ? `LIMIT ${opts.limit} OFFSET ${opts.offset ?? 0}` : '';
  const rows = (db.prepare(`SELECT a.*, i.name AS institution_name, r.name AS region_name, r.code AS region_code, c.name AS category_name, u.name AS assigned_name
    ${base} ORDER BY ${sort} ${order}, a.id DESC ${lim}`).all(...params) as any[]).map(a => ({ ...a, ...ageInfo(db, a, today) }));
  return { rows, total };
}

const createSchema = z.object({ category_code: z.string().min(1), title: z.string().trim().min(5, 'Use at least 5 characters').max(200), summary: z.string().max(2000).optional() });
const transitionSchema = z.object({ action: z.string().min(1), reason: z.string().max(2000).optional(), row_version: z.number().int().optional(), deficiency_category: z.enum(['document', 'infrastructure', 'faculty', 'compliance', 'other']).optional() });

export function applicationsRouter(db: DB) {
  const r = Router();
  const load = (user: User, id: number) => {
    const a = db.prepare('SELECT * FROM applications WHERE id=?').get(id) as any;
    if (!a || !canSee(user, a)) throw notFound('Application not found');
    return a;
  };

  r.get('/', h((req, res) => {
    const p = paging(req);
    const { rows, total } = applicationQuery(db, req.user!, req.query as any, { sort: qs(req.query.sort), order: qs(req.query.order), limit: p.pageSize, offset: p.offset });
    res.json(paged(rows, total, p));
  }));

  r.post('/', requireRole('institution'), h((req, res) => {
    const id = createApplication(db, req.user!, parse(createSchema, req.body));
    res.status(201).json({ id });
  }));

  r.get('/:id', h((req, res) => {
    const user = req.user!, id = intParam(req.params.id);
    const a = load(user, id);
    const full = applicationQuery(db, user, { q: a.ref }, { limit: 1 }).rows[0];
    const inst = user.role === 'institution';
    const def = a.workflow_version_id ? loadDefinition(db, a.workflow_version_id) : null;
    const stage = def?.stages.find(s => s.key === a.current_stage) ?? null;
    const wf = a.workflow_version_id ? db.prepare(`SELECT w.code,w.name,v.version FROM workflow_versions v JOIN workflows w ON w.id=v.workflow_id WHERE v.id=?`).get(a.workflow_version_id) : null;
    const evc = db.prepare(`SELECT e.*, c.name AS committee_name FROM evc_schedules e LEFT JOIN evc_committees c ON c.id=e.committee_id WHERE e.application_id=? ORDER BY e.id DESC`).all(id)
      .map((e: any) => ({ ...e, ...evcState(e) }));
    const today = clock.today();
    res.json({
      application: full, workflow: wf, stage, stages: def?.stages ?? [], row_version: a.row_version,
      available_actions: availableActions(db, user, a),
      required_documents: requiredDocs(db, a),
      documents: db.prepare('SELECT * FROM documents WHERE application_id=? ORDER BY doc_type, version DESC').all(id).map(stripStorage),
      tasks: db.prepare(`SELECT t.*, u.name AS assigned_name FROM tasks t LEFT JOIN users u ON u.id=t.assigned_user_id WHERE t.application_id=? ORDER BY t.id DESC`).all(id),
      evc,
      deficiencies: db.prepare(`SELECT d.*, u.name AS raised_by_name, r.code AS rule_code FROM deficiencies d LEFT JOIN users u ON u.id=d.raised_by LEFT JOIN regulatory_rules r ON r.id=d.rule_id WHERE d.application_id=? ORDER BY d.id DESC`).all(id),
      synthetic: !!a.synthetic,
      deadline_risk: a.status === 'in_progress' && a.stage_due_date ? (pendencyForecast(db, user, id).rows[0] ?? null) : null,
      undertakings: (db.prepare('SELECT * FROM undertakings WHERE application_id=? ORDER BY due_date').all(id) as any[]).map(u => ({ ...u, effective_status: effectiveStatus(db, u, today) })),
      observations: inst ? [] : db.prepare(`SELECT o.*, u.name AS author_name FROM observations o JOIN users u ON u.id=o.author_id WHERE o.application_id=? ORDER BY o.id DESC`).all(id),
      submissions: (db.prepare('SELECT id,version,kind,note,snapshot,submitted_at FROM application_submissions WHERE application_id=? ORDER BY version DESC').all(id) as any[]).map(({ snapshot, ...s }) => ({ ...s, documents: submissionDocs(snapshot) })),
      history: db.prepare('SELECT * FROM stage_history WHERE application_id=? ORDER BY id DESC').all(id),
      can_edit_draft: inst && a.status === 'draft',
    });
  }));

  r.patch('/:id', requireRole('institution'), h((req, res) => {
    updateDraft(db, req.user!, intParam(req.params.id), parse(createSchema.partial().omit({ category_code: true }), req.body));
    res.json({ ok: true });
  }));

  r.post('/:id/submit', requireRole('institution'), h((req, res) => { submitApplication(db, req.user!, intParam(req.params.id)); res.json({ ok: true }); }));

  r.post('/:id/transitions', h((req, res) => {
    const b = parse(transitionSchema, req.body);
    const app = performTransition(db, req.user!, intParam(req.params.id), b.action, { reason: b.reason, rowVersion: b.row_version, correlationId: req.correlationId, deficiencyCategory: b.deficiency_category });
    res.json({ ok: true, stage: app.current_stage, status: app.status, row_version: app.row_version });
  }));

  r.post('/:id/observations', h((req, res) => {
    const id = addObservation(db, req.user!, intParam(req.params.id), parse(z.object({ text: z.string().trim().min(3).max(4000) }), req.body).text);
    res.status(201).json({ id });
  }));

  r.get('/:id/history', h((req, res) => {
    load(req.user!, intParam(req.params.id));
    res.json(db.prepare('SELECT * FROM stage_history WHERE application_id=? ORDER BY id').all(req.params.id));
  }));

  // One chronological view of everything that happened to the application.
  r.get('/:id/timeline', h((req, res) => {
    const user = req.user!, id = intParam(req.params.id), a = load(user, id);
    const inst = user.role === 'institution';
    const ev: { at: string; kind: string; title: string; detail?: string | null; actor?: string | null }[] = [];
    for (const s of db.prepare('SELECT * FROM stage_history WHERE application_id=?').all(id) as any[])
      ev.push({ at: s.at, kind: 'stage', title: s.from_stage ? `${s.action.replace(/_/g, ' ')}: ${s.from_stage} to ${s.to_stage}` : `Submitted to ${s.to_stage}`, detail: s.reason, actor: s.actor_label });
    if (!inst) for (const o of db.prepare('SELECT o.*, u.name FROM observations o JOIN users u ON u.id=o.author_id WHERE application_id=?').all(id) as any[])
      ev.push({ at: o.at, kind: 'observation', title: `Observation recorded at ${o.stage_key}`, detail: o.text, actor: o.name });
    for (const e of db.prepare('SELECT h.*, u.name FROM evc_history h JOIN evc_schedules e ON e.id=h.evc_id LEFT JOIN users u ON u.id=h.actor_id WHERE e.application_id=?').all(id) as any[])
      ev.push({ at: e.at, kind: 'evc', title: `EVC ${e.action}${e.to_date ? ` (${e.to_date})` : ''}`, detail: e.reason, actor: e.name });
    for (const d of db.prepare('SELECT d.*, u.name FROM documents d LEFT JOIN users u ON u.id=d.uploaded_by WHERE d.application_id=?').all(id) as any[])
      ev.push({ at: d.uploaded_at, kind: 'document', title: `${docName(d.doc_type)} (${d.doc_type ? 'DOC-' + String(d.id).padStart(4, '0') : ''}) v${d.version} uploaded`, actor: d.name });
    for (const x of db.prepare('SELECT d.*, u.name AS raised_by_name FROM deficiencies d LEFT JOIN users u ON u.id=d.raised_by WHERE d.application_id=?').all(id) as any[]) {
      ev.push({ at: x.raised_at, kind: 'deficiency', title: `Deficiency raised (${x.category})`, detail: x.description, actor: x.raised_by_name });
      if (x.responded_at) ev.push({ at: x.responded_at, kind: 'deficiency', title: 'Corrective action submitted by the institution', detail: x.corrective_action });
      if (x.closed_at) ev.push({ at: x.closed_at, kind: 'deficiency', title: 'Deficiency closed', detail: 'Accepted by the reviewing officer' });
    }
    for (const v of db.prepare(`SELECT l.at, l.event_type, l.actor_label, l.reason, d.doc_type, d.id FROM audit_log l JOIN documents d ON d.id = CAST(l.entity_id AS INTEGER) WHERE l.entity_type='document' AND d.application_id=? AND l.event_type IN ('document.verified','document.returned','document.renewed')`).all(id) as any[])
      ev.push({ at: v.at, kind: 'verification', title: `${docName(v.doc_type)} (${docCode(v.id)}) ${v.event_type.replace('document.', '')}`, detail: v.reason, actor: v.actor_label });
    for (const u of db.prepare('SELECT * FROM undertakings WHERE application_id=?').all(id) as any[])
      ev.push({ at: u.created_at, kind: 'compliance', title: `Obligation ${u.code} created`, detail: `${u.condition_text}, due ${u.due_date}` });
    for (const n of db.prepare(`SELECT event, entity_id, MIN(title) title, MIN(created_at) at FROM notifications WHERE entity_type='task' AND event LIKE 'task.%' AND entity_id IN (SELECT id FROM tasks WHERE application_id=?) GROUP BY event, entity_id`).all(id) as any[])
      ev.push({ at: n.at, kind: 'reminder', title: n.title });
    if (!inst) for (const x of db.prepare('SELECT * FROM escalation_events WHERE application_id=? GROUP BY rule_id, entity_type, entity_id, dedupe_key').all(id) as any[])
      ev.push({ at: x.triggered_at, kind: 'escalation', title: `Escalation level ${x.level} (${x.status})`, detail: x.reason });
    ev.sort((p, q) => p.at.localeCompare(q.at));
    const seen = new Set<string>();
    res.json(ev.filter(e => { const k = `${e.kind}|${e.title}|${e.at.slice(0, 16)}`; if (seen.has(k)) return false; seen.add(k); return true; }));
  }));

  r.get('/:id/summary', h((req, res) => {
    const a = load(req.user!, intParam(req.params.id));
    const full = applicationQuery(db, req.user!, { q: a.ref }, { limit: 1 }).rows[0];
    const docs = requiredDocs(db, a), missing = docs.filter(d => !d.uploaded).map(d => d.display_name);
    const open = db.prepare(`SELECT title, due_date, role FROM tasks WHERE application_id=? AND status='open'`).all(a.id) as any[];
    const lines = [
      `${full.ref}: ${full.title}`, `Institution: ${full.institution_name} (${full.region_name})`, `Category: ${full.category_name}`,
      `Status: ${full.status.replace('_', ' ')}${full.current_stage ? ` at stage "${full.current_stage}"` : ''}`,
      full.submitted_at ? `Submitted ${full.submitted_at.slice(0, 10)}; age ${full.age_days} day(s); ${full.days_in_stage} day(s) in the current stage` : 'Not yet submitted',
      full.stage_due_date ? `Stage deadline: ${full.stage_due_date} (${full.due_status.replace('_', ' ')})` : 'No stage deadline',
      missing.length ? `Missing required documents: ${missing.join(', ')}` : 'All required documents are on file',
      ...open.map(t => `Open task: ${t.title}, owner ${t.role.replace('_', ' ')}${t.due_date ? `, due ${t.due_date}` : ''}`),
    ];
    audit(db, { actor: actorOf(req.user!), type: 'report.summary_generated', entity: 'application', entityId: a.id });
    res.json({ text: lines.join('\n'), generated_at: clock.iso() });
  }));

  return r;
}

export const stripStorage = (d: any) => { const { storage_ref, ...rest } = d; return withDocLabels(rest); };
void forbidden;

