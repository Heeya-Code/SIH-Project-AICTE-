import type { DB } from './db';
import { clock, istDate } from './clock';
import { audit, actorOf, SYSTEM, type Actor } from './audit';
import { notify, notifyRole } from './notify';
import { canSee, type User, type Role } from './auth';
import {
  addDays, badRequest, conflict, daysBetween, forbidden, getDaysSetting, getNumberSetting, notFound, unprocessable, addCalendarDays,
} from './util';
import { sweepEscalations } from './escalation';
import { createUndertakingsFromTemplates } from './compliance';
import { docName } from './docnames';
import { originFlag } from './origin';

export type Stage = {
  key: string; name: string; responsible_role: Role; deadline_days: number | null; day_mode: 'calendar' | 'working';
  is_initial: number; is_terminal: number; terminal_status: string | null; is_evc: number; evc_schedule_days: number | null;
  pos_x?: number | null; pos_y?: number | null;
};
export type Transition = {
  from_key: string; to_key: string; action: string; label?: string | null; requires_reason: number; auto: number;
  allowed_role: Role | null; prerequisites: string[];
};
export type Definition = { stages: Stage[]; transitions: Transition[] };

export const ROLES: Role[] = ['institution', 'regional_officer', 'bureau_officer', 'evc_coordinator', 'competent_authority', 'admin'];
export const WORKFLOW_ROLES: Role[] = ['institution', 'regional_officer', 'bureau_officer', 'evc_coordinator', 'competent_authority'];
export const PREREQUISITES: Record<string, string> = {
  required_docs_present: 'All required documents have been uploaded',
  required_docs_verified: 'All required documents have been verified by an officer',
  observation_recorded: 'At least one observation has been recorded for this stage',
  evc_completed: 'The EVC visit has been recorded as completed',
};

// ---------------------------------------------------------------- definitions
export function loadDefinition(db: DB, versionId: number): Definition {
  const stages = db.prepare('SELECT * FROM workflow_stages WHERE version_id=? ORDER BY id').all(versionId) as any[];
  const transitions = (db.prepare('SELECT * FROM workflow_transitions WHERE version_id=? ORDER BY id').all(versionId) as any[])
    .map(t => ({ ...t, prerequisites: JSON.parse(t.prerequisites || '[]') }));
  return { stages, transitions };
}

export function validateDefinition(def: Definition) {
  const errors: string[] = [], warnings: string[] = [];
  const keys = new Set<string>();
  for (const s of def.stages) {
    if (!/^[a-z][a-z0-9_]*$/.test(s.key ?? '')) errors.push(`Stage key "${s.key}" must be lowercase letters, digits or underscores`);
    if (keys.has(s.key)) errors.push(`Duplicate stage key "${s.key}"`);
    keys.add(s.key);
    if (!s.name?.trim()) errors.push(`Stage "${s.key}" needs a name`);
    if (!WORKFLOW_ROLES.includes(s.responsible_role)) errors.push(`Stage "${s.key}" has an invalid responsible role`);
    if (s.deadline_days != null && (!Number.isInteger(s.deadline_days) || s.deadline_days < 0)) errors.push(`Stage "${s.key}" deadline must be a whole number of days`);
    if (s.is_terminal && s.is_initial) errors.push(`Stage "${s.key}" cannot be both initial and terminal`);
    if (s.is_terminal && !['approved', 'rejected', 'withdrawn'].includes(s.terminal_status ?? '')) errors.push(`Terminal stage "${s.key}" needs an outcome (approved, rejected or withdrawn)`);
  }
  const initial = def.stages.filter(s => s.is_initial);
  if (initial.length !== 1) errors.push(`Exactly one initial stage is required (found ${initial.length})`);
  if (!def.stages.some(s => s.is_terminal)) errors.push('At least one terminal stage is required');
  const seen = new Set<string>();
  for (const t of def.transitions) {
    if (!keys.has(t.from_key)) errors.push(`Transition "${t.action}" starts at unknown stage "${t.from_key}"`);
    if (!keys.has(t.to_key)) errors.push(`Transition "${t.action}" points to unknown stage "${t.to_key}"`);
    if (!/^[a-z][a-z0-9_]*$/.test(t.action ?? '')) errors.push(`Action "${t.action}" must be lowercase letters, digits or underscores`);
    const k = `${t.from_key}|${t.action}`;
    if (seen.has(k)) errors.push(`Stage "${t.from_key}" has two transitions named "${t.action}"`);
    seen.add(k);
    if (t.allowed_role && !WORKFLOW_ROLES.includes(t.allowed_role)) errors.push(`Transition "${t.action}" has an invalid role`);
    for (const p of t.prerequisites ?? []) if (!(p in PREREQUISITES)) errors.push(`Transition "${t.action}" uses unknown prerequisite "${p}"`);
    if (t.auto && t.requires_reason) errors.push(`Automatic transition "${t.action}" cannot require a reason`);
    if (t.auto && !(t.prerequisites?.length)) errors.push(`Automatic transition "${t.action}" needs at least one prerequisite, otherwise it would fire immediately`);
  }
  const byKey = new Map(def.stages.map(s => [s.key, s]));
  const out = new Map<string, Transition[]>();
  for (const t of def.transitions) out.set(t.from_key, [...(out.get(t.from_key) ?? []), t]);
  // Reachability from the initial stage.
  const reach = new Set<string>();
  if (initial.length === 1) {
    const q = [initial[0].key];
    while (q.length) { const k = q.pop()!; if (reach.has(k)) continue; reach.add(k); for (const t of out.get(k) ?? []) q.push(t.to_key); }
  }
  const unreachable = def.stages.filter(s => initial.length === 1 && !reach.has(s.key)).map(s => s.key);
  for (const k of unreachable) errors.push(`Stage "${k}" cannot be reached from the initial stage`);
  for (const s of def.stages) {
    if (!s.is_terminal && !(out.get(s.key)?.length)) errors.push(`Stage "${s.key}" is a dead end: it has no outgoing transition`);
    if (!s.is_terminal && s.responsible_role === 'institution' && !(out.get(s.key) ?? []).some(t => (t.allowed_role ?? s.responsible_role) === 'institution'))
      warnings.push(`Stage "${s.key}" is owned by the institution but has no transition the institution can perform`);
    if (s.is_evc && !(out.get(s.key) ?? []).some(t => t.prerequisites?.includes('evc_completed')))
      warnings.push(`EVC stage "${s.key}" has no transition that requires "EVC visit completed", so it cannot advance after a visit`);
    if (s.is_evc && s.responsible_role !== 'evc_coordinator') warnings.push(`EVC stage "${s.key}" is usually owned by the EVC coordinator role`);
  }
  // Automatic transitions must not form a loop (they would run forever).
  const autoOut = new Map<string, string[]>();
  for (const t of def.transitions) if (t.auto) autoOut.set(t.from_key, [...(autoOut.get(t.from_key) ?? []), t.to_key]);
  const state = new Map<string, number>();
  const dfs = (k: string, path: string[]): string[] | null => {
    state.set(k, 1);
    for (const n of autoOut.get(k) ?? []) {
      if (state.get(n) === 1) return [...path, k, n];
      if (!state.get(n)) { const r = dfs(n, [...path, k]); if (r) return r; }
    }
    state.set(k, 2); return null;
  };
  for (const k of autoOut.keys()) if (!state.get(k)) { const c = dfs(k, []); if (c) { errors.push(`Automatic transitions form a loop: ${c.join(' -> ')}`); break; } }

  // Simple paths initial -> terminal (preview of the routes an application can take).
  const paths: { stages: string[]; actions: string[] }[] = [];
  if (initial.length === 1) {
    const walk = (k: string, st: string[], ac: string[]) => {
      if (paths.length >= 25) return;
      if (byKey.get(k)?.is_terminal) { paths.push({ stages: [...st], actions: [...ac] }); return; }
      for (const t of out.get(k) ?? []) if (!st.includes(t.to_key)) walk(t.to_key, [...st, t.to_key], [...ac, t.action]);
    };
    walk(initial[0].key, [initial[0].key], []);
  }
  return { valid: errors.length === 0, errors, warnings, unreachable, paths };
}

// Dry run on synthetic input: nothing is written to the database.
export function simulate(db: DB, def: Definition, input: { start_date: string; steps: { action: string; after_days?: number }[] }) {
  const v = validateDefinition(def);
  if (!v.valid) return { ok: false, errors: v.errors, timeline: [] as any[] };
  const stageBy = new Map(def.stages.map(s => [s.key, s]));
  let cur = def.stages.find(s => s.is_initial)!;
  let date = input.start_date;
  const rem = getDaysSetting(db, 'reminder_days_task', [7, 1]);
  const rules = db.prepare(`SELECT * FROM escalation_rules WHERE active=1 AND trigger_type='task_overdue' ORDER BY level`).all() as any[];
  const timeline: any[] = [];
  const describe = (stage: Stage, onDate: string) => {
    const due = stage.deadline_days != null ? addDays(db, onDate, stage.deadline_days, stage.day_mode) : null;
    return {
      stage: stage.key, stage_name: stage.name, entered: onDate, role: stage.responsible_role, due,
      reminders: due ? rem.map(d => addCalendarDays(due, -d)).filter(d => d >= onDate) : [],
      escalations: due && !stage.is_terminal ? rules.filter(r => !r.applies_to_role || r.applies_to_role === stage.responsible_role)
        .map(r => ({ level: r.level, on: addCalendarDays(due, r.after_days), to: r.recipient_role })) : [],
    };
  };
  timeline.push({ step: 0, action: 'submit', ...describe(cur, date) });
  let n = 1;
  for (const s of input.steps) {
    const t = def.transitions.find(x => x.from_key === cur.key && x.action === s.action);
    if (!t) { return { ok: false, errors: [`Stage "${cur.key}" has no action "${s.action}"`], timeline }; }
    date = addCalendarDays(date, s.after_days ?? 0);
    cur = stageBy.get(t.to_key)!;
    timeline.push({ step: n++, action: s.action, by: t.allowed_role ?? stageBy.get(t.from_key)!.responsible_role, ...describe(cur, date) });
    if (cur.is_terminal) break;
  }
  return { ok: true, errors: [], timeline };
}

export function createVersion(db: DB, user: User, workflowId: number, def: Definition, opts: { activate: boolean; note?: string }) {
  const wf = db.prepare('SELECT * FROM workflows WHERE id=?').get(workflowId) as any;
  if (!wf) throw notFound('Workflow not found');
  const v = validateDefinition(def);
  if (!v.valid) throw unprocessable('The workflow is not valid', v.errors);
  return db.transaction(() => {
    const next = ((db.prepare('SELECT MAX(version) m FROM workflow_versions WHERE workflow_id=?').get(workflowId) as any).m ?? 0) + 1;
    const vid = Number(db.prepare('INSERT INTO workflow_versions (workflow_id,version,active,note,created_by,created_at) VALUES (?,?,0,?,?,?)')
      .run(workflowId, next, opts.note ?? null, user.id, clock.iso()).lastInsertRowid);
    insertDefinition(db, vid, def);
    if (opts.activate) activateVersion(db, user, vid);
    audit(db, { actor: actorOf(user), type: 'workflow.version_created', entity: 'workflow', entityId: workflowId,
      next: { version: next, active: opts.activate, stages: def.stages.length, transitions: def.transitions.length }, reason: opts.note });
    return { id: vid, version: next };
  })();
}

export function insertDefinition(db: DB, versionId: number, def: Definition) {
  const si = db.prepare(`INSERT INTO workflow_stages (version_id,key,name,responsible_role,deadline_days,day_mode,is_initial,is_terminal,terminal_status,is_evc,evc_schedule_days,pos_x,pos_y)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  for (const s of def.stages) si.run(versionId, s.key, s.name.trim(), s.responsible_role, s.deadline_days ?? null, s.day_mode ?? 'calendar',
    s.is_initial ? 1 : 0, s.is_terminal ? 1 : 0, s.is_terminal ? s.terminal_status : null, s.is_evc ? 1 : 0, s.evc_schedule_days ?? null, s.pos_x ?? null, s.pos_y ?? null);
  const ti = db.prepare(`INSERT INTO workflow_transitions (version_id,from_key,to_key,action,label,requires_reason,auto,allowed_role,prerequisites) VALUES (?,?,?,?,?,?,?,?,?)`);
  for (const t of def.transitions) ti.run(versionId, t.from_key, t.to_key, t.action, t.label ?? null, t.requires_reason ? 1 : 0, t.auto ? 1 : 0, t.allowed_role ?? null, JSON.stringify(t.prerequisites ?? []));
}

export function activateVersion(db: DB, user: User, versionId: number) {
  const v = db.prepare('SELECT * FROM workflow_versions WHERE id=?').get(versionId) as any;
  if (!v) throw notFound('Version not found');
  db.prepare('UPDATE workflow_versions SET active=0 WHERE workflow_id=?').run(v.workflow_id);
  db.prepare('UPDATE workflow_versions SET active=1 WHERE id=?').run(versionId);
  audit(db, { actor: actorOf(user), type: 'workflow.version_activated', entity: 'workflow', entityId: v.workflow_id, next: { version: v.version } });
}

// ---------------------------------------------------------------- derived values
export function ageInfo(db: DB, app: any, today = clock.today()) {
  const dueSoon = getNumberSetting(db, 'due_soon_days', 3);
  const submitted = app.submitted_at ? istDate(new Date(app.submitted_at)) : null;
  const end = app.completed_at ? istDate(new Date(app.completed_at)) : today;
  const finished = ['approved', 'rejected', 'withdrawn'].includes(app.status);
  const daysInStage = app.stage_entered_at ? daysBetween(istDate(new Date(app.stage_entered_at)), end) : 0;
  let dueStatus: 'none' | 'closed' | 'on_track' | 'due_soon' | 'overdue' = 'none';
  let daysToDue: number | null = null;
  if (finished) dueStatus = 'closed';
  else if (app.stage_due_date) {
    daysToDue = daysBetween(today, app.stage_due_date);
    dueStatus = daysToDue < 0 ? 'overdue' : daysToDue <= dueSoon ? 'due_soon' : 'on_track';
  }
  return { age_days: submitted ? daysBetween(submitted, end) : 0, days_in_stage: daysInStage, due_status: dueStatus, days_to_due: daysToDue };
}

export function requiredDocs(db: DB, app: any) {
  const reqs = db.prepare('SELECT doc_type, has_expiry FROM document_requirements WHERE category_code=? AND required=1').all(app.category_code) as any[];
  return reqs.map(r => {
    const d = db.prepare(`SELECT id, verification_status, expiry_date FROM documents WHERE application_id=? AND doc_type=? AND is_current=1 ORDER BY id DESC LIMIT 1`)
      .get(app.id, r.doc_type) as any;
    return { doc_type: r.doc_type, display_name: docName(r.doc_type), has_expiry: !!r.has_expiry, uploaded: !!d, document_id: d?.id ?? null, verification_status: d?.verification_status ?? null, expiry_date: d?.expiry_date ?? null };
  });
}

export function checkPrerequisites(db: DB, app: any, prereqs: string[]) {
  const docs = requiredDocs(db, app);
  return prereqs.map(p => {
    let met = false;
    switch (p) {
      case 'required_docs_present': met = docs.every(d => d.uploaded); break;
      case 'required_docs_verified': met = docs.every(d => d.verification_status === 'verified'); break;
      case 'observation_recorded':
        met = ((db.prepare('SELECT COUNT(*) c FROM observations WHERE application_id=? AND stage_key=?').get(app.id, app.current_stage) as any).c) > 0; break;
      case 'evc_completed':
        met = (db.prepare('SELECT status FROM evc_schedules WHERE application_id=? ORDER BY id DESC LIMIT 1').get(app.id) as any)?.status === 'completed'; break;
    }
    return { key: p, label: PREREQUISITES[p] ?? p, met };
  });
}

export function availableActions(db: DB, user: User, app: any) {
  if (!app.workflow_version_id || !app.current_stage || !canSee(user, app)) return [];
  const def = loadDefinition(db, app.workflow_version_id);
  const stage = def.stages.find(s => s.key === app.current_stage);
  if (!stage) return [];
  return def.transitions
    .filter(t => t.from_key === stage.key && !t.auto && (t.allowed_role ?? stage.responsible_role) === user.role)
    .map(t => ({
      action: t.action, label: t.label ?? t.action, requires_reason: !!t.requires_reason, to_stage: t.to_key,
      to_stage_name: def.stages.find(s => s.key === t.to_key)?.name ?? t.to_key, prerequisites: checkPrerequisites(db, app, t.prerequisites),
    }));
}

// ---------------------------------------------------------------- applications
export function createApplication(db: DB, user: User, input: { category_code: string; title: string; summary?: string }) {
  if (user.role !== 'institution' || !user.institution_id) throw forbidden('Only institution representatives can create applications');
  const cat = db.prepare('SELECT * FROM application_categories WHERE code=?').get(input.category_code);
  if (!cat) throw badRequest('Unknown application category');
  const inst = db.prepare('SELECT * FROM institutions WHERE id=?').get(user.institution_id) as any;
  const now = clock.iso();
  return db.transaction(() => {
    const id = Number(db.prepare(`INSERT INTO applications (ref,title,institution_id,region_id,category_code,status,summary,created_by,created_at,updated_at,synthetic)
      VALUES (?,?,?,?,?,'draft',?,?,?,?,?)`).run(`TMP-${Math.random()}`, input.title, inst.id, inst.region_id, input.category_code, input.summary ?? null, user.id, now, now, originFlag()).lastInsertRowid);
    const ref = `AF-${clock.today().slice(0, 4)}-${String(id).padStart(5, '0')}`;
    db.prepare('UPDATE applications SET ref=? WHERE id=?').run(ref, id);
    audit(db, { actor: actorOf(user), type: 'application.created', entity: 'application', entityId: id, next: { ref, category: input.category_code } });
    return id;
  })();
}

export function updateDraft(db: DB, user: User, appId: number, input: { title?: string; summary?: string }) {
  const app = db.prepare('SELECT * FROM applications WHERE id=?').get(appId) as any;
  if (!app || !canSee(user, app)) throw notFound('Application not found');
  if (user.role !== 'institution' || app.status !== 'draft') throw forbidden('Only draft applications can be edited by their institution');
  db.prepare('UPDATE applications SET title=COALESCE(?,title), summary=COALESCE(?,summary), updated_at=?, row_version=row_version+1 WHERE id=?')
    .run(input.title ?? null, input.summary ?? null, clock.iso(), appId);
  audit(db, { actor: actorOf(user), type: 'application.draft_updated', entity: 'application', entityId: appId, next: input });
}

export function submitApplication(db: DB, user: User, appId: number) {
  return db.transaction(() => {
    const app = db.prepare('SELECT * FROM applications WHERE id=?').get(appId) as any;
    if (!app || !canSee(user, app)) throw notFound('Application not found');
    if (user.role !== 'institution') throw forbidden('Only the applying institution can submit');
    if (app.status !== 'draft') throw conflict('This application has already been submitted');
    if (!app.title?.trim()) throw unprocessable('Add a title before submitting');
    const missing = requiredDocs(db, app).filter(d => !d.uploaded).map(d => d.display_name);
    if (missing.length) throw unprocessable('Upload all required documents before submitting', { missing_documents: missing });
    const cat = db.prepare('SELECT workflow_id FROM application_categories WHERE code=?').get(app.category_code) as any;
    const ver = db.prepare('SELECT id FROM workflow_versions WHERE workflow_id=? AND active=1').get(cat.workflow_id) as any;
    if (!ver) throw unprocessable('No active workflow is configured for this category');
    const def = loadDefinition(db, ver.id);
    const initial = def.stages.find(s => s.is_initial)!;
    const now = clock.iso();
    db.prepare('UPDATE applications SET workflow_version_id=?, submitted_at=?, updated_at=? WHERE id=?').run(ver.id, now, now, appId);
    const hid = Number(db.prepare(`INSERT INTO stage_history (application_id,from_stage,to_stage,action,actor_id,actor_label,reason,auto,at) VALUES (?,?,?,?,?,?,?,0,?)`)
      .run(appId, null, initial.key, 'submit', user.id, actorOf(user).label, null, now).lastInsertRowid);
    const fresh = db.prepare('SELECT * FROM applications WHERE id=?').get(appId) as any;
    const docs = db.prepare('SELECT id,doc_type,version,file_name FROM documents WHERE application_id=? AND is_current=1').all(appId);
    db.prepare('INSERT INTO application_submissions (application_id,version,kind,note,snapshot,submitted_by,submitted_at) VALUES (?,?,?,?,?,?,?)')
      .run(appId, 1, 'initial', null, JSON.stringify({ title: fresh.title, summary: fresh.summary, documents: docs }), user.id, now);
    enterStage(db, fresh, initial, hid, 'Application submitted');
    audit(db, { actor: actorOf(user), type: 'application.submitted', entity: 'application', entityId: appId, prev: { status: 'draft' }, next: { stage: initial.key, workflow_version: ver.id } });
    notifyRole(db, { role: 'institution', institutionId: app.institution_id }, { event: 'application.submitted', vars: { ref: app.ref, title: app.title },
      link: `/applications/${appId}`, dedupeKey: `submitted:${appId}`, entity: { type: 'application', id: appId } });
    autoAdvance(db, appId, SYSTEM);
    return appId;
  })();
}

function pickAssignee(db: DB, role: Role, regionId: number): number | null {
  if (role === 'institution') return null;
  const regional = role === 'regional_officer' || role === 'evc_coordinator';
  const row = db.prepare(`
    SELECT u.id, (SELECT COUNT(*) FROM tasks t WHERE t.assigned_user_id=u.id AND t.status='open') AS load
    FROM users u WHERE u.active=1 AND u.role=? ${regional ? 'AND u.region_id=?' : ''} ORDER BY load, u.id LIMIT 1`)
    .get(...(regional ? [role, regionId] : [role])) as any;
  return row?.id ?? null;
}

// Puts the application into `stage`: updates the row (optimistic lock), opens the stage task, creates the EVC queue
// entry where applicable and sends notifications.
function enterStage(db: DB, app: any, stage: Stage, historyId: number, why: string) {
  const now = clock.iso(), today = clock.today();
  const due = !stage.is_terminal && stage.deadline_days != null ? addDays(db, today, stage.deadline_days, stage.day_mode) : null;
  const assignee = stage.is_terminal ? null : pickAssignee(db, stage.responsible_role, app.region_id);
  const status = stage.is_terminal ? (stage.terminal_status ?? 'approved') : stage.responsible_role === 'institution' ? 'returned' : 'in_progress';
  const r = db.prepare(`UPDATE applications SET current_stage=?, stage_entered_at=?, stage_due_date=?, assigned_user_id=?, status=?,
      completed_at=?, row_version=row_version+1, updated_at=? WHERE id=? AND row_version=?`)
    .run(stage.key, now, due, assignee, status, stage.is_terminal ? now : null, now, app.id, app.row_version);
  if (r.changes !== 1) throw conflict('This application was changed by someone else. Reload and try again.');
  const link = `/applications/${app.id}`;
  const vars = { ref: app.ref, title: app.title, stage: stage.name, due: due ?? 'n/a', reason: why };

  if (!stage.is_terminal) {
    db.prepare(`INSERT INTO tasks (application_id,institution_id,region_id,type,title,stage_key,role,assigned_user_id,due_date,status,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,'open',?)`)
      .run(app.id, app.institution_id, app.region_id, stage.is_evc ? 'evc' : 'stage', `${stage.name}: ${app.ref}`, stage.key, stage.responsible_role, assignee, due, now);
  }
  if (stage.is_evc) {
    const schedDays = stage.evc_schedule_days ?? Math.max(1, Math.floor((stage.deadline_days ?? 14) / 2));
    const evcId = Number(db.prepare(`INSERT INTO evc_schedules (application_id,institution_id,region_id,status,schedule_deadline,completion_deadline,created_at,updated_at)
      VALUES (?,?,?,'queued',?,?,?,?)`).run(app.id, app.institution_id, app.region_id, addCalendarDays(today, schedDays), due, now, now).lastInsertRowid);
    db.prepare(`INSERT INTO evc_history (evc_id,action,actor_id,at,reason) VALUES (?,?,?,?,?)`).run(evcId, 'queued', null, now, 'Application reached an EVC stage');
    notifyRole(db, { role: 'evc_coordinator', regionId: app.region_id }, { event: 'evc.queued', vars, link: '/evc', dedupeKey: `evc-queued:${evcId}`, entity: { type: 'evc', id: evcId } });
  }
  if (assignee) notify(db, { userId: assignee, event: 'application.assigned', vars, link, dedupeKey: `assigned:${historyId}`, entity: { type: 'application', id: app.id } });
  else if (!stage.is_terminal && stage.responsible_role !== 'institution')
    notifyRole(db, { role: stage.responsible_role, regionId: app.region_id }, { event: 'application.assigned', vars, link, dedupeKey: `assigned:${historyId}`, entity: { type: 'application', id: app.id } });

  if (stage.is_terminal) {
    if (status === 'approved') createUndertakingsFromTemplates(db, { ...app, status }, historyId);
    notifyRole(db, { role: 'institution', institutionId: app.institution_id }, { event: 'application.decided', vars: { ...vars, outcome: status }, link, dedupeKey: `decided:${historyId}`, ackRequired: true, entity: { type: 'application', id: app.id } });
  } else if (stage.responsible_role === 'institution') {
    notifyRole(db, { role: 'institution', institutionId: app.institution_id }, { event: 'application.returned', vars, link, dedupeKey: `returned:${historyId}`, ackRequired: true, entity: { type: 'application', id: app.id } });
  } else {
    notifyRole(db, { role: 'institution', institutionId: app.institution_id }, { event: 'application.stage_changed', vars, link, dedupeKey: `stage:${historyId}`, entity: { type: 'application', id: app.id } });
  }
}

function applyTransition(db: DB, app: any, def: Definition, t: Transition, actor: Actor, reason: string | null, auto: boolean, correlationId?: string | null, opts: { deficiencyCategory?: string } = {}) {
  const to = def.stages.find(s => s.key === t.to_key)!;
  const now = clock.iso();
  const openTasks = db.prepare(`SELECT id FROM tasks WHERE application_id=? AND status='open'`).all(app.id) as any[];
  db.prepare(`UPDATE tasks SET status='done', completed_at=? WHERE application_id=? AND status='open'`).run(now, app.id);
  const hid = Number(db.prepare(`INSERT INTO stage_history (application_id,from_stage,to_stage,action,actor_id,actor_label,reason,auto,at) VALUES (?,?,?,?,?,?,?,?,?)`)
    .run(app.id, app.current_stage, to.key, t.action, actor.id, actor.label, reason, auto ? 1 : 0, now).lastInsertRowid);
  if (t.action === 'resubmit') {
    const v = ((db.prepare('SELECT MAX(version) m FROM application_submissions WHERE application_id=?').get(app.id) as any).m ?? 0) + 1;
    const docs = db.prepare('SELECT id,doc_type,version,file_name FROM documents WHERE application_id=? AND is_current=1').all(app.id);
    db.prepare('INSERT INTO application_submissions (application_id,version,kind,note,snapshot,submitted_by,submitted_at) VALUES (?,?,?,?,?,?,?)')
      .run(app.id, v, 'resubmission', reason, JSON.stringify({ title: app.title, summary: app.summary, documents: docs }), actor.id, now);
    notifyRole(db, { role: 'regional_officer', regionId: app.region_id }, { event: 'application.resubmitted', vars: { ref: app.ref, title: app.title }, link: `/applications/${app.id}`, dedupeKey: `resub:${hid}`, entity: { type: 'application', id: app.id } });
  }
  audit(db, { actor, type: auto ? 'application.auto_transition' : 'application.transition', entity: 'application', entityId: app.id,
    prev: { stage: app.current_stage, status: app.status }, next: { stage: to.key, action: t.action }, reason, correlationId });
  enterStage(db, app, to, hid, reason ?? t.label ?? t.action);
  trackDeficiencies(db, app, t, actor, reason, now, opts);
  sweepEscalations(db, 'Task completed or workflow advanced');
  return openTasks.length;
}

export function performTransition(db: DB, user: User, appId: number, action: string, opts: { reason?: string; rowVersion?: number; correlationId?: string | null; deficiencyCategory?: string } = {}) {
  return db.transaction(() => {
    const app = db.prepare('SELECT * FROM applications WHERE id=?').get(appId) as any;
    if (!app || !canSee(user, app)) throw notFound('Application not found');
    if (app.status === 'draft' || !app.workflow_version_id) throw conflict('Submit the application first');
    if (opts.rowVersion !== undefined && opts.rowVersion !== app.row_version)
      throw conflict('This application was changed by someone else. Reload and try again.', { current_row_version: app.row_version });
    const def = loadDefinition(db, app.workflow_version_id);
    const stage = def.stages.find(s => s.key === app.current_stage)!;
    const t = def.transitions.find(x => x.from_key === stage.key && x.action === action);
    if (!t || t.auto) throw conflict(`"${action}" is not available from the current stage (${stage.name})`);
    if ((t.allowed_role ?? stage.responsible_role) !== user.role) throw forbidden('Your role cannot perform this action at this stage');
    const reason = opts.reason?.trim() || null;
    if (t.requires_reason && !reason) throw unprocessable('A reason is required for this action');
    const unmet = checkPrerequisites(db, app, t.prerequisites).filter(p => !p.met);
    if (unmet.length) throw unprocessable('Requirements for this action are not met yet', { unmet: unmet.map(u => u.label) });
    applyTransition(db, app, def, t, actorOf(user), reason, false, opts.correlationId, { deficiencyCategory: opts.deficiencyCategory });
    autoAdvance(db, appId, SYSTEM, opts.correlationId);
    return db.prepare('SELECT * FROM applications WHERE id=?').get(appId) as any;
  })();
}

// Moves the application forward while an automatic transition has all of its prerequisites satisfied.
export function autoAdvance(db: DB, appId: number, actor: Actor = SYSTEM, correlationId?: string | null) {
  let moved = 0;
  for (let i = 0; i < 10; i++) {
    const app = db.prepare('SELECT * FROM applications WHERE id=?').get(appId) as any;
    if (!app?.workflow_version_id || !app.current_stage) break;
    const def = loadDefinition(db, app.workflow_version_id);
    const next = def.transitions.find(t => t.auto && t.from_key === app.current_stage && checkPrerequisites(db, app, t.prerequisites).every(p => p.met));
    if (!next) break;
    applyTransition(db, app, def, next, actor, 'Automatic: prerequisites satisfied', true, correlationId);
    moved++;
  }
  return moved;
}

export function addObservation(db: DB, user: User, appId: number, text: string) {
  const app = db.prepare('SELECT * FROM applications WHERE id=?').get(appId) as any;
  if (!app || !canSee(user, app)) throw notFound('Application not found');
  if (!app.workflow_version_id || ['approved', 'rejected', 'withdrawn'].includes(app.status)) throw conflict('Observations can only be added while the application is in progress');
  const stage = loadDefinition(db, app.workflow_version_id).stages.find(s => s.key === app.current_stage)!;
  if (stage.responsible_role !== user.role || user.role === 'institution') throw forbidden('Only the role responsible for this stage can record observations');
  if (!text?.trim()) throw badRequest('Observation text is required');
  const id = Number(db.prepare('INSERT INTO observations (application_id,stage_key,author_id,text,at) VALUES (?,?,?,?,?)').run(appId, stage.key, user.id, text.trim(), clock.iso()).lastInsertRowid);
  audit(db, { actor: actorOf(user), type: 'application.observation_added', entity: 'application', entityId: appId, next: { stage: stage.key, observation_id: id } });
  autoAdvance(db, appId, SYSTEM);
  return id;
}

// A return for clarification raises a deficiency; the institution's resubmission records the corrective action; the next officer action closes it.
export const DEFICIENCY_CATEGORIES = ['document', 'infrastructure', 'faculty', 'compliance', 'other'];
function trackDeficiencies(db: DB, app: any, t: Transition, actor: Actor, reason: string | null, now: string, opts: { deficiencyCategory?: string }) {
  if (t.action === 'return') {
    const cat = DEFICIENCY_CATEGORIES.includes(opts.deficiencyCategory ?? '') ? opts.deficiencyCategory! : 'other';
    const due = (db.prepare('SELECT stage_due_date d FROM applications WHERE id=?').get(app.id) as any)?.d ?? null;
    const rule = (db.prepare(`SELECT id FROM regulatory_rules WHERE code='R-EOA-03'`).get() as any)?.id ?? null;
    const id = Number(db.prepare(`INSERT INTO deficiencies (application_id,institution_id,region_id,stage_key,category,description,rule_id,raised_by,raised_at,due_date,status) VALUES (?,?,?,?,?,?,?,?,?,?, 'open')`)
      .run(app.id, app.institution_id, app.region_id, app.current_stage, cat, reason ?? 'Returned for clarification', rule, actor.id, now, due).lastInsertRowid);
    audit(db, { actor, type: 'deficiency.raised', entity: 'deficiency', entityId: id, next: { application: app.ref, category: cat, due }, reason });
  } else if (t.action === 'resubmit') {
    const open = db.prepare(`SELECT id FROM deficiencies WHERE application_id=? AND status='open'`).all(app.id) as any[];
    for (const d of open) { db.prepare(`UPDATE deficiencies SET status='responded', corrective_action=?, responded_at=? WHERE id=?`).run(reason, now, d.id); audit(db, { actor, type: 'deficiency.responded', entity: 'deficiency', entityId: d.id, reason }); }
  } else {
    const responded = db.prepare(`SELECT id FROM deficiencies WHERE application_id=? AND status='responded'`).all(app.id) as any[];
    for (const d of responded) { db.prepare(`UPDATE deficiencies SET status='closed', closed_at=?, closed_by=? WHERE id=?`).run(now, actor.id, d.id); audit(db, { actor, type: 'deficiency.closed', entity: 'deficiency', entityId: d.id, reason: 'Accepted by the reviewing officer' }); }
  }
}
