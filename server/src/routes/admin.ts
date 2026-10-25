import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import fs from 'node:fs';
import type { DB } from '../db';
import { migrationStatus } from '../db';
import { config } from '../config';
import { requireRole, roleLabel, type Role } from '../auth';
import { h, parse, paging, paged, intParam, qs } from '../http';
import { ApiError, badRequest, conflict, forbidden, notFound, isDate, addCalendarDays } from '../util';
import { actorOf, audit, verifyAuditChain } from '../audit';
import { clock, atIstMorning } from '../clock';
import { runJobs } from '../jobs';
import { resetDemo } from '../seed';
import { docName, docCode } from '../docnames';
import { originFlag } from '../origin';
import { activateVersion, createVersion, loadDefinition, simulate, validateDefinition, WORKFLOW_ROLES, ROLES } from '../workflow';

const roleEnum = z.enum(ROLES as [Role, ...Role[]]);

export function usersRouter(db: DB) {
  const r = Router();
  r.use(requireRole('admin'));
  r.get('/', h((req, res) => {
    const p = paging(req, 25), where = ['1=1'], params: any[] = [];
    if (qs(req.query.role)) { where.push('u.role=?'); params.push(req.query.role); }
    if (qs(req.query.q)) { where.push('(u.name LIKE ? OR u.email LIKE ?)'); params.push(`%${req.query.q}%`, `%${req.query.q}%`); }
    const total = (db.prepare(`SELECT COUNT(*) c FROM users u WHERE ${where.join(' AND ')}`).get(...params) as any).c;
    const rows = db.prepare(`SELECT u.id,u.email,u.name,u.role,u.region_id,u.institution_id,u.active,u.created_at, rg.name AS region_name, i.name AS institution_name FROM users u LEFT JOIN regions rg ON rg.id=u.region_id LEFT JOIN institutions i ON i.id=u.institution_id WHERE ${where.join(' AND ')} ORDER BY u.id LIMIT ? OFFSET ?`).all(...params, p.pageSize, p.offset);
    res.json(paged(rows as any[], total, p));
  }));
  const shape = z.object({ email: z.string().email().max(200), name: z.string().trim().min(2).max(120), role: roleEnum, region_id: z.number().int().nullable().optional(), institution_id: z.number().int().nullable().optional(),
    password: z.string().min(10, 'Use at least 10 characters').max(100) });
  const checkScope = (b: { role: Role; region_id?: number | null; institution_id?: number | null }) => {
    if (['regional_officer', 'evc_coordinator'].includes(b.role) && !b.region_id) throw badRequest('Regional officers and EVC coordinators need a Region');
    if (b.role === 'institution' && !b.institution_id) throw badRequest('Institution representatives need an institution');
  };
  r.post('/', h((req, res) => {
    const b = parse(shape, req.body); checkScope(b);
    if (db.prepare('SELECT 1 FROM users WHERE email=?').get(b.email.toLowerCase())) throw conflict('A user with this email already exists');
    const id = Number(db.prepare(`INSERT INTO users (email,name,password_hash,role,region_id,institution_id,active,created_at) VALUES (?,?,?,?,?,?,1,?)`)
      .run(b.email.toLowerCase(), b.name, bcrypt.hashSync(b.password, 10), b.role, b.region_id ?? null, b.institution_id ?? null, clock.iso()).lastInsertRowid);
    db.prepare('UPDATE users SET synthetic=? WHERE id=?').run(originFlag(), id);
    audit(db, { actor: actorOf(req.user!), type: 'user.created', entity: 'user', entityId: id, next: { email: b.email, role: b.role, region_id: b.region_id ?? null, institution_id: b.institution_id ?? null } });
    res.status(201).json({ id });
  }));
  r.patch('/:id', h((req, res) => {
    const id = intParam(req.params.id), cur = db.prepare('SELECT * FROM users WHERE id=?').get(id) as any;
    if (!cur) throw notFound('User not found');
    const b = parse(shape.partial().omit({ email: true }).extend({ active: z.boolean().optional() }), req.body);
    const next = { role: b.role ?? cur.role, region_id: b.region_id === undefined ? cur.region_id : b.region_id, institution_id: b.institution_id === undefined ? cur.institution_id : b.institution_id };
    checkScope(next);
    if (id === req.user!.id && (b.active === false || (b.role && b.role !== 'admin'))) throw forbidden('You cannot remove your own administrator access');
    if ((b.active === false || (b.role && b.role !== 'admin')) && cur.role === 'admin' && (db.prepare(`SELECT COUNT(*) c FROM users WHERE role='admin' AND active=1`).get() as any).c <= 1) throw conflict('At least one active administrator is required');
    db.prepare('UPDATE users SET name=COALESCE(?,name), role=?, region_id=?, institution_id=?, active=COALESCE(?,active), password_hash=COALESCE(?,password_hash) WHERE id=?')
      .run(b.name ?? null, next.role, next.region_id, next.institution_id, b.active === undefined ? null : b.active ? 1 : 0, b.password ? bcrypt.hashSync(b.password, 10) : null, id);
    audit(db, { actor: actorOf(req.user!), type: cur.role !== next.role ? 'user.role_changed' : 'user.updated', entity: 'user', entityId: id,
      prev: { role: cur.role, region_id: cur.region_id, institution_id: cur.institution_id, active: !!cur.active }, next: { ...next, active: b.active ?? !!cur.active, password_changed: !!b.password } });
    res.json({ ok: true });
  }));
  return r;
}

export function adminRouter(db: DB, scheduler: { everySeconds: number }) {
  const r = Router();
  r.use(requireRole('admin'));
  // --- settings
  r.get('/settings', h((_req, res) => res.json(db.prepare('SELECT key,value,description FROM settings ORDER BY key').all())));
  r.put('/settings/:key', h((req, res) => {
    const key = String(req.params.key), cur = db.prepare('SELECT * FROM settings WHERE key=?').get(key) as any;
    if (!cur || key.startsWith('sim_')) throw notFound('Unknown setting');
    const value = parse(z.object({ value: z.string().max(200) }), req.body).value.trim();
    if (key.startsWith('reminder_days_')) {
      let arr: any; try { arr = JSON.parse(value); } catch { throw badRequest('Use a JSON list of days, for example [30,7,1]'); }
      if (!Array.isArray(arr) || !arr.length || arr.some((n: any) => !Number.isInteger(n) || n < 0 || n > 365)) throw badRequest('Use whole numbers between 0 and 365, for example [30,7,1]');
    } else if (!/^\d{1,3}$/.test(value)) throw badRequest('Use a whole number');
    db.prepare('UPDATE settings SET value=? WHERE key=?').run(value, key);
    audit(db, { actor: actorOf(req.user!), type: 'config.setting_changed', entity: 'setting', entityId: key, prev: cur.value, next: value });
    res.json({ ok: true });
  }));
  // --- escalation rules
  r.get('/escalation-rules', h((_req, res) => res.json(db.prepare('SELECT * FROM escalation_rules ORDER BY trigger_type, applies_to_role, level').all())));
  const ruleSchema = z.object({ name: z.string().trim().min(3).max(120), trigger_type: z.enum(['task_overdue', 'evc_overdue', 'undertaking_overdue', 'document_expired']), applies_to_role: z.enum(WORKFLOW_ROLES as [Role, ...Role[]]).nullable().optional(),
    level: z.number().int().min(1).max(5), after_days: z.number().int().min(0).max(365), recipient_role: z.enum(['regional_officer', 'bureau_officer', 'competent_authority', 'evc_coordinator']),
    repeat_every_days: z.number().int().min(1).max(90).nullable().optional(), max_repeats: z.number().int().min(0).max(10).default(0), active: z.boolean().default(true) });
  const saveRule = (id: number | null, req: any) => {
    const b = parse(ruleSchema, req.body);
    if (b.repeat_every_days && b.max_repeats === 0) throw badRequest('Set a maximum number of repeats when repeating an escalation');
    const vals = [b.name, b.trigger_type, b.applies_to_role ?? null, b.level, b.after_days, b.recipient_role, b.repeat_every_days ?? null, b.max_repeats, b.active ? 1 : 0];
    if (id) { db.prepare('UPDATE escalation_rules SET name=?,trigger_type=?,applies_to_role=?,level=?,after_days=?,recipient_role=?,repeat_every_days=?,max_repeats=?,active=? WHERE id=?').run(...vals, id); }
    else id = Number(db.prepare('INSERT INTO escalation_rules (name,trigger_type,applies_to_role,level,after_days,recipient_role,repeat_every_days,max_repeats,active) VALUES (?,?,?,?,?,?,?,?,?)').run(...vals).lastInsertRowid);
    audit(db, { actor: actorOf(req.user!), type: 'config.escalation_rule_saved', entity: 'escalation_rule', entityId: id, next: b });
    return id;
  };
  r.post('/escalation-rules', h((req, res) => res.status(201).json({ id: saveRule(null, req) })));
  r.put('/escalation-rules/:id', h((req, res) => { const id = intParam(req.params.id); if (!db.prepare('SELECT 1 FROM escalation_rules WHERE id=?').get(id)) throw notFound('Rule not found'); saveRule(id, req); res.json({ ok: true }); }));
  // --- document requirements
  r.get('/document-requirements', h((_req, res) => res.json(db.prepare('SELECT * FROM document_requirements ORDER BY category_code, doc_type').all())));
  r.put('/document-requirements/:id', h((req, res) => {
    const id = intParam(req.params.id), cur = db.prepare('SELECT * FROM document_requirements WHERE id=?').get(id) as any;
    if (!cur) throw notFound('Document requirement not found');
    const b = parse(z.object({
      reminder_days: z.string().nullable().optional(),
      auto_renewal: z.union([z.boolean(), z.number()]).transform(Boolean).optional(),
    }), req.body);
    let reminderDays = cur.reminder_days;
    if (b.reminder_days !== undefined) {
      if (b.reminder_days === null || b.reminder_days.trim() === '') {
        reminderDays = null;
      } else {
        let arr: any; try { arr = JSON.parse(b.reminder_days); } catch { throw badRequest('Use a JSON list of days, for example [180,90,30]'); }
        if (!Array.isArray(arr) || arr.some((n: any) => !Number.isInteger(n) || n < 0 || n > 365)) throw badRequest('Use whole numbers between 0 and 365');
        reminderDays = b.reminder_days;
      }
    }
    const autoRenewal = b.auto_renewal !== undefined ? (b.auto_renewal ? 1 : 0) : cur.auto_renewal;
    db.prepare('UPDATE document_requirements SET reminder_days=?, auto_renewal=? WHERE id=?').run(reminderDays, autoRenewal, id);
    audit(db, { actor: actorOf(req.user!), type: 'config.document_requirement_updated', entity: 'document_requirement', entityId: id, prev: { reminder_days: cur.reminder_days, auto_renewal: cur.auto_renewal }, next: { reminder_days: reminderDays, auto_renewal: autoRenewal } });
    res.json({ ok: true });
  }));

  // --- notification templates
  r.get('/templates', h((_req, res) => res.json(db.prepare('SELECT * FROM notification_templates ORDER BY event').all())));
  r.put('/templates/:event', h((req, res) => {
    const ev = String(req.params.event), cur = db.prepare('SELECT * FROM notification_templates WHERE event=?').get(ev) as any;
    if (!cur) throw notFound('Template not found');
    const b = parse(z.object({ title_tpl: z.string().trim().min(3).max(200), body_tpl: z.string().trim().min(3).max(1000) }), req.body);
    db.prepare('UPDATE notification_templates SET title_tpl=?, body_tpl=? WHERE event=?').run(b.title_tpl, b.body_tpl, ev);
    audit(db, { actor: actorOf(req.user!), type: 'config.template_changed', entity: 'template', entityId: ev, prev: { title: cur.title_tpl, body: cur.body_tpl }, next: b });
    res.json({ ok: true });
  }));
  // --- jobs, clock, demo tools
  r.get('/jobs', h((_req, res) => res.json(db.prepare('SELECT * FROM job_runs ORDER BY id DESC LIMIT 30').all())));
  r.post('/jobs/run', h(async (_req, res) => res.json(await runJobs(db, 'manual'))));
  const demoOnly = () => { if (!config.demoTools) throw forbidden('Demo tools are disabled on this server'); };
  r.post('/clock', h((req, res) => {
    demoOnly();
    const b = parse(z.object({ date: z.string().nullable().optional(), advance_days: z.number().int().min(-3650).max(3650).optional() }), req.body);
    let target: string | null;
    if (b.advance_days !== undefined) target = addCalendarDays(clock.today(), b.advance_days);
    else if (b.date) { if (!isDate(b.date)) throw badRequest('Use YYYY-MM-DD'); target = b.date; } else target = null;
    clock.set(target ? atIstMorning(target) : null);
    db.prepare(`INSERT INTO settings (key,value,description) VALUES ('sim_clock',?, 'Simulated date (demo tool)') ON CONFLICT(key) DO UPDATE SET value=excluded.value`).run(target ?? '');
    audit(db, { actor: actorOf(req.user!), type: 'system.clock_changed', entity: 'system', entityId: 'clock', next: { simulated_date: target } });
    res.json({ today: clock.today(), simulated: clock.isPinned() });
  }));
  r.post('/demo/reset', h(async (req, res) => {
    demoOnly();
    if (req.body?.confirm !== 'RESET') throw badRequest('Send {"confirm":"RESET"} to wipe and re-seed the demo data');
    await resetDemo(db);
    fs.rmSync(config.storageDir, { recursive: true, force: true });
    res.json({ ok: true });
  }));
  r.get('/system', h((_req, res) => {
    const c = (t: string) => (db.prepare(`SELECT COUNT(*) c FROM ${t}`).get() as any).c;
    res.json({ node: process.version, environment: config.nodeEnv, demo_tools: config.demoTools, scheduler_interval_seconds: scheduler.everySeconds, email_adapter: 'simulated-email (no real mail is sent)',
      migrations: migrationStatus(db), counts: { users: c('users'), applications: c('applications'), tasks: c('tasks'), notifications: c('notifications'), audit_events: c('audit_log'), documents: c('documents') },
      audit_chain: verifyAuditChain(db), clock: { today: clock.today(), simulated: clock.isPinned() }, last_job: db.prepare('SELECT * FROM job_runs ORDER BY id DESC LIMIT 1').get() });
  }));
  return r;
}

// ---------------------------------------------------------------- audit trail
export function auditRouter(db: DB) {
  const r = Router();
  r.use(requireRole('admin', 'bureau_officer', 'competent_authority'));
  r.get('/', h((req, res) => {
    const p = paging(req, 30), where = ['1=1'], params: any[] = [];
    for (const [k, col] of [['event_type', 'event_type'], ['entity_type', 'entity_type'], ['entity_id', 'entity_id']] as const) if (qs(req.query[k])) { where.push(`${col}=?`); params.push(req.query[k]); }
    if (qs(req.query.actor)) { where.push('actor_label LIKE ?'); params.push(`%${req.query.actor}%`); }
    if (qs(req.query.q)) { where.push('(event_type LIKE ? OR reason LIKE ? OR new_state LIKE ?)'); params.push(...Array(3).fill(`%${req.query.q}%`)); }
    if (qs(req.query.from)) { where.push('at >= ?'); params.push(req.query.from); }
    if (qs(req.query.to)) { where.push('at < ?'); params.push(addCalendarDays(String(req.query.to), 1)); }
    const total = (db.prepare(`SELECT COUNT(*) c FROM audit_log WHERE ${where.join(' AND ')}`).get(...params) as any).c;
    const rows = db.prepare(`SELECT id,event_id,actor_label,event_type,entity_type,entity_id,prev_state,new_state,reason,correlation_id,at FROM audit_log WHERE ${where.join(' AND ')} ORDER BY id DESC LIMIT ? OFFSET ?`).all(...params, p.pageSize, p.offset);
    const label = (r: any) => {
      if (r.entity_type === 'document') { const d = db.prepare('SELECT doc_type FROM documents WHERE id=?').get(Number(r.entity_id)) as any; return d ? `${docName(d.doc_type)} (${docCode(r.entity_id)})` : `Document ${docCode(r.entity_id)}`; }
      if (r.entity_type === 'application') return (db.prepare('SELECT ref FROM applications WHERE id=?').get(Number(r.entity_id)) as any)?.ref ?? null;
      if (r.entity_type === 'undertaking') return (db.prepare('SELECT code FROM undertakings WHERE id=?').get(Number(r.entity_id)) as any)?.code ?? null;
      return null;
    };
    res.json(paged((rows as any[]).map(r => ({ ...r, entity_label: label(r) })), total, p));
  }));
  r.get('/event-types', h((_req, res) => res.json((db.prepare('SELECT DISTINCT event_type FROM audit_log ORDER BY event_type').all() as any[]).map(x => x.event_type))));
  r.get('/verify', h((_req, res) => res.json({ ...verifyAuditChain(db), note: 'Detects edits made outside the application. It is tamper-evidence, not absolute immutability.' })));
  return r;
}

// ---------------------------------------------------------------- workflow configuration
const defSchema = z.object({
  stages: z.array(z.object({ key: z.string(), name: z.string(), responsible_role: z.enum(WORKFLOW_ROLES as [Role, ...Role[]]), deadline_days: z.number().int().nullable().optional(), day_mode: z.enum(['calendar', 'working']).default('calendar'),
    is_initial: z.union([z.boolean(), z.number()]).transform(Boolean).default(false), is_terminal: z.union([z.boolean(), z.number()]).transform(Boolean).default(false), terminal_status: z.string().nullable().optional(),
    is_evc: z.union([z.boolean(), z.number()]).transform(Boolean).default(false), evc_schedule_days: z.number().int().nullable().optional(), pos_x: z.number().nullable().optional(), pos_y: z.number().nullable().optional() })).max(40),
  transitions: z.array(z.object({ from_key: z.string(), to_key: z.string(), action: z.string(), label: z.string().nullable().optional(), requires_reason: z.union([z.boolean(), z.number()]).transform(Boolean).default(false),
    auto: z.union([z.boolean(), z.number()]).transform(Boolean).default(false), allowed_role: z.enum(WORKFLOW_ROLES as [Role, ...Role[]]).nullable().optional(), prerequisites: z.array(z.string()).default([]) })).max(120),
});
const norm = (d: z.infer<typeof defSchema>) => ({
  stages: d.stages.map(s => ({ ...s, is_initial: +s.is_initial, is_terminal: +s.is_terminal, is_evc: +s.is_evc, deadline_days: s.deadline_days ?? null, terminal_status: s.terminal_status ?? null, evc_schedule_days: s.evc_schedule_days ?? null })),
  transitions: d.transitions.map(t => ({ ...t, requires_reason: +t.requires_reason, auto: +t.auto, allowed_role: t.allowed_role ?? null })),
}) as any;

export function workflowsRouter(db: DB) {
  const r = Router();
  r.get('/', requireRole('admin', 'bureau_officer'), h((_req, res) => {
    const rows = (db.prepare('SELECT * FROM workflows ORDER BY id').all() as any[]).map(w => ({
      ...w, categories: db.prepare('SELECT code,name FROM application_categories WHERE workflow_id=?').all(w.id),
      versions: db.prepare(`SELECT v.id, v.version, v.active, v.note, v.created_at, (SELECT COUNT(*) FROM applications a WHERE a.workflow_version_id=v.id) AS applications FROM workflow_versions v WHERE v.workflow_id=? ORDER BY v.version DESC`).all(w.id) }));
    res.json(rows);
  }));
  r.get('/versions/:vid', requireRole('admin', 'bureau_officer'), h((req, res) => {
    const vid = intParam(req.params.vid), v = db.prepare('SELECT * FROM workflow_versions WHERE id=?').get(vid) as any;
    if (!v) throw notFound('Version not found');
    const def = loadDefinition(db, vid);
    res.json({ version: v, definition: def, validation: validateDefinition(def), applications_using: (db.prepare('SELECT COUNT(*) c FROM applications WHERE workflow_version_id=?').get(vid) as any).c });
  }));
  r.post('/validate', requireRole('admin'), h((req, res) => res.json(validateDefinition(norm(parse(z.object({ definition: defSchema }), req.body).definition)))));
  r.post('/simulate', requireRole('admin', 'bureau_officer'), h((req, res) => {
    const b = parse(z.object({ definition: defSchema, start_date: z.string().optional(), steps: z.array(z.object({ action: z.string(), after_days: z.number().int().min(0).max(365).optional() })).max(40) }), req.body);
    res.json(simulate(db, norm(b.definition), { start_date: b.start_date && isDate(b.start_date) ? b.start_date : clock.today(), steps: b.steps }));
  }));
  r.post('/:id/versions', requireRole('admin'), h((req, res) => {
    const b = parse(z.object({ definition: defSchema, activate: z.boolean().default(false), note: z.string().max(300).optional() }), req.body);
    res.status(201).json(createVersion(db, req.user!, intParam(req.params.id), norm(b.definition), { activate: b.activate, note: b.note }));
  }));
  r.post('/versions/:vid/activate', requireRole('admin'), h((req, res) => { db.transaction(() => activateVersion(db, req.user!, intParam(req.params.vid)))(); res.json({ ok: true }); }));
  return r;
}
void ApiError; void roleLabel;
