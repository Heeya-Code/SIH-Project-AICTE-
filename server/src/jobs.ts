import type { DB } from './db';
import { clock } from './clock';
import { audit, SYSTEM } from './audit';
import { notify, notifyRole, processOutbox } from './notify';
import { daysBetween, getDaysSetting, reminderBucket } from './util';
import { runEscalations, sweepEscalations } from './escalation';
import { docName } from './docnames';
import { originFlag } from './origin';

// Every sub-job is idempotent: notifications carry a dedupe key and escalation events have a unique key, so running the
// scheduler twice, late, or after a restart never duplicates anything. Nothing here depends on a browser being open.

function taskDeadlines(db: DB, today: string) {
  const days = getDaysSetting(db, 'reminder_days_task', [7, 1]);
  let reminders = 0, overdue = 0;
  const tasks = db.prepare(`SELECT t.*, a.ref FROM tasks t JOIN applications a ON a.id=t.application_id WHERE t.status='open' AND t.due_date IS NOT NULL AND t.type <> 'evc'`).all() as any[];
  for (const t of tasks) {
    const left = daysBetween(today, t.due_date);
    const link = `/applications/${t.application_id}`;
    const to = (key: string, event: string, vars: any) => {
      if (t.assigned_user_id) return notify(db, { userId: t.assigned_user_id, event, vars, link, dedupeKey: key, entity: { type: 'task', id: t.id } }) !== null ? 1 : 0;
      return notifyRole(db, t.role === 'institution' ? { role: 'institution', institutionId: t.institution_id } : { role: t.role, regionId: t.region_id }, { event, vars, link, dedupeKey: key, entity: { type: 'task', id: t.id } });
    };
    const bucket = reminderBucket(left, days);
    if (bucket !== null) reminders += to(`task-rem:${t.id}:${bucket}`, 'task.deadline_approaching', { ref: t.ref, title: t.title, due: t.due_date, days: left });
    if (left < 0) overdue += to(`task-overdue:${t.id}`, 'task.overdue', { ref: t.ref, title: t.title, due: t.due_date, days: -left });
  }
  return { reminders, overdue };
}

function evcDeadlines(db: DB, today: string) {
  const days = getDaysSetting(db, 'reminder_days_evc', [7, 1]);
  let reminders = 0, overdue = 0;
  for (const e of db.prepare(`SELECT e.*, a.ref FROM evc_schedules e JOIN applications a ON a.id=e.application_id WHERE e.status IN ('queued','scheduled','rescheduled')`).all() as any[]) {
    const target = e.status === 'queued' ? e.schedule_deadline : (e.completion_deadline ?? e.confirmed_date);
    if (!target) continue;
    const left = daysBetween(today, target);
    const spec = { role: 'evc_coordinator' as const, regionId: e.region_id };
    const bucket = reminderBucket(left, days);
    const what = e.status === 'queued' ? 'scheduling' : 'completion';
    if (bucket !== null) reminders += notifyRole(db, spec, { event: 'evc.deadline_approaching', vars: { ref: e.ref, what, due: target, days: left }, link: '/evc', dedupeKey: `evc-rem:${e.id}:${what}:${bucket}`, entity: { type: 'evc', id: e.id } });
    if (left < 0) overdue += notifyRole(db, spec, { event: 'evc.overdue', vars: { ref: e.ref, what, due: target, days: -left }, link: '/evc', dedupeKey: `evc-overdue:${e.id}:${what}`, entity: { type: 'evc', id: e.id } });
  }
  return { reminders, overdue };
}

function undertakingDeadlines(db: DB, today: string) {
  const days = getDaysSetting(db, 'reminder_days_undertaking', [7, 1]);
  let reminders = 0, overdue = 0;
  for (const u of db.prepare(`SELECT * FROM undertakings WHERE status IN ('pending','returned')`).all() as any[]) {
    const left = daysBetween(today, u.due_date);
    const inst = { role: 'institution' as const, institutionId: u.institution_id };
    const bucket = reminderBucket(left, days);
    if (bucket !== null) reminders += notifyRole(db, inst, { event: 'undertaking.deadline_approaching', vars: { code: u.code, condition: u.condition_text, due: u.due_date, days: left }, link: '/compliance', dedupeKey: `und-rem:${u.id}:${bucket}`, entity: { type: 'undertaking', id: u.id } });
    if (left < 0) {
      overdue += notifyRole(db, inst, { event: 'compliance.overdue', vars: { code: u.code, due: u.due_date, days: -left }, link: '/compliance', dedupeKey: `und-overdue:${u.id}`, entity: { type: 'undertaking', id: u.id } });
      notifyRole(db, { role: 'regional_officer', regionId: u.region_id }, { event: 'compliance.overdue', vars: { code: u.code, due: u.due_date, days: -left }, link: '/compliance', dedupeKey: `und-overdue-ro:${u.id}`, entity: { type: 'undertaking', id: u.id } });
    }
  }
  return { reminders, overdue };
}

function documentExpiry(db: DB, today: string) {
  const globalDays = getDaysSetting(db, 'reminder_days_document', [30, 7, 1]);
  let reminders = 0, expired = 0;
  for (const d of db.prepare(`SELECT * FROM documents WHERE is_current=1 AND expiry_date IS NOT NULL AND renewal_status <> 'renewed'`).all() as any[]) {
    let req: any = null;
    if (d.application_id) {
      const app = db.prepare('SELECT category_code FROM applications WHERE id=?').get(d.application_id) as any;
      if (app) {
        req = db.prepare('SELECT reminder_days, auto_renewal FROM document_requirements WHERE category_code=? AND doc_type=?').get(app.category_code, d.doc_type);
      }
    }
    if (!req) {
      req = db.prepare('SELECT reminder_days, auto_renewal FROM document_requirements WHERE doc_type=? LIMIT 1').get(d.doc_type);
    }
    let days = globalDays;
    if (req?.reminder_days) {
      try {
        const parsed = JSON.parse(req.reminder_days);
        if (Array.isArray(parsed) && parsed.length > 0) {
          days = parsed.map(Number);
        }
      } catch {}
    }
    const horizon = Math.max(...days, 0);
    const left = daysBetween(today, d.expiry_date);
    const inst = { role: 'institution' as const, institutionId: d.institution_id };
    const vars = { doc_type: docName(d.doc_type), due: d.expiry_date, days: left < 0 ? -left : left };
    if (left < 0) {
      if (d.renewal_status !== 'expired') db.prepare(`UPDATE documents SET renewal_status='expired' WHERE id=?`).run(d.id);
      expired += notifyRole(db, inst, { event: 'document.expired', vars, link: '/documents', dedupeKey: `doc-exp:${d.id}`, entity: { type: 'document', id: d.id } });
      notifyRole(db, { role: 'regional_officer', regionId: d.region_id }, { event: 'document.expired', vars, link: '/documents', dedupeKey: `doc-exp-ro:${d.id}`, entity: { type: 'document', id: d.id } });
    } else if (left <= horizon) {
      if (d.renewal_status === 'not_due') db.prepare(`UPDATE documents SET renewal_status='due_for_renewal' WHERE id=?`).run(d.id);
      const bucket = reminderBucket(left, days);
      if (bucket !== null) {
        const res = notifyRole(db, inst, { event: 'document.expiry_approaching', vars, link: '/documents', dedupeKey: `doc-rem:${d.id}:${bucket}`, entity: { type: 'document', id: d.id } });
        reminders += res;
        if (req?.auto_renewal === 1) {
          const existingUnd = db.prepare(`SELECT 1 FROM undertakings WHERE institution_id=? AND document_id=? AND status NOT IN ('closed')`).get(d.institution_id, d.id);
          if (!existingUnd) {
            const condition_text = `Renew ${docName(d.doc_type)} (Due: ${d.expiry_date})`;
            const description = `Automatic renewal task created for ${docName(d.doc_type)} (Expiring on ${d.expiry_date}).`;
            const required_evidence = `Valid renewed ${docName(d.doc_type)}`;
            const undId = Number(db.prepare(`INSERT INTO undertakings (code,institution_id,region_id,application_id,document_id,condition_text,description,required_evidence,due_date,status,created_by,created_at)
              VALUES (?,?,?,?,?,?,?,?,?, 'pending', NULL, ?)`).run(`TMP-${Math.random()}`, d.institution_id, d.region_id, d.application_id, d.id, condition_text, description, required_evidence, d.expiry_date, clock.iso()).lastInsertRowid);
            const code = (id: number) => `UT-${clock.today().slice(0, 4)}-${String(id).padStart(5, '0')}`;
            db.prepare('UPDATE undertakings SET code=?, synthetic=? WHERE id=?').run(code(undId), originFlag(), undId);
            audit(db, { actor: SYSTEM, type: 'undertaking.created', entity: 'undertaking', entityId: undId, next: { document_id: d.id, auto_renewal: true, due_date: d.expiry_date } });
            notifyRole(db, { role: 'institution', institutionId: d.institution_id }, {
              event: 'undertaking.created', vars: { code: code(undId), condition: condition_text, due: d.expiry_date }, link: '/compliance',
              dedupeKey: `und-created:${undId}`, entity: { type: 'undertaking', id: undId },
            });
          }
        }
      }
    }
  }
  return { reminders, expired };
}

let running = false;

export async function runJobs(db: DB, trigger: 'scheduler' | 'manual' | 'seed' | 'test' = 'scheduler') {
  if (running) return { skipped: true as const };       // single-instance guard (see README for multi-instance notes)
  running = true;
  const today = clock.today();
  const runId = Number(db.prepare(`INSERT INTO job_runs (trigger,started_at,status,sim_date) VALUES (?,?,?,?)`).run(trigger, clock.iso(), 'running', clock.isPinned() ? today : null).lastInsertRowid);
  const summary: Record<string, any> = {};
  const errors: string[] = [];
  const step = (name: string, fn: () => any) => {
    try { summary[name] = db.transaction(fn)(); } catch (e: any) { errors.push(`${name}: ${e.message}`); summary[name] = 'failed'; }
  };
  try {
    step('tasks', () => taskDeadlines(db, today));
    step('evc', () => evcDeadlines(db, today));
    step('undertakings', () => undertakingDeadlines(db, today));
    step('documents', () => documentExpiry(db, today));
    step('escalation_sweep', () => sweepEscalations(db, 'Resolved since last check'));
    step('escalations_created', () => runEscalations(db, today));
    try { summary.outbox = await processOutbox(db); } catch (e: any) { errors.push(`outbox: ${e.message}`); summary.outbox = 'failed'; }
    const status = errors.length === 0 ? 'ok' : errors.length < 6 ? 'partial' : 'failed';
    db.prepare(`UPDATE job_runs SET finished_at=?, status=?, summary=?, error=? WHERE id=?`).run(clock.iso(), status, JSON.stringify(summary), errors.join('; ') || null, runId);
    if (errors.length) audit(db, { actor: SYSTEM, type: 'job.failed', entity: 'job', entityId: runId, reason: errors.join('; ') });
    return { runId, status, summary, errors };
  } finally { running = false; }
}

let timer: NodeJS.Timeout | null = null;
export function startScheduler(db: DB, everySeconds: number, log: (m: string) => void = console.log) {
  stopScheduler();
  const tick = () => runJobs(db, 'scheduler').catch(e => log(`[jobs] scheduler error: ${e.message}`));
  setTimeout(tick, 2000);                // catch up shortly after boot: missed reminders are sent exactly once
  timer = setInterval(tick, everySeconds * 1000);
  timer.unref();
  log(`[jobs] deadline scheduler running every ${everySeconds}s (server-side, independent of any browser)`);
}
export function stopScheduler() { if (timer) clearInterval(timer); timer = null; }
