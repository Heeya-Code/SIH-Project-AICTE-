import { Router } from 'express';
import fs from 'node:fs';
import multer from 'multer';
import { z } from 'zod';
import type { DB } from '../db';
import { config } from '../config';
import { scope, canSee, requireRole, type User } from '../auth';
import { h, parse, paging, paged, intParam, qs } from '../http';
import { clock } from '../clock';
import { actorOf, audit } from '../audit';
import { addCalendarDays, daysBetween, forbidden, getNumberSetting, notFound, conflict } from '../util';
import { saveUpload, storedPath } from '../files';
import { addDocument, verifyDocument } from '../documents';
import { createUndertaking, effectiveStatus, reviewUndertaking, submitEvidence } from '../compliance';
import { completeEvc, evcState, rescheduleEvc, scheduleEvc, suggestSlots } from '../evc';
import { stripStorage } from './applications';
import { notifyRole } from '../notify';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: config.maxUploadBytes, files: 1 } });
const optInt = z.preprocess(v => (v === '' || v == null ? undefined : Number(v)), z.number().int().positive().optional());
const optStr = z.preprocess(v => (v === '' || v == null ? undefined : v), z.string().max(200).optional());
const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');

function sendFile(res: any, file: { file_name: string; storage_ref: string; mime: string }) {
  const p = storedPath(file.storage_ref);
  if (!fs.existsSync(p)) throw notFound('The stored file is no longer available');
  res.setHeader('Content-Type', file.mime);
  res.setHeader('Content-Disposition', `attachment; filename="${file.file_name.replace(/"/g, '')}"`);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'private, no-store');
  fs.createReadStream(p).pipe(res);
}

// ---------------------------------------------------------------- documents
export function documentsRouter(db: DB) {
  const r = Router();
  r.get('/', h((req, res) => {
    const user = req.user!, p = paging(req), s = scope(user, 'd'), today = clock.today();
    const where = [s.sql], params: any[] = [...s.params];
    if (req.query.all !== '1') where.push('d.is_current=1');
    if (qs(req.query.doc_type)) { where.push('d.doc_type=?'); params.push(req.query.doc_type); }
    if (qs(req.query.institution_id)) { where.push('d.institution_id=?'); params.push(Number(req.query.institution_id)); }
    if (qs(req.query.region_id)) { where.push('d.region_id=?'); params.push(Number(req.query.region_id)); }
    if (qs(req.query.application_id)) { where.push('d.application_id=?'); params.push(Number(req.query.application_id)); }
    if (qs(req.query.verification)) { where.push('d.verification_status=?'); params.push(req.query.verification); }
    const queue = qs(req.query.queue) === '1';
    if (queue) where.push(`d.is_current=1 AND d.verification_status='pending' AND (a.id IS NULL OR a.status IN ('in_progress','returned'))`);
    const w = qs(req.query.expiry);
    if (w === 'expired') { where.push('d.expiry_date < ?'); params.push(today); }
    else if (w === 'no_expiry') where.push('d.expiry_date IS NULL');
    else if (w && /^\d+$/.test(w)) { where.push('d.expiry_date BETWEEN ? AND ?'); params.push(today, addCalendarDays(today, Number(w))); }
    const base = `FROM documents d JOIN institutions i ON i.id=d.institution_id JOIN regions rg ON rg.id=d.region_id LEFT JOIN applications a ON a.id=d.application_id WHERE ${where.join(' AND ')}`;
    const total = (db.prepare(`SELECT COUNT(*) c ${base}`).get(...params) as any).c;
    const rows = (db.prepare(`SELECT d.*, i.name AS institution_name, rg.name AS region_name, a.ref AS application_ref, a.status AS app_status ${base}
      ORDER BY ${queue ? 'd.uploaded_at ASC, d.id' : 'CASE WHEN d.expiry_date IS NULL THEN 1 ELSE 0 END, d.expiry_date, d.id DESC'} LIMIT ? OFFSET ?`).all(...params, p.pageSize, p.offset) as any[])
      .map(d => {
        const left = d.expiry_date ? daysBetween(today, d.expiry_date) : null;
        const maxWin = 30;
        return { ...stripStorage(d), waiting_days: daysBetween(d.uploaded_at.slice(0, 10), today), app_status: d.app_status, days_to_expiry: left, expiry_state: left === null ? 'no_expiry' : left < 0 ? 'expired' : left <= maxWin ? 'expiring_soon' : 'valid' };
      });
    res.json(paged(rows, total, p));
  }));

  // Documents waiting for a reviewer: current versions, pending verification, on submitted (not draft) applications. Oldest first.
  r.get('/queue-summary', requireRole('regional_officer', 'bureau_officer'), h((req, res) => {
    const s = scope(req.user!, 'd'), today = clock.today();
    const base = `FROM documents d LEFT JOIN applications a ON a.id=d.application_id WHERE ${s.sql} AND d.is_current=1 AND d.verification_status='pending' AND (a.id IS NULL OR a.status IN ('in_progress','returned'))`;
    const c = (extra: string, ...p: any[]) => (db.prepare(`SELECT COUNT(*) c ${base} ${extra}`).get(...s.params, ...p) as any).c as number;
    res.json({ pending: c(''), waiting_over_7_days: c(`AND substr(d.uploaded_at,1,10) <= ?`, addCalendarDays(today, -7)), expiring_within_30_days: c(`AND d.expiry_date BETWEEN ? AND ?`, today, addCalendarDays(today, 30)), already_expired: c(`AND d.expiry_date < ?`, today),
      returned_awaiting_institution: (db.prepare(`SELECT COUNT(*) c FROM documents d WHERE ${s.sql} AND d.is_current=1 AND d.verification_status='returned'`).get(...s.params) as any).c as number });
  }));

  r.post('/', requireRole('institution'), upload.single('file'), h((req, res) => {
    const b = parse(z.object({ application_id: optInt, undertaking_id: optInt, renew_of: optInt, doc_type: optStr, reference_no: optStr, issue_date: z.preprocess(v => v || undefined, dateStr.optional()), expiry_date: z.preprocess(v => v || undefined, dateStr.optional()) }), req.body);
    const id = addDocument(db, req.user!, b, saveUpload(req.file));
    res.status(201).json({ id });
  }));

  const load = (user: User, id: number) => {
    const d = db.prepare('SELECT * FROM documents WHERE id=?').get(id) as any;
    if (!d || !canSee(user, d)) throw notFound('Document not found');
    return d;
  };
  r.get('/:id/versions', h((req, res) => {
    const d = load(req.user!, intParam(req.params.id));
    res.json((db.prepare('SELECT d.*, u.name AS uploaded_by_name FROM documents d LEFT JOIN users u ON u.id=d.uploaded_by WHERE d.lineage_id=? ORDER BY d.version DESC').all(d.lineage_id ?? d.id) as any[]).map(stripStorage));
  }));
  r.get('/:id/download', h((req, res) => {
    const d = load(req.user!, intParam(req.params.id));
    audit(db, { actor: actorOf(req.user!), type: 'document.downloaded', entity: 'document', entityId: d.id });
    sendFile(res, d);
  }));
  r.post('/:id/verify', h((req, res) => {
    const b = parse(z.object({ decision: z.enum(['verified', 'returned']), note: z.string().max(1000).optional() }), req.body);
    verifyDocument(db, req.user!, intParam(req.params.id), b.decision, b.note);
    res.json({ ok: true });
  }));
  return r;
}

// ---------------------------------------------------------------- undertakings / compliance
export function undertakingsRouter(db: DB) {
  const r = Router();
  const view = (u: any, today: string) => ({ ...u, effective_status: effectiveStatus(db, u, today), days_to_due: daysBetween(today, u.due_date) });

  r.get('/', h((req, res) => {
    const user = req.user!, p = paging(req), s = scope(user, 'u'), today = clock.today();
    const where = [s.sql], params: any[] = [...s.params];
    for (const k of ['institution_id', 'region_id', 'application_id'] as const) if (qs(req.query[k])) { where.push(`u.${k}=?`); params.push(Number(req.query[k])); }
    const soon = addCalendarDays(today, getNumberSetting(db, 'undertaking_due_soon_days', 14));
    switch (qs(req.query.status)) {
      case 'overdue': where.push(`u.status IN ('pending','returned') AND u.due_date < ?`); params.push(today); break;
      case 'due_soon': where.push(`u.status='pending' AND u.due_date BETWEEN ? AND ?`); params.push(today, soon); break;
      case 'upcoming': where.push(`u.status='pending' AND u.due_date > ?`); params.push(soon); break;
      case 'returned_for_correction': where.push(`u.status='returned' AND u.due_date >= ?`); params.push(today); break;
      case undefined: break;
      default: where.push('u.status=?'); params.push(req.query.status);
    }
    if (qs(req.query.q)) { where.push('(u.code LIKE ? OR u.condition_text LIKE ? OR i.name LIKE ?)'); params.push(...Array(3).fill(`%${req.query.q}%`)); }
    const base = `FROM undertakings u JOIN institutions i ON i.id=u.institution_id JOIN regions rg ON rg.id=u.region_id LEFT JOIN applications a ON a.id=u.application_id WHERE ${where.join(' AND ')}`;
    const total = (db.prepare(`SELECT COUNT(*) c ${base}`).get(...params) as any).c;
    const rows = (db.prepare(`SELECT u.*, i.name AS institution_name, rg.name AS region_name, a.ref AS application_ref ${base} ORDER BY u.due_date, u.id LIMIT ? OFFSET ?`).all(...params, p.pageSize, p.offset) as any[]).map(u => view(u, today));
    res.json(paged(rows, total, p));
  }));

  r.post('/', h((req, res) => {
    const b = parse(z.object({ institution_id: z.number().int(), application_id: z.number().int().nullable().optional(), condition_text: z.string().trim().min(3).max(300),
      description: z.string().trim().min(3).max(1000), required_evidence: z.string().trim().min(3).max(500), due_date: dateStr }), req.body);
    res.status(201).json({ id: createUndertaking(db, req.user!, b) });
  }));

  const load = (user: User, id: number) => {
    const u = db.prepare('SELECT * FROM undertakings WHERE id=?').get(id) as any;
    if (!u || !canSee(user, u)) throw notFound('Obligation not found');
    return u;
  };
  r.get('/:id', h((req, res) => {
    const user = req.user!, u = load(user, intParam(req.params.id)), today = clock.today();
    res.json({
      ...view(u, today),
      submissions: (db.prepare(`SELECT s.id,s.version,s.note,s.file_name,s.size,s.submitted_at,s.review_status,s.review_note,s.reviewed_at, su.name AS submitted_by_name, ru.name AS reviewed_by_name
        FROM compliance_submissions s LEFT JOIN users su ON su.id=s.submitted_by LEFT JOIN users ru ON ru.id=s.reviewed_by WHERE s.undertaking_id=? ORDER BY s.version DESC`).all(u.id)),
      reminders: db.prepare(`SELECT title, MIN(created_at) AS at FROM notifications WHERE entity_type='undertaking' AND entity_id=? AND event IN ('undertaking.deadline_approaching','compliance.overdue') GROUP BY event, title ORDER BY at`).all(u.id),
      escalations: user.role === 'institution' ? [] : db.prepare(`SELECT level, status, reason, triggered_at FROM escalation_events WHERE entity_type='undertaking' AND entity_id=? GROUP BY rule_id ORDER BY triggered_at`).all(u.id),
      audit: db.prepare(`SELECT event_type, actor_label, at, reason FROM audit_log WHERE entity_type='undertaking' AND entity_id=? ORDER BY id`).all(String(u.id)),
    });
  }));
  r.post('/:id/submissions', requireRole('institution'), upload.single('file'), h((req, res) => {
    const note = parse(z.object({ note: z.string().trim().min(3, 'Describe the evidence').max(1000) }), req.body).note;
    const id = intParam(req.params.id); load(req.user!, id);
    res.status(201).json({ version: submitEvidence(db, req.user!, id, note, saveUpload(req.file)) });
  }));
  r.get('/submissions/:sid/download', h((req, res) => {
    const s = db.prepare('SELECT s.*, u.institution_id, u.region_id FROM compliance_submissions s JOIN undertakings u ON u.id=s.undertaking_id WHERE s.id=?').get(intParam(req.params.sid)) as any;
    if (!s || !canSee(req.user!, s) || !s.storage_ref) throw notFound('File not found');
    audit(db, { actor: actorOf(req.user!), type: 'compliance.evidence_downloaded', entity: 'undertaking', entityId: s.undertaking_id });
    sendFile(res, s);
  }));
  r.post('/:id/review', h((req, res) => {
    const b = parse(z.object({ decision: z.enum(['begin_review', 'verify', 'return', 'close']), note: z.string().max(1000).optional() }), req.body);
    res.json({ status: reviewUndertaking(db, req.user!, intParam(req.params.id), b.decision, b.note) });
  }));
  return r;
}

// ---------------------------------------------------------------- EVC
export function evcRouter(db: DB) {
  const r = Router();
  r.get('/committees', h((req, res) => {
    const u = req.user!;
    res.json(db.prepare(`SELECT c.*, r.name AS region_name FROM evc_committees c JOIN regions r ON r.id=c.region_id ${u.role === 'evc_coordinator' || u.role === 'regional_officer' ? 'WHERE c.region_id=?' : ''} ORDER BY c.id`)
      .all(...(u.role === 'evc_coordinator' || u.role === 'regional_officer' ? [u.region_id] : [])));
  }));
  r.get('/', h((req, res) => {
    const user = req.user!, p = paging(req, 50), s = scope(user, 'e'), today = clock.today();
    const where = [s.sql, `a.status <> 'draft'`], params: any[] = [...s.params];
    if (qs(req.query.region_id)) { where.push('e.region_id=?'); params.push(Number(req.query.region_id)); }
    if (qs(req.query.from)) { where.push('e.confirmed_date >= ?'); params.push(req.query.from); }
    if (qs(req.query.to)) { where.push('e.confirmed_date <= ?'); params.push(req.query.to); }
    const st = qs(req.query.status);
    if (st === 'overdue') where.push(`e.status IN ('queued','scheduled','rescheduled') AND ((e.status='queued' AND e.schedule_deadline < '${today}') OR (e.status<>'queued' AND e.confirmed_date < '${today}') OR (e.completion_deadline < '${today}'))`);
    else if (st && ['queued', 'scheduled', 'rescheduled', 'completed'].includes(st)) { where.push('e.status=?'); params.push(st); }
    const base = `FROM evc_schedules e JOIN applications a ON a.id=e.application_id JOIN institutions i ON i.id=e.institution_id JOIN regions rg ON rg.id=e.region_id
      LEFT JOIN evc_committees c ON c.id=e.committee_id WHERE ${where.join(' AND ')}`;
    const total = (db.prepare(`SELECT COUNT(*) c ${base}`).get(...params) as any).c;
    const rows = (db.prepare(`SELECT e.*, a.ref, a.title, a.category_code, i.name AS institution_name, rg.name AS region_name, c.name AS committee_name ${base}
      ORDER BY CASE e.status WHEN 'completed' THEN 1 ELSE 0 END, COALESCE(e.confirmed_date, e.schedule_deadline), e.id LIMIT ? OFFSET ?`).all(...params, p.pageSize, p.offset) as any[])
      .map(e => ({ ...e, ...evcState(e, today), days_to_schedule_deadline: daysBetween(today, e.schedule_deadline) }));
    res.json(paged(rows, total, p));
  }));
  r.get('/:id', h((req, res) => {
    const id = intParam(req.params.id);
    const e = db.prepare('SELECT * FROM evc_schedules WHERE id=?').get(id) as any;
    if (!e || !canSee(req.user!, e)) throw notFound('EVC record not found');
    res.json({ ...e, ...evcState(e), report: db.prepare('SELECT r.outcome, r.summary, r.submitted_at, u.name AS author FROM evc_reports r LEFT JOIN users u ON u.id=r.author_id WHERE r.evc_id=? ORDER BY r.id DESC LIMIT 1').get(id) ?? null, history: db.prepare(`SELECT h.*, u.name AS actor_name, c.name AS committee_name FROM evc_history h LEFT JOIN users u ON u.id=h.actor_id LEFT JOIN evc_committees c ON c.id=h.committee_id WHERE h.evc_id=? ORDER BY h.id`).all(id) });
  }));
  r.get('/:id/suggestions', requireRole('evc_coordinator'), h((req, res) => res.json({ suggestions: suggestSlots(db, req.user!, intParam(req.params.id)), note: 'Suggestions use the synthetic committee schedule. The coordinator confirms the final slot.' })));
  const slot = z.object({ confirmed_date: dateStr, committee_id: z.number().int(), proposed_date: dateStr.nullable().optional(), reason: z.string().max(500).optional() });
  r.post('/:id/schedule', h((req, res) => { scheduleEvc(db, req.user!, intParam(req.params.id), parse(slot, req.body)); res.json({ ok: true }); }));
  r.post('/:id/reschedule', h((req, res) => { rescheduleEvc(db, req.user!, intParam(req.params.id), parse(slot.extend({ reason: z.string().trim().min(3, 'A reason is required').max(500) }), req.body)); res.json({ ok: true }); }));
  r.post('/:id/complete', h((req, res) => res.json(completeEvc(db, req.user!, intParam(req.params.id), parse(z.object({ visit_date: dateStr, notes: z.string().trim().min(3, 'Add visit observations').max(3000), outcome: z.enum(['satisfactory', 'deficiencies_noted']).optional() }), req.body)))));
  return r;
}

// ---------------------------------------------------------------- escalations
export function escalationsRouter(db: DB) {
  const r = Router();
  r.use(requireRole('regional_officer', 'bureau_officer', 'evc_coordinator', 'competent_authority', 'admin'));
  r.get('/', h((req, res) => {
    const user = req.user!, p = paging(req), s = scope(user, 'x');
    const where = [s.sql], params: any[] = [...s.params];
    if (user.role !== 'admin' && qs(req.query.all) !== '1') { where.push('x.recipient_user_id=?'); params.push(user.id); }
    if (qs(req.query.status)) { where.push('x.status=?'); params.push(req.query.status); }
    if (qs(req.query.trigger_type)) { where.push('x.trigger_type=?'); params.push(req.query.trigger_type); }
    const base = `FROM escalation_events x JOIN institutions i ON i.id=x.institution_id JOIN users ru ON ru.id=x.recipient_user_id LEFT JOIN applications a ON a.id=x.application_id WHERE ${where.join(' AND ')}`;
    const total = (db.prepare(`SELECT COUNT(*) c ${base}`).get(...params) as any).c;
    const rows = db.prepare(`SELECT x.*, i.name AS institution_name, ru.name AS recipient_name, ru.role AS recipient_role, a.ref AS application_ref ${base} ORDER BY CASE x.status WHEN 'open' THEN 0 ELSE 1 END, x.triggered_at DESC LIMIT ? OFFSET ?`).all(...params, p.pageSize, p.offset);
    res.json(paged(rows as any[], total, p));
  }));
  r.post('/:id/ack', h((req, res) => {
    const user = req.user!, x = db.prepare('SELECT * FROM escalation_events WHERE id=?').get(intParam(req.params.id)) as any;
    if (!x || !canSee(user, x)) throw notFound('Escalation not found');
    if (x.recipient_user_id !== user.id) throw forbidden('Only the recipient can acknowledge this escalation');
    if (x.status !== 'open') throw conflict(`This escalation is already ${x.status}`);
    db.transaction(() => {
      db.prepare(`UPDATE escalation_events SET status='acknowledged', acked_at=?, acked_by=? WHERE id=?`).run(clock.iso(), user.id, x.id);
      db.prepare(`UPDATE notifications SET acked_at=? WHERE entity_type='escalation' AND entity_id=? AND user_id=?`).run(clock.iso(), x.id, user.id);
      audit(db, { actor: actorOf(user), type: 'escalation.acknowledged', entity: 'escalation', entityId: x.id, prev: { status: 'open' }, next: { status: 'acknowledged' } });
      if (user.role !== 'regional_officer') notifyRole(db, { role: 'regional_officer', regionId: x.region_id }, { event: 'escalation.acknowledged', link: '/escalations', dedupeKey: `esc-ack:${x.id}`, entity: { type: 'escalation', id: x.id } });
    })();
    res.json({ ok: true });
  }));
  return r;
}

// ---------------------------------------------------------------- tasks & notifications
export function tasksRouter(db: DB) {
  const r = Router();
  r.get('/', h((req, res) => {
    const user = req.user!, p = paging(req), s = scope(user, 't'), today = clock.today();
    const where = [s.sql], params: any[] = [...s.params];
    const st = qs(req.query.status) ?? 'open';
    if (st !== 'all') { where.push('t.status=?'); params.push(st); }
    if (qs(req.query.scope) !== 'all' && user.role !== 'admin') { where.push('(t.assigned_user_id=? OR t.role=?)'); params.push(user.id, user.role); }
    if (qs(req.query.overdue) === '1') { where.push('t.due_date < ?'); params.push(today); }
    const base = `FROM tasks t JOIN applications a ON a.id=t.application_id JOIN institutions i ON i.id=t.institution_id LEFT JOIN users u ON u.id=t.assigned_user_id WHERE ${where.join(' AND ')}`;
    const total = (db.prepare(`SELECT COUNT(*) c ${base}`).get(...params) as any).c;
    const rows = (db.prepare(`SELECT t.*, a.ref, i.name AS institution_name, u.name AS assigned_name ${base} ORDER BY t.due_date IS NULL, t.due_date, t.id LIMIT ? OFFSET ?`).all(...params, p.pageSize, p.offset) as any[])
      .map(t => ({ ...t, days_to_due: t.due_date ? daysBetween(today, t.due_date) : null }));
    res.json(paged(rows, total, p));
  }));
  return r;
}

export function notificationsRouter(db: DB) {
  const r = Router();
  r.get('/', h((req, res) => {
    const p = paging(req), where = ['n.user_id=?'], params: any[] = [req.user!.id];
    if (qs(req.query.unread) === '1') where.push('n.read_at IS NULL');
    if (qs(req.query.pending_ack) === '1') where.push('n.ack_required=1 AND n.acked_at IS NULL');
    const total = (db.prepare(`SELECT COUNT(*) c FROM notifications n WHERE ${where.join(' AND ')}`).get(...params) as any).c;
    const rows = (db.prepare(`SELECT n.* FROM notifications n WHERE ${where.join(' AND ')} ORDER BY n.id DESC LIMIT ? OFFSET ?`).all(...params, p.pageSize, p.offset) as any[]).map(n => ({
      ...n, deliveries: db.prepare('SELECT channel,status,attempts,last_error FROM notification_deliveries WHERE notification_id=?').all(n.id) }));
    res.json(paged(rows, total, p));
  }));
  r.get('/unread-count', h((req, res) => res.json({
    unread: (db.prepare('SELECT COUNT(*) c FROM notifications WHERE user_id=? AND read_at IS NULL').get(req.user!.id) as any).c,
    pending_ack: (db.prepare('SELECT COUNT(*) c FROM notifications WHERE user_id=? AND ack_required=1 AND acked_at IS NULL').get(req.user!.id) as any).c })));
  r.post('/read-all', h((req, res) => { db.prepare('UPDATE notifications SET read_at=? WHERE user_id=? AND read_at IS NULL').run(clock.iso(), req.user!.id); res.json({ ok: true }); }));
  r.post('/:id/read', h((req, res) => { db.prepare('UPDATE notifications SET read_at=COALESCE(read_at,?) WHERE id=? AND user_id=?').run(clock.iso(), intParam(req.params.id), req.user!.id); res.json({ ok: true }); }));
  r.post('/:id/ack', h((req, res) => {
    const id = intParam(req.params.id);
    const n = db.prepare('SELECT * FROM notifications WHERE id=? AND user_id=?').get(id, req.user!.id) as any;
    if (!n) throw notFound('Notification not found');
    if (!n.ack_required) throw conflict('This notification does not need acknowledgment');
    db.prepare('UPDATE notifications SET acked_at=COALESCE(acked_at,?), read_at=COALESCE(read_at,?) WHERE id=?').run(clock.iso(), clock.iso(), id);
    audit(db, { actor: actorOf(req.user!), type: 'notification.acknowledged', entity: 'notification', entityId: id });
    res.json({ ok: true });
  }));
  return r;
}
