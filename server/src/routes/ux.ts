import { Router } from 'express';
import type { DB } from '../db';
import { appScope, scope, canSee } from '../auth';
import { h, qs, intParam } from '../http';
import { notFound, forbidden } from '../util';
import { DOC_NAMES, docName, docCode } from '../docnames';
import { APP_QUERY_LIMIT, applicationQuery } from './applications';

// Global search: applications, obligations and documents, always inside the caller's own data scope.
export function searchRouter(db: DB) {
  const r = Router();
  r.get('/', h((req, res) => {
    const user = req.user!, q = (qs(req.query.q) ?? '').slice(0, 80);
    if (q.length < 2) return res.json({ q, applications: [], documents: [], obligations: [] });
    const like = `%${q.replace(/[%_]/g, '')}%`;
    const apps = applicationQuery(db, user, { q }, { sort: 'updated', order: 'desc', limit: APP_QUERY_LIMIT, offset: 0 }).rows
      .map((a: any) => ({ id: a.id, ref: a.ref, title: a.title, institution: a.institution_name, stage: a.current_stage, status: a.status, link: `/applications/${a.id}` }));
    const D = scope(user, 'd'); const types = Object.entries(DOC_NAMES).filter(([k, v]) => v.toLowerCase().includes(q.toLowerCase()) || k.toLowerCase().includes(q.toLowerCase())).map(([k]) => k);
    const docs = (db.prepare(`SELECT d.id, d.doc_type, d.reference_no, d.file_name, d.application_id, i.name AS institution, a.ref FROM documents d JOIN institutions i ON i.id=d.institution_id LEFT JOIN applications a ON a.id=d.application_id
      WHERE ${D.sql} AND d.is_current=1 AND (a.id IS NULL OR a.status<>'draft' OR ?='institution') AND (d.reference_no LIKE ? OR d.file_name LIKE ? OR d.doc_type IN (${types.map(() => '?').join(',') || "''"}) OR ('DOC-' || substr('0000' || d.id, -4) LIKE ?))
      ORDER BY d.uploaded_at DESC LIMIT ${APP_QUERY_LIMIT}`).all(...D.params, user.role, like, like, ...types, like) as any[])
      .map(d => ({ id: d.id, name: docName(d.doc_type), code: docCode(d.id), institution: d.institution, application_ref: d.ref, link: d.application_id ? `/applications/${d.application_id}` : '/documents' }));
    const U = scope(user, 'u');
    const obligations = (db.prepare(`SELECT u.id, u.code, u.condition_text, u.status, i.name AS institution FROM undertakings u JOIN institutions i ON i.id=u.institution_id WHERE ${U.sql} AND (u.code LIKE ? OR u.condition_text LIKE ?) ORDER BY u.due_date LIMIT ${APP_QUERY_LIMIT}`).all(...U.params, like, like) as any[])
      .map(u => ({ id: u.id, code: u.code, title: u.condition_text, institution: u.institution, status: u.status, link: '/compliance' }));
    res.json({ q, applications: apps, documents: docs, obligations });
  }));
  return r;
}

// Per-case audit history and the caller's own notifications about the case.
export function caseExtrasRouter(db: DB) {
  const r = Router();
  const load = (req: any) => { const a = db.prepare('SELECT * FROM applications WHERE id=?').get(intParam(req.params.id)) as any; if (!a || !canSee(req.user, a)) throw notFound('Application not found'); return a; };
  r.get('/:id/audit', h((req, res) => {
    const a = load(req); if (req.user!.role === 'institution') throw forbidden('The audit history is available to officers and administrators');
    const docs = (db.prepare('SELECT id FROM documents WHERE application_id=?').all(a.id) as any[]).map(d => String(d.id));
    const unds = (db.prepare('SELECT id FROM undertakings WHERE application_id=?').all(a.id) as any[]).map(d => String(d.id));
    const evcs = (db.prepare('SELECT id FROM evc_schedules WHERE application_id=?').all(a.id) as any[]).map(d => String(d.id));
    const defs = (db.prepare('SELECT id FROM deficiencies WHERE application_id=?').all(a.id) as any[]).map(d => String(d.id));
    const ph = (xs: string[]) => xs.map(() => '?').join(',') || "''";
    const rows = db.prepare(`SELECT id, at, actor_label, event_type, entity_type, entity_id, prev_state, new_state, reason FROM audit_log
      WHERE (entity_type='application' AND entity_id=?) OR (entity_type='document' AND entity_id IN (${ph(docs)})) OR (entity_type='undertaking' AND entity_id IN (${ph(unds)})) OR (entity_type='evc' AND entity_id IN (${ph(evcs)})) OR (entity_type='deficiency' AND entity_id IN (${ph(defs)}))
      ORDER BY id DESC LIMIT 200`).all(String(a.id), ...docs, ...unds, ...evcs, ...defs);
    res.json({ rows, note: 'Newest first. Entries cannot be edited or deleted through the application.' });
  }));
  r.get('/:id/notifications', h((req, res) => {
    const a = load(req);
    res.json(db.prepare(`SELECT id, event, title, body, link, created_at, read_at, ack_required, acked_at FROM notifications WHERE user_id=? AND (link=? OR (entity_type='task' AND entity_id IN (SELECT id FROM tasks WHERE application_id=?))) ORDER BY id DESC LIMIT 50`).all(req.user!.id, `/applications/${a.id}`, a.id));
  }));
  return r;
}
