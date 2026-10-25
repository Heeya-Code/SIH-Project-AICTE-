import type { DB } from './db';
import { clock } from './clock';
import { audit, actorOf } from './audit';
import { notifyRole } from './notify';
import { canSee, type User } from './auth';
import { addCalendarDays, badRequest, conflict, daysBetween, forbidden, isDate, notFound, unprocessable } from './util';
import { autoAdvance } from './workflow';
import { sweepEscalations } from './escalation';

export function evcState(e: any, today = clock.today()) {
  if (e.status === 'completed' || e.status === 'cancelled') return { state: e.status as string, overdue: false, reason: null as string | null };
  if (e.status === 'queued' && e.schedule_deadline < today) return { state: 'overdue', overdue: true, reason: `Not scheduled by ${e.schedule_deadline}` };
  if (e.status !== 'queued' && e.confirmed_date && e.confirmed_date < today) return { state: 'overdue', overdue: true, reason: `Visit date ${e.confirmed_date} passed without a completion record` };
  if (e.completion_deadline && e.completion_deadline < today) return { state: 'overdue', overdue: true, reason: `Completion deadline ${e.completion_deadline} passed` };
  return { state: e.status as string, overdue: false, reason: null };
}

function load(db: DB, user: User, id: number) {
  const e = db.prepare('SELECT e.*, a.ref, a.current_stage, a.status AS app_status, a.title FROM evc_schedules e JOIN applications a ON a.id=e.application_id WHERE e.id=?').get(id) as any;
  if (!e || !canSee(user, e)) throw notFound('EVC record not found');
  return e;
}
const mustCoordinate = (user: User) => { if (user.role !== 'evc_coordinator') throw forbidden('Only EVC coordinators can schedule or record visits'); };

function checkConflict(db: DB, committeeId: number, date: string, exceptEvcId: number) {
  const clash = db.prepare(`SELECT e.id, a.ref FROM evc_schedules e JOIN applications a ON a.id=e.application_id
    WHERE e.committee_id=? AND e.confirmed_date=? AND e.status IN ('scheduled','rescheduled') AND e.id<>?`).get(committeeId, date, exceptEvcId) as any;
  if (clash) throw conflict(`That committee is already booked on ${date} (${clash.ref})`, { clashing_evc_id: clash.id });
}

function validateSlot(db: DB, user: User, e: any, date: string, committeeId: number) {
  if (!isDate(date)) throw badRequest('Choose a valid visit date');
  if (date < clock.today()) throw unprocessable('The visit date cannot be in the past');
  const c = db.prepare('SELECT * FROM evc_committees WHERE id=?').get(committeeId) as any;
  if (!c || c.region_id !== e.region_id) throw badRequest('Choose a committee from this region');
  if (e.completion_deadline && date > e.completion_deadline) throw unprocessable(`That date is after the completion deadline (${e.completion_deadline})`);
  checkConflict(db, committeeId, date, e.id);
}

function mustBeActive(e: any) {
  if (e.app_status !== 'in_progress') throw conflict('This application is no longer at an EVC stage');
}

export function scheduleEvc(db: DB, user: User, id: number, input: { confirmed_date: string; committee_id: number; proposed_date?: string | null; reason?: string }) {
  mustCoordinate(user);
  return db.transaction(() => {
    const e = load(db, user, id); mustBeActive(e);
    if (e.status !== 'queued') throw conflict('This visit is already scheduled. Use reschedule to change it.');
    validateSlot(db, user, e, input.confirmed_date, input.committee_id);
    const now = clock.iso();
    db.prepare(`UPDATE evc_schedules SET status='scheduled', confirmed_date=?, proposed_date=COALESCE(?,proposed_date), committee_id=?, updated_at=? WHERE id=?`).run(input.confirmed_date, input.proposed_date ?? null, input.committee_id, now, id);
    db.prepare('INSERT INTO evc_history (evc_id,action,actor_id,to_date,committee_id,reason,at) VALUES (?,?,?,?,?,?,?)').run(id, 'scheduled', user.id, input.confirmed_date, input.committee_id, input.reason ?? null, now);
    audit(db, { actor: actorOf(user), type: 'evc.scheduled', entity: 'evc', entityId: id, prev: { status: e.status }, next: { date: input.confirmed_date, committee_id: input.committee_id, application: e.ref } });
    notifyRole(db, { role: 'institution', institutionId: e.institution_id }, { event: 'evc.scheduled', vars: { ref: e.ref, date: input.confirmed_date }, link: `/applications/${e.application_id}`, dedupeKey: `evc-sched:${id}:${input.confirmed_date}`, entity: { type: 'evc', id } });
    sweepEscalations(db, 'EVC scheduled');
  })();
}

export function rescheduleEvc(db: DB, user: User, id: number, input: { confirmed_date: string; committee_id: number; reason: string }) {
  mustCoordinate(user);
  return db.transaction(() => {
    const e = load(db, user, id); mustBeActive(e);
    if (!['scheduled', 'rescheduled'].includes(e.status)) throw conflict('Only a scheduled visit can be rescheduled');
    if (!input.reason?.trim()) throw unprocessable('A reason is required to reschedule');
    validateSlot(db, user, e, input.confirmed_date, input.committee_id);
    const now = clock.iso();
    db.prepare(`UPDATE evc_schedules SET status='rescheduled', confirmed_date=?, committee_id=?, reschedule_count=reschedule_count+1, updated_at=? WHERE id=?`).run(input.confirmed_date, input.committee_id, now, id);
    db.prepare('INSERT INTO evc_history (evc_id,action,actor_id,from_date,to_date,committee_id,reason,at) VALUES (?,?,?,?,?,?,?,?)').run(id, 'rescheduled', user.id, e.confirmed_date, input.confirmed_date, input.committee_id, input.reason, now);
    audit(db, { actor: actorOf(user), type: 'evc.rescheduled', entity: 'evc', entityId: id, prev: { date: e.confirmed_date }, next: { date: input.confirmed_date, committee_id: input.committee_id }, reason: input.reason });
    notifyRole(db, { role: 'institution', institutionId: e.institution_id }, { event: 'evc.scheduled', vars: { ref: e.ref, date: input.confirmed_date }, link: `/applications/${e.application_id}`, dedupeKey: `evc-sched:${id}:${input.confirmed_date}`, entity: { type: 'evc', id } });
  })();
}

export function completeEvc(db: DB, user: User, id: number, input: { visit_date: string; notes: string; outcome?: 'satisfactory' | 'deficiencies_noted' }) {
  mustCoordinate(user);
  return db.transaction(() => {
    const e = load(db, user, id); mustBeActive(e);
    if (!['scheduled', 'rescheduled'].includes(e.status)) throw conflict('Schedule the visit before recording completion');
    if (!isDate(input.visit_date) || input.visit_date > clock.today()) throw unprocessable('The visit date must be today or earlier');
    if (!input.notes?.trim()) throw badRequest('Add visit observations');
    const now = clock.iso();
    db.prepare(`UPDATE evc_schedules SET status='completed', visit_date=?, visit_notes=?, completed_at=?, updated_at=? WHERE id=?`).run(input.visit_date, input.notes.trim(), now, now, id);
    db.prepare('INSERT INTO evc_history (evc_id,action,actor_id,to_date,reason,at) VALUES (?,?,?,?,?,?)').run(id, 'completed', user.id, input.visit_date, input.notes.trim(), now);
    db.prepare('INSERT INTO evc_reports (evc_id,application_id,author_id,outcome,summary,submitted_at) VALUES (?,?,?,?,?,?)').run(id, e.application_id, user.id, input.outcome ?? 'satisfactory', input.notes.trim(), now);
    audit(db, { actor: actorOf(user), type: 'evc.completed', entity: 'evc', entityId: id, prev: { status: e.status }, next: { status: 'completed', visit_date: input.visit_date, application: e.ref } });
    sweepEscalations(db, 'EVC visit completed');
    // Completing the visit satisfies the "evc_completed" prerequisite; the workflow advances by itself when configured.
    const moved = autoAdvance(db, e.application_id, actorOf(user));
    return { advanced: moved > 0 };
  })();
}

// Candidate slots with the reasoning shown to the user. Suggestions only: the coordinator still confirms.
export function suggestSlots(db: DB, user: User, id: number) {
  const e = load(db, user, id);
  const today = clock.today();
  const committees = db.prepare('SELECT * FROM evc_committees WHERE region_id=?').all(e.region_id) as any[];
  const horizon = e.completion_deadline ?? addCalendarDays(today, 30);
  const urgency = daysBetween(today, e.schedule_deadline);
  const out: any[] = [];
  for (const c of committees) {
    const load30 = (db.prepare(`SELECT COUNT(*) n FROM evc_schedules WHERE committee_id=? AND status IN ('scheduled','rescheduled') AND confirmed_date BETWEEN ? AND ?`).get(c.id, today, addCalendarDays(today, 30)) as any).n;
    for (let i = 1; i <= 21; i++) {
      const d = addCalendarDays(today, i);
      if (d > horizon) break;
      const wd = new Date(`${d}T00:00:00Z`).getUTCDay();
      if (wd === 0 || wd === 6) continue;
      const taken = db.prepare(`SELECT 1 FROM evc_schedules WHERE committee_id=? AND confirmed_date=? AND status IN ('scheduled','rescheduled')`).get(c.id, d);
      if (taken) continue;
      const score = i * 2 + load30 * 3; // earlier + lighter committee workload = better
      out.push({ committee_id: c.id, committee: c.name, date: d, score,
        reasoning: [`Free on ${d}`, `${load30} visit(s) already booked for this committee in the next 30 days`,
          urgency < 0 ? `Scheduling deadline already passed ${-urgency} day(s) ago, so the earliest free slot is preferred` : `Scheduling deadline is in ${urgency} day(s)`,
          `Before the completion deadline (${horizon})`] });
    }
  }
  return out.sort((a, b) => a.score - b.score).slice(0, 5);
}
