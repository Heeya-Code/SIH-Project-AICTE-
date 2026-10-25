import type { DB } from './db';
import { appScope, scope, type User } from './auth';
import { clock } from './clock';
import { addCalendarDays, daysBetween, forbidden, getNumberSetting, median, round1 } from './util';
import { effectiveStatus } from './compliance';
import { evcState } from './evc';
import { pendingApps, stageDurations } from './reports';
import { verifyAuditChain } from './audit';
import { availableActions, ageInfo } from './workflow';
import { docName, docCode, submissionDocs } from './docnames';

type Card = { key: string; label: string; value: number | string; tone?: 'neutral' | 'warn' | 'bad' | 'good'; hint?: string; link?: string };
const one = (db: DB, sql: string, ...p: any[]) => (db.prepare(sql).get(...p) as any).c as number;
const tone = (n: number, bad = 'bad'): Card['tone'] => (n > 0 ? (bad as any) : 'good');

export function manualWorkSaved(db: DB, user: User, window: string = '30') {
  if (user.role === 'institution') throw forbidden('Institution users do not have access to manual work saved metrics');
  const today = clock.today();
  const cutoff = window === '30' ? addCalendarDays(today, -30) : '1970-01-01';
  const A = appScope(user, 'a');

  const automatic_stage_moves = one(db, `SELECT COUNT(*) c FROM stage_history h JOIN applications a ON a.id=h.application_id WHERE h.auto=1 AND ${A.sql} AND substr(h.at,1,10) >= ?`, ...A.params, cutoff);
  const reminders_sent = one(db, `SELECT COUNT(*) c FROM notifications n JOIN applications a ON a.id=n.entity_id WHERE n.entity_type='application' AND (n.event LIKE '%reminder%' OR n.event LIKE '%approaching%') AND ${A.sql} AND substr(n.created_at,1,10) >= ?`, ...A.params, cutoff);
  const overdue_notices_sent = one(db, `SELECT COUNT(*) c FROM notifications n JOIN applications a ON a.id=n.entity_id WHERE n.entity_type='application' AND (n.event LIKE '%overdue%' OR n.event LIKE '%expired%') AND ${A.sql} AND substr(n.created_at,1,10) >= ?`, ...A.params, cutoff);
  const escalations_raised = one(db, `SELECT COUNT(*) c FROM escalation_events x JOIN applications a ON a.id=x.application_id WHERE ${A.sql} AND substr(x.triggered_at,1,10) >= ?`, ...A.params, cutoff);
  const cases_routed_automatically = one(db, `SELECT COUNT(*) c FROM tasks t JOIN applications a ON a.id=t.application_id WHERE ${A.sql} AND t.assigned_user_id IS NULL AND substr(t.created_at,1,10) >= ?`, ...A.params, cutoff);

  const total = automatic_stage_moves + reminders_sent + overdue_notices_sent + escalations_raised + cases_routed_automatically;

  return {
    window,
    total,
    counts: {
      automatic_stage_moves,
      reminders_sent,
      overdue_notices_sent,
      escalations_raised,
      cases_routed_automatically,
    },
    caption: 'Calculated from synthetic demonstration data.'
  };
}

// ---------------------------------------------------------------- dashboards: every number below comes from a query
export function buildDashboard(db: DB, user: User) {
  const today = clock.today(), soon = addCalendarDays(today, 3);
  const A = appScope(user, 'a'), T = scope(user, 't'), E = scope(user, 'e'), U = scope(user, 'u'), D = scope(user, 'd');
  const cards: Card[] = [], charts: any[] = [], lists: any[] = [];
  const stageNames = Object.fromEntries((db.prepare(`SELECT s.key, s.name FROM workflow_stages s JOIN workflow_versions v ON v.id=s.version_id WHERE v.active=1`).all() as any[]).map(r => [r.key, r.name]));
  const byStage = () => {
    const g: Record<string, number> = {};
    for (const a of pendingApps(db, user)) g[stageNames[a.current_stage] ?? a.current_stage] = (g[stageNames[a.current_stage] ?? a.current_stage] ?? 0) + 1;
    return Object.entries(g).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
  };
  const appRows = (sql: string, ...p: any[]) => (db.prepare(`SELECT a.id, a.ref, a.title, a.current_stage, a.stage_due_date, a.submitted_at, a.stage_entered_at, a.status, a.completed_at, i.name AS institution, r.name AS region
    FROM applications a JOIN institutions i ON i.id=a.institution_id JOIN regions r ON r.id=a.region_id WHERE ${A.sql} AND ${sql}`).all(...A.params, ...p) as any[]).map(a => ({ ...a, ...ageInfo(db, a, today), stage: stageNames[a.current_stage] ?? a.current_stage }));
  const open = `a.status IN ('in_progress','returned')`;
  const base = { role: user.role, today };

  switch (user.role) {
    case 'institution': {
      const mine = appRows('1=1');
      const unds = db.prepare(`SELECT u.* FROM undertakings u WHERE ${U.sql}`).all(...U.params) as any[];
      const docs = db.prepare(`SELECT d.*, a.ref FROM documents d LEFT JOIN applications a ON a.id=d.application_id WHERE ${D.sql} AND d.is_current=1 AND d.expiry_date IS NOT NULL ORDER BY d.expiry_date`).all(...D.params) as any[];
      const upcoming = unds.filter(u => ['pending', 'returned'].includes(u.status) && daysBetween(today, u.due_date) >= 0 && daysBetween(today, u.due_date) <= 30);
      const overdue = unds.filter(u => effectiveStatus(db, u, today) === 'overdue');
      const exp = docs.filter(d => daysBetween(today, d.expiry_date) <= 60);
      const tasks = db.prepare(`SELECT t.*, a.ref FROM tasks t JOIN applications a ON a.id=t.application_id WHERE ${T.sql} AND t.status='open' AND t.role='institution' ORDER BY t.due_date`).all(...T.params) as any[];
      cards.push(
        { key: 'apps', label: 'Applications', value: mine.length, link: '/applications' },
        { key: 'inprog', label: 'In progress', value: mine.filter(a => a.status === 'in_progress').length, tone: 'neutral', link: '/applications?status=in_progress' },
        { key: 'def', label: 'Need your response', value: mine.filter(a => a.status === 'returned').length, tone: tone(mine.filter(a => a.status === 'returned').length, 'warn'), link: '/applications?status=returned' },
        { key: 'upc', label: 'Obligations due in 30 days', value: upcoming.length, tone: upcoming.length ? 'warn' : 'good', link: '/compliance' },
        { key: 'ovr', label: 'Overdue obligations', value: overdue.length, tone: tone(overdue.length), link: '/compliance?status=overdue' },
        { key: 'exp', label: 'Documents expiring or expired', value: exp.length, tone: exp.length ? 'warn' : 'good', link: '/documents?expiry=60' });
      charts.push({ key: 'stages', title: 'Your applications by stage', type: 'bar', data: Object.entries(mine.reduce((g: any, a) => { const k = a.status === 'draft' ? 'Draft' : a.stage ?? a.status; g[k] = (g[k] ?? 0) + 1; return g; }, {})).map(([name, value]) => ({ name, value })) });
      lists.push(
        { key: 'actions', title: 'Pending actions', columns: [{ key: 'title', label: 'Task' }, { key: 'due_date', label: 'Due' }, { key: 'days', label: 'Days left' }], rows: tasks.map(t => ({ title: t.title, due_date: t.due_date, days: t.due_date ? daysBetween(today, t.due_date) : '', link: `/applications/${t.application_id}` })), empty: 'Nothing is waiting for you right now.' },
        { key: 'deadlines', title: 'Upcoming deadlines', columns: [{ key: 'what', label: 'Item' }, { key: 'date', label: 'Date' }, { key: 'state', label: 'State' }],
          rows: [...unds.filter(u => ['pending', 'returned'].includes(u.status)).map(u => ({ what: `${u.code}: ${u.condition_text}`, date: u.due_date, state: effectiveStatus(db, u, today).replace(/_/g, ' '), link: '/compliance' })),
            ...docs.filter(d => daysBetween(today, d.expiry_date) <= 90).map(d => ({ what: `${docName(d.doc_type)} expiry (${docCode(d.id)})`, date: d.expiry_date, state: daysBetween(today, d.expiry_date) < 0 ? 'expired' : 'expiring', link: '/documents' }))].sort((a, b) => a.date.localeCompare(b.date)).slice(0, 20), empty: 'No upcoming deadlines.' },
        { key: 'subs', title: 'Submission history', columns: [{ key: 'ref', label: 'Application' }, { key: 'kind', label: 'Type' }, { key: 'docs', label: 'Documents' }, { key: 'at', label: 'Submitted' }],
          rows: (db.prepare(`SELECT a.ref, a.title, s.kind, s.version, s.snapshot, substr(s.submitted_at,1,10) AS at, a.id AS app FROM application_submissions s JOIN applications a ON a.id=s.application_id WHERE ${A.sql} ORDER BY s.id DESC LIMIT 20`).all(...A.params) as any[])
            .map(({ snapshot, ...r }) => ({ ...r, kind: r.kind === 'initial' ? 'Initial submission' : `Resubmission (version ${r.version})`, docs: submissionDocs(snapshot).map(x => x.display_name).join(', ') || 'No documents recorded', link: `/applications/${r.app}` })), empty: 'No submissions yet.' });
      break;
    }
    case 'regional_officer': {
      const apps = pendingApps(db, user), avg = stageDurations(db, user), all = Object.values(avg).flat();
      cards.push(
        { key: 'total', label: 'Applications in your Region', value: one(db, `SELECT COUNT(*) c FROM applications a WHERE ${A.sql}`, ...A.params), link: '/applications' },
        { key: 'scrut', label: 'Awaiting scrutiny', value: apps.filter(a => a.current_stage === 'scrutiny').length, link: '/applications?stage=scrutiny' },
        { key: 'ret', label: 'Returned for clarification', value: apps.filter(a => a.status === 'returned').length, tone: 'neutral', link: '/applications?status=returned' },
        { key: 'evc', label: 'In EVC scheduling queue', value: one(db, `SELECT COUNT(*) c FROM evc_schedules e WHERE ${E.sql} AND e.status='queued'`, ...E.params), link: '/evc' },
        { key: 'ovr', label: 'Overdue cases', value: apps.filter(a => a.due_status === 'overdue').length, tone: tone(apps.filter(a => a.due_status === 'overdue').length), link: '/applications?deadline=overdue' },
        { key: 'soon', label: 'Approaching deadline', value: apps.filter(a => a.due_status === 'due_soon').length, tone: 'warn', link: '/applications?deadline=due_soon' },
        { key: 'avg', label: 'Average stage duration (days)', value: all.length ? round1(all.reduce((a, b) => a + b, 0) / all.length) : 0, hint: 'Completed stages' },
        { key: 'auto_work', label: 'Work done automatically', value: manualWorkSaved(db, user, '30').total, hint: 'Calculated from synthetic demonstration data.' });
      charts.push({ key: 'stages', title: 'Pending by stage', type: 'bar', data: byStage() },
        { key: 'workload', title: 'Officer workload (open tasks)', type: 'bar', data: db.prepare(`SELECT us.name AS name, COUNT(*) AS value FROM tasks t JOIN users us ON us.id=t.assigned_user_id WHERE ${T.sql} AND t.status='open' GROUP BY us.id ORDER BY value DESC`).all(...T.params) });
      lists.push(
        { key: 'ovr', title: 'Overdue cases', columns: [{ key: 'ref', label: 'Application' }, { key: 'institution', label: 'Institution' }, { key: 'stage', label: 'Stage' }, { key: 'days', label: 'Days overdue' }],
          rows: apps.filter(a => a.due_status === 'overdue').sort((a, b) => a.days_to_due - b.days_to_due).slice(0, 8).map(a => ({ ref: a.ref, institution: a.institution_name, stage: a.stage_name ?? a.current_stage, days: -a.days_to_due, link: `/applications/${a.id}` })), empty: 'No overdue cases in your Region.' },
        { key: 'recent', title: 'Recent actions', columns: [{ key: 'at', label: 'When' }, { key: 'ref', label: 'Application' }, { key: 'what', label: 'Action' }, { key: 'who', label: 'By' }],
          rows: db.prepare(`SELECT substr(h.at,1,16) AS at, a.ref, h.action AS what, h.actor_label AS who, a.id AS app FROM stage_history h JOIN applications a ON a.id=h.application_id WHERE ${A.sql} ORDER BY h.id DESC LIMIT 8`).all(...A.params).map((r: any) => ({ ...r, at: r.at.replace('T', ' '), what: r.what.replace(/_/g, ' '), link: `/applications/${r.app}` })), empty: 'No recent actions.' },
        { key: 'esc', title: 'Escalations to you', columns: [{ key: 'reason', label: 'Reason' }, { key: 'level', label: 'Level' }, { key: 'status', label: 'Status' }], rows: db.prepare(`SELECT reason, level, status FROM escalation_events x WHERE x.recipient_user_id=? ORDER BY CASE status WHEN 'open' THEN 0 ELSE 1 END, id DESC LIMIT 6`).all(user.id).map((r: any) => ({ ...r, link: '/escalations' })), empty: 'No escalations.' });
      break;
    }
    case 'bureau_officer': case 'competent_authority': case 'admin': {
      if (user.role === 'admin') return adminDashboard(db, user, base);
      const apps = pendingApps(db, user);
      if (user.role === 'bureau_officer') {
        const longDays = 30;
        cards.push(
          { key: 'pend', label: 'Pending applications', value: apps.length, link: '/applications' },
          { key: 'ovr', label: 'Overdue', value: apps.filter(a => a.due_status === 'overdue').length, tone: tone(apps.filter(a => a.due_status === 'overdue').length), link: '/applications?deadline=overdue' },
          { key: 'long', label: `Pending over ${longDays} days`, value: apps.filter(a => a.age_days > longDays).length, tone: 'warn' },
          { key: 'otasks', label: 'Overdue tasks', value: one(db, `SELECT COUNT(*) c FROM tasks t WHERE t.status='open' AND t.due_date < ?`, today), tone: 'bad' },
          { key: 'esc', label: 'Open escalations to you', value: one(db, `SELECT COUNT(*) c FROM escalation_events WHERE status='open' AND recipient_user_id=?`, user.id), tone: 'warn', link: '/escalations' },
          { key: 'sac', label: 'At SAC/SHC stage', value: apps.filter(a => a.current_stage === 'sac_shc').length },
          { key: 'auto_work', label: 'Work done automatically', value: manualWorkSaved(db, user, '30').total, hint: 'Calculated from synthetic demonstration data.' });
        const trend = (db.prepare(`SELECT substr(submitted_at,1,7) AS name, COUNT(*) AS value FROM applications WHERE submitted_at IS NOT NULL GROUP BY 1 ORDER BY 1`).all() as any[]);
        charts.push({ key: 'stages', title: 'Stage-wise pendency', type: 'bar', data: byStage() },
          { key: 'regions', title: 'Region-wise workload (pending)', type: 'bar', data: Object.entries(apps.reduce((g: any, a) => { g[a.region_name] = (g[a.region_name] ?? 0) + 1; return g; }, {})).map(([name, value]) => ({ name, value })) },
          { key: 'trend', title: 'Submissions per month', type: 'line', data: trend },
          { key: 'roles', title: 'Workload by responsible role (open tasks)', type: 'bar', data: db.prepare(`SELECT role AS name, COUNT(*) AS value FROM tasks WHERE status='open' GROUP BY role`).all() });
        lists.push({ key: 'long', title: 'Longest pending cases', columns: [{ key: 'ref', label: 'Application' }, { key: 'institution', label: 'Institution' }, { key: 'stage', label: 'Stage' }, { key: 'age', label: 'Age (days)' }],
          rows: [...apps].sort((a, b) => b.age_days - a.age_days).slice(0, 8).map(a => ({ ref: a.ref, institution: a.institution_name, stage: a.stage_name ?? a.current_stage, age: a.age_days, link: `/applications/${a.id}` })), empty: 'No pending cases.' },
          { key: 'esc', title: 'Escalated cases', columns: [{ key: 'reason', label: 'Reason' }, { key: 'level', label: 'Level' }, { key: 'days', label: 'Days overdue' }], rows: db.prepare(`SELECT reason, level, overdue_days AS days FROM escalation_events WHERE status='open' AND recipient_user_id=? ORDER BY overdue_days DESC LIMIT 8`).all(user.id).map((r: any) => ({ ...r, link: '/escalations' })), empty: 'Nothing escalated to you.' });
      } else {
        const waiting = apps.filter(a => a.current_stage === 'decision');
        cards.push(
          { key: 'wait', label: 'Awaiting your decision', value: waiting.length, link: '/applications?stage=decision' },
          { key: 'ovr', label: 'Decisions overdue', value: waiting.filter(a => a.due_status === 'overdue').length, tone: tone(waiting.filter(a => a.due_status === 'overdue').length) },
          { key: 'esc', label: 'Open escalations to you', value: one(db, `SELECT COUNT(*) c FROM escalation_events WHERE status='open' AND recipient_user_id=?`, user.id), tone: 'warn', link: '/escalations' },
          { key: 'done', label: 'Decided in the last 30 days', value: one(db, `SELECT COUNT(*) c FROM applications WHERE completed_at >= ?`, addCalendarDays(today, -30)) },
          { key: 'auto_work', label: 'Work done automatically', value: manualWorkSaved(db, user, '30').total, hint: 'Calculated from synthetic demonstration data.' });
        charts.push({ key: 'out', title: 'Outcomes', type: 'bar', data: db.prepare(`SELECT status AS name, COUNT(*) AS value FROM applications WHERE status IN ('approved','rejected','withdrawn') GROUP BY status`).all() });
        lists.push({ key: 'wait', title: 'Cases awaiting decision', columns: [{ key: 'ref', label: 'Application' }, { key: 'institution', label: 'Institution' }, { key: 'age', label: 'Age (days)' }, { key: 'due', label: 'Deadline' }],
          rows: waiting.sort((a, b) => (a.days_to_due ?? 0) - (b.days_to_due ?? 0)).map(a => ({ ref: a.ref, institution: a.institution_name, age: a.age_days, due: a.stage_due_date, link: `/applications/${a.id}` })), empty: 'No cases are waiting for a decision.' },
          { key: 'esc', title: 'Escalated cases', columns: [{ key: 'reason', label: 'Reason' }, { key: 'level', label: 'Level' }, { key: 'days', label: 'Days overdue' }], rows: db.prepare(`SELECT reason, level, overdue_days AS days FROM escalation_events WHERE status='open' AND recipient_user_id=? ORDER BY overdue_days DESC LIMIT 8`).all(user.id).map((r: any) => ({ ...r, link: '/escalations' })), empty: 'Nothing escalated to you.' });
      }
      break;
    }
    case 'evc_coordinator': {
      const rows = (db.prepare(`SELECT e.*, a.ref, i.name AS inst, c.name AS committee FROM evc_schedules e JOIN applications a ON a.id=e.application_id JOIN institutions i ON i.id=e.institution_id LEFT JOIN evc_committees c ON c.id=e.committee_id WHERE ${E.sql} AND a.status<>'draft'`).all(...E.params) as any[]).map(e => ({ ...e, ...evcState(e, today) }));
      const active = rows.filter(e => e.status !== 'completed');
      const queued = active.filter(e => e.status === 'queued');
      cards.push(
        { key: 'req', label: 'Applications requiring EVC', value: active.length, link: '/evc' },
        { key: 'ready', label: 'Ready for scheduling', value: queued.length, tone: queued.length ? 'warn' : 'good', link: '/evc?status=queued' },
        { key: 'up', label: 'Visits in the next 14 days', value: active.filter(e => e.confirmed_date && e.confirmed_date >= today && e.confirmed_date <= addCalendarDays(today, 14)).length },
        { key: 'unsched', label: 'Unscheduled and due within 3 days', value: queued.filter(e => e.schedule_deadline <= soon).length, tone: queued.filter(e => e.schedule_deadline <= soon).length ? 'bad' : 'good' },
        { key: 'del', label: 'Delayed', value: active.filter(e => e.overdue).length, tone: tone(active.filter(e => e.overdue).length), link: '/evc?status=overdue' },
        { key: 'comp', label: 'Visits completed', value: rows.filter(e => e.status === 'completed').length });
      charts.push({ key: 'status', title: 'EVC records by state', type: 'bar', data: Object.entries(rows.reduce((g: any, e) => { g[e.state] = (g[e.state] ?? 0) + 1; return g; }, {})).map(([name, value]) => ({ name, value })) },
        { key: 'committee', title: 'Committee load (next 30 days)', type: 'bar', data: db.prepare(`SELECT c.name AS name, COUNT(e.id) AS value FROM evc_committees c LEFT JOIN evc_schedules e ON e.committee_id=c.id AND e.status IN ('scheduled','rescheduled') AND e.confirmed_date BETWEEN ? AND ? WHERE c.region_id=? GROUP BY c.id`).all(today, addCalendarDays(today, 30), user.region_id) });
      lists.push({ key: 'up', title: 'Upcoming visits', columns: [{ key: 'ref', label: 'Application' }, { key: 'inst', label: 'Institution' }, { key: 'date', label: 'Date' }, { key: 'committee', label: 'Committee' }],
        rows: active.filter(e => e.confirmed_date).sort((a, b) => a.confirmed_date.localeCompare(b.confirmed_date)).slice(0, 8).map(e => ({ ref: e.ref, inst: e.inst, date: e.confirmed_date, committee: e.committee, link: '/evc' })), empty: 'No visits scheduled.' },
        { key: 'q', title: 'Unscheduled cases by deadline', columns: [{ key: 'ref', label: 'Application' }, { key: 'inst', label: 'Institution' }, { key: 'by', label: 'Schedule by' }, { key: 'days', label: 'Days left' }],
          rows: queued.sort((a, b) => a.schedule_deadline.localeCompare(b.schedule_deadline)).slice(0, 8).map(e => ({ ref: e.ref, inst: e.inst, by: e.schedule_deadline, days: daysBetween(today, e.schedule_deadline), link: '/evc' })), empty: 'Nothing waiting to be scheduled.' });
      break;
    }
  }
  return { ...base, cards, charts, lists };
}

function adminDashboard(db: DB, user: User, base: any) {
  const chain = verifyAuditChain(db);
  const last = db.prepare('SELECT * FROM job_runs ORDER BY id DESC LIMIT 1').get() as any;
  const failed7 = one(db, `SELECT COUNT(*) c FROM job_runs WHERE status IN ('failed','partial') AND started_at >= ?`, new Date(Date.now() - 7 * 86400000).toISOString());
  return { ...base,
    cards: [
      { key: 'apps', label: 'Applications (synthetic)', value: one(db, `SELECT COUNT(*) c FROM applications`), link: '/applications' },
      { key: 'users', label: 'Active users', value: one(db, `SELECT COUNT(*) c FROM users WHERE active=1`), link: '/admin' },
      { key: 'wf', label: 'Active workflow versions', value: one(db, `SELECT COUNT(*) c FROM workflow_versions WHERE active=1`), link: '/workflows' },
      { key: 'rules', label: 'Active escalation rules', value: one(db, `SELECT COUNT(*) c FROM escalation_rules WHERE active=1`), link: '/admin' },
      { key: 'jobs', label: 'Job runs with problems (7 days)', value: failed7, tone: tone(failed7) },
      { key: 'fail', label: 'Emails abandoned after retries', value: one(db, `SELECT COUNT(*) c FROM notification_deliveries WHERE status='abandoned'`), tone: 'warn' },
      { key: 'reg_review', label: 'Regulatory rules needing review', value: one(db, `SELECT COUNT(*) c FROM regulatory_rules WHERE flagged_for_review=1`), tone: 'warn', link: '/rules?flagged=1' },
      { key: 'audit', label: 'Audit events', value: one(db, `SELECT COUNT(*) c FROM audit_log`), link: '/audit' },
      { key: 'auto_work', label: 'Work done automatically', value: manualWorkSaved(db, user, '30').total, hint: 'Calculated from synthetic demonstration data.' }],
    charts: [{ key: 'status', title: 'Applications by status', type: 'bar', data: db.prepare(`SELECT status AS name, COUNT(*) AS value FROM applications GROUP BY status`).all() },
      { key: 'roles', title: 'Users by role', type: 'bar', data: db.prepare(`SELECT role AS name, COUNT(*) AS value FROM users WHERE active=1 GROUP BY role`).all() }],
    lists: [
      { key: 'audit', title: 'Recent audit events', columns: [{ key: 'at', label: 'When' }, { key: 'type', label: 'Event' }, { key: 'actor', label: 'Actor' }], rows: db.prepare(`SELECT substr(at,1,16) AS at, event_type AS type, actor_label AS actor FROM audit_log ORDER BY id DESC LIMIT 8`).all().map((r: any) => ({ ...r, at: r.at.replace('T', ' '), link: '/audit' })), empty: 'No events.' },
      { key: 'jobs', title: 'Recent scheduled job runs', columns: [{ key: 'at', label: 'Started' }, { key: 'trigger', label: 'Trigger' }, { key: 'status', label: 'Status' }], rows: db.prepare(`SELECT substr(started_at,1,16) AS at, trigger, status FROM job_runs ORDER BY id DESC LIMIT 6`).all().map((r: any) => ({ ...r, at: r.at.replace('T', ' ') })), empty: 'No runs yet.' }],
    health: { database: 'ok', audit_chain: chain.ok ? 'intact' : `broken at event ${chain.brokenAtId}`, audit_events_checked: chain.checked, last_job: last ? { status: last.status, at: last.started_at } : null, clock_pinned: clock.isPinned(), clock_today: clock.today() } };
}

// ---------------------------------------------------------------- compliance calendar
export function calendarEvents(db: DB, user: User, from: string, to: string, types?: string[]) {
  const today = clock.today(), out: any[] = [];
  const want = (t: string) => !types?.length || types.includes(t);
  const U = scope(user, 'u'), D = scope(user, 'd'), E = scope(user, 'e'), T = scope(user, 't');
  if (want('undertaking')) for (const u of db.prepare(`SELECT u.*, i.name AS inst FROM undertakings u JOIN institutions i ON i.id=u.institution_id WHERE ${U.sql} AND u.due_date BETWEEN ? AND ?`).all(...U.params, from, to) as any[])
    out.push({ date: u.due_date, type: 'undertaking', title: `${u.code}: ${u.condition_text}`, institution: u.inst, status: effectiveStatus(db, u, today), link: '/compliance' });
  if (want('document')) for (const d of db.prepare(`SELECT d.*, i.name AS inst FROM documents d JOIN institutions i ON i.id=d.institution_id WHERE ${D.sql} AND d.is_current=1 AND d.expiry_date BETWEEN ? AND ?`).all(...D.params, from, to) as any[])
    out.push({ date: d.expiry_date, type: 'document', title: `${docName(d.doc_type)} expires (${docCode(d.id)})`, institution: d.inst, status: d.expiry_date < today ? 'expired' : 'upcoming', link: '/documents' });
  if (want('evc')) for (const e of db.prepare(`SELECT e.*, a.ref, i.name AS inst FROM evc_schedules e JOIN applications a ON a.id=e.application_id JOIN institutions i ON i.id=e.institution_id WHERE ${E.sql} AND a.status<>'draft' AND e.status<>'cancelled'`).all(...E.params) as any[]) {
    if (e.confirmed_date && e.confirmed_date >= from && e.confirmed_date <= to) out.push({ date: e.confirmed_date, type: 'evc', title: `EVC visit: ${e.ref}`, institution: e.inst, status: e.status, link: '/evc' });
    if (e.status === 'queued' && e.schedule_deadline >= from && e.schedule_deadline <= to) out.push({ date: e.schedule_deadline, type: 'evc', title: `Schedule EVC by: ${e.ref}`, institution: e.inst, status: e.schedule_deadline < today ? 'overdue' : 'queued', link: '/evc' });
  }
  if (want('clarification')) for (const t of db.prepare(`SELECT t.*, a.ref, i.name AS inst FROM tasks t JOIN applications a ON a.id=t.application_id JOIN institutions i ON i.id=t.institution_id WHERE ${T.sql} AND t.status='open' AND t.role='institution' AND t.due_date BETWEEN ? AND ?`).all(...T.params, from, to) as any[])
    out.push({ date: t.due_date, type: 'clarification', title: `Respond to clarification: ${t.ref}`, institution: t.inst, status: t.due_date < today ? 'overdue' : 'upcoming', link: `/applications/${t.application_id}` });
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

// ---------------------------------------------------------------- predictive pendency (forecast, not a verdict)
export function pendencyForecast(db: DB, user: User, onlyAppId?: number) {
  const today = clock.today();
  const hist = stageDurations(db, null);
  const apps = pendingApps(db, user, onlyAppId ? { id: String(onlyAppId) } : {}).filter(a => a.status === 'in_progress' && a.stage_due_date);
  const loadByRole = Object.fromEntries((db.prepare(`SELECT assigned_user_id AS id, COUNT(*) AS c FROM tasks WHERE status='open' GROUP BY assigned_user_id`).all() as any[]).map(r => [r.id, r.c]));
  const rows = apps.map(a => {
    const samples = hist[a.current_stage] ?? [];
    const expected = samples.length >= 3 ? median(samples) : null;
    const elapsed = a.days_in_stage;
    const remaining = expected !== null ? Math.max(expected - elapsed, 1) : null;
    const projected = remaining !== null ? addCalendarDays(today, Math.ceil(remaining)) : null;
    const factors: string[] = [`${elapsed} day(s) already spent in this stage`, `deadline ${a.stage_due_date}`];
    let risk: 'confirmed_overdue' | 'likely_late' | 'watch' | 'on_track' = 'on_track';
    if (a.due_status === 'overdue') { risk = 'confirmed_overdue'; factors.push(`already ${-a.days_to_due} day(s) past the deadline`); }
    else if (projected && projected > a.stage_due_date) { risk = 'likely_late'; factors.push(`historical median for this stage is ${round1(expected!)} days (n=${samples.length}), projecting completion around ${projected}`); }
    else if (a.days_to_due <= 3) { risk = 'watch'; factors.push(`only ${a.days_to_due} day(s) left`); }
    else if (expected !== null) factors.push(`historical median for this stage is ${round1(expected)} days (n=${samples.length})`);
    else factors.push('too little history for this stage to estimate a duration (needs at least 3 completed stays)');
    if (a.assigned_user_id && loadByRole[a.assigned_user_id] >= 6) factors.push(`assigned officer currently has ${loadByRole[a.assigned_user_id]} open tasks`);
    return { id: a.id, ref: a.ref, institution: a.institution_name, region: a.region_name, stage: a.stage_name ?? a.current_stage, due: a.stage_due_date, days_to_due: a.days_to_due, risk, projected_completion: projected, factors, confidence: samples.length >= 8 ? 'medium' : 'low' };
  });
  const rank = { confirmed_overdue: 0, likely_late: 1, watch: 2, on_track: 3 } as const;
  return { notice: 'Forecast based on historical (synthetic) stage durations. "Likely late" is an estimate, not a confirmed overdue status.', rows: rows.sort((a, b) => rank[a.risk] - rank[b.risk] || a.days_to_due - b.days_to_due) };
}

// ---------------------------------------------------------------- rule-based administrative assistant
// Deliberately not an LLM. It maps a fixed set of questions to the same permission-scoped queries the rest of the app uses.
const REF = /AF-\d{4}-\d{5}/i;
export function askAssistant(db: DB, user: User, question: string) {
  const q = question.toLowerCase(), today = clock.today();
  const refs: { type: string; id: number; label: string; link: string }[] = [];
  const facts: string[] = [], suggestions: string[] = [];
  const A = appScope(user, 'a');
  const ref = question.match(REF)?.[0]?.toUpperCase();
  const appRef = (a: any) => { refs.push({ type: 'application', id: a.id, label: a.ref, link: `/applications/${a.id}` }); return a.ref; };
  const done = (title: string) => ({ title, facts, suggestions, references: refs, source: 'rule-based', notice: 'This assistant is rule-based, not a language model. It reads only data you are allowed to see, never changes anything, and cannot make approval or rejection decisions.' });

  if (ref) {
    const a = db.prepare(`SELECT a.* FROM applications a WHERE a.ref=? AND ${A.sql}`).get(ref, ...A.params) as any;
    if (!a) return (facts.push(`No application ${ref} is visible to you.`), done('Application not found'));
    const info = ageInfo(db, a, today), name = appRef(a);
    const stage = a.workflow_version_id ? (db.prepare('SELECT * FROM workflow_stages WHERE version_id=? AND key=?').get(a.workflow_version_id, a.current_stage) as any) : null;
    const tasks = db.prepare(`SELECT t.*, u.name AS who FROM tasks t LEFT JOIN users u ON u.id=t.assigned_user_id WHERE t.application_id=? AND t.status='open'`).all(a.id) as any[];
    const actions = availableActions(db, user, a);
    if (/next action|what should|what action|what can i/.test(q)) {
      facts.push(`${name} is at "${stage?.name ?? a.status}".`);
      if (!actions.length) facts.push('You have no workflow action available for this application at this stage.');
      for (const x of actions) { facts.push(`Available to you: "${x.label}"${x.requires_reason ? ' (needs a reason)' : ''}.`); for (const p of x.prerequisites.filter(p => !p.met)) facts.push(`Not yet met for "${x.label}": ${p.label}.`); }
      suggestions.push('Open the application to take the action. The assistant never performs it for you.');
      return done(`Next actions for ${name}`);
    }
    if (/why|pending|stuck|delay/.test(q) && !/summar|outstanding/.test(q)) {
      facts.push(`${name} is ${a.status.replace('_', ' ')}${stage ? ` at "${stage.name}"` : ''}; it has been in this stage for ${info.days_in_stage} day(s).`);
      if (stage) facts.push(`The stage is owned by ${stage.responsible_role.replace('_', ' ')}${tasks[0]?.who ? ` (${tasks[0].who})` : ''}.`);
      if (a.stage_due_date) facts.push(`Stage deadline ${a.stage_due_date}: ${info.due_status === 'overdue' ? `${-(info.days_to_due ?? 0)} day(s) overdue` : `${info.days_to_due} day(s) left`}.`);
      const evc = db.prepare('SELECT * FROM evc_schedules WHERE application_id=? ORDER BY id DESC LIMIT 1').get(a.id) as any;
      if (stage?.is_evc && evc) facts.push(`EVC state: ${evcState(evc, today).state}${evc.confirmed_date ? `, visit ${evc.confirmed_date}` : ', not yet scheduled'}.`);
      if (!tasks.length && a.status === 'returned') facts.push('It is waiting for the institution to respond.');
      suggestions.push(info.due_status === 'overdue' ? 'Overdue cases are escalated automatically under the configured rules; check the Escalations page.' : 'No action beyond the stage owner completing their task.');
      return done(`Why ${name} is pending`);
    }
    facts.push(`${name}: ${a.title}.`, `Status: ${a.status.replace('_', ' ')}${stage ? ` at "${stage.name}"` : ''}; age ${info.age_days} day(s).`);
    for (const t of tasks) facts.push(`Open task: ${t.title} (${t.role.replace('_', ' ')}${t.due_date ? `, due ${t.due_date}` : ''}).`);
    for (const u of db.prepare(`SELECT * FROM undertakings WHERE application_id=? AND status IN ('pending','returned','submitted','under_verification')`).all(a.id) as any[]) facts.push(`Obligation ${u.code}: ${effectiveStatus(db, u, today).replace(/_/g, ' ')}, due ${u.due_date}.`);
    return done(`Outstanding actions for ${name}`);
  }
  if (/backlog|largest|biggest/.test(q)) {
    const g: Record<string, number> = {}; for (const a of pendingApps(db, user)) g[a.stage_name ?? a.current_stage] = (g[a.stage_name ?? a.current_stage] ?? 0) + 1;
    const top = Object.entries(g).sort((a, b) => b[1] - a[1]);
    top.slice(0, 5).forEach(([s, n]) => facts.push(`${s}: ${n} pending application(s).`));
    if (!top.length) facts.push('No pending applications in your scope.');
    return done('Stage-wise backlog');
  }
  if (/overdue/.test(q) && !/compliance|undertaking|obligation|document|lease/.test(q)) {
    const rows = pendingApps(db, user).filter(a => a.due_status === 'overdue').sort((a, b) => a.days_to_due - b.days_to_due);
    facts.push(`${rows.length} application(s) are past their stage deadline.`);
    rows.slice(0, 10).forEach(a => facts.push(`${appRef(a)} (${a.institution_name}) at ${a.stage_name ?? a.current_stage}: ${-a.days_to_due} day(s) overdue.`));
    return done('Overdue applications');
  }
  if (/longest|oldest/.test(q) || /scrutiny/.test(q)) {
    const rows = pendingApps(db, user).filter(a => a.current_stage === 'scrutiny').sort((a, b) => b.days_in_stage - a.days_in_stage);
    facts.push(`${rows.length} application(s) are in scrutiny.`);
    rows.slice(0, 8).forEach(a => facts.push(`${appRef(a)} (${a.institution_name}): ${a.days_in_stage} day(s) in scrutiny.`));
    return done('Longest in scrutiny');
  }
  if (/evc|visit/.test(q)) {
    const E = scope(user, 'e');
    const rows = (db.prepare(`SELECT e.*, a.ref FROM evc_schedules e JOIN applications a ON a.id=e.application_id WHERE ${E.sql} AND e.status='queued' ORDER BY e.schedule_deadline LIMIT 10`).all(...E.params) as any[]);
    facts.push(`${rows.length} EVC visit(s) are waiting to be scheduled.`);
    rows.forEach(e => { refs.push({ type: 'evc', id: e.id, label: e.ref, link: '/evc' }); facts.push(`${e.ref}: schedule by ${e.schedule_deadline} (${daysBetween(today, e.schedule_deadline) < 0 ? `${-daysBetween(today, e.schedule_deadline)} day(s) late` : `${daysBetween(today, e.schedule_deadline)} day(s) left`}).`); });
    if (rows.length) suggestions.push('Open EVC Scheduling and use "Suggest slots" for the earliest free committee dates.');
    return done('EVC visits to schedule');
  }
  if (/lease|document|expir/.test(q)) {
    const D = scope(user, 'd');
    const rows = db.prepare(`SELECT d.*, i.name AS inst FROM documents d JOIN institutions i ON i.id=d.institution_id WHERE ${D.sql} AND d.is_current=1 AND d.expiry_date IS NOT NULL AND d.expiry_date <= ? ORDER BY d.expiry_date LIMIT 12`).all(...D.params, addCalendarDays(today, 60)) as any[];
    facts.push(`${rows.length} document(s) have expired or expire within 60 days.`);
    rows.forEach(d => { refs.push({ type: 'document', id: d.id, label: `${docName(d.doc_type)}, ${docCode(d.id)} (${d.inst})`, link: '/documents' }); const l = daysBetween(today, d.expiry_date); facts.push(`${d.inst}: ${docName(d.doc_type)} (${docCode(d.id)}) ${l < 0 ? `expired ${-l} day(s) ago` : `expires in ${l} day(s)`} (${d.expiry_date}).`); });
    return done('Documents expiring soon');
  }
  if (/compliance|undertaking|obligation|deadline/.test(q)) {
    const U = scope(user, 'u');
    const rows = (db.prepare(`SELECT u.*, i.name AS inst FROM undertakings u JOIN institutions i ON i.id=u.institution_id WHERE ${U.sql} AND u.status IN ('pending','returned') AND u.due_date <= ? ORDER BY u.due_date LIMIT 12`).all(...U.params, addCalendarDays(today, 30)) as any[]);
    facts.push(`${rows.length} obligation(s) are overdue or due within 30 days.`);
    rows.forEach(u => { refs.push({ type: 'undertaking', id: u.id, label: u.code, link: '/compliance' }); const l = daysBetween(today, u.due_date); facts.push(`${u.inst}: ${u.code} ${l < 0 ? `overdue by ${-l} day(s)` : `due in ${l} day(s)`}.`); });
    return done('Compliance deadlines');
  }
  facts.push('I can answer questions such as:', '"Which applications are overdue?"', '"Which applications have been in scrutiny the longest?"', '"Which EVCs need scheduling?"', '"Which compliance deadlines are coming up?"', '"Which leases are expiring soon?"', '"Which stage has the largest backlog?"', '"Why is AF-2026-00007 pending?"', '"What is the next action for AF-2026-00007?"');
  return done('What I can help with');
}
void getNumberSetting;
