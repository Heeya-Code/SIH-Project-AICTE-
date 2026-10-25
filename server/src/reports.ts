import type { DB } from './db';
import { appScope, scope, type User } from './auth';
import { clock, istDate } from './clock';
import { addCalendarDays, daysBetween, getNumberSetting, median, round1 } from './util';
import { ageInfo } from './workflow';
import { effectiveStatus } from './compliance';
import { evcState } from './evc';
import { docName, docCode } from './docnames';

export type Column = { key: string; label: string };
export type ReportResult = { columns: Column[]; rows: Record<string, any>[]; chart?: { type: 'bar' | 'line'; x: string; series: { key: string; label: string }[] } };
type Filters = Record<string, string | undefined>;
type Def = { key: string; title: string; description: string; filters: string[]; roles?: string[]; run: (db: DB, u: User, f: Filters) => ReportResult };

const OPEN = `a.status IN ('in_progress','returned')`;

function appFilters(u: User, f: Filters, alias = 'a') {
  const s = appScope(u, alias);
  const where = [s.sql], params: any[] = [...s.params];
  if (f.id) { where.push(`${alias}.id=?`); params.push(Number(f.id)); }
  if (f.region_id) { where.push(`${alias}.region_id=?`); params.push(Number(f.region_id)); }
  if (f.institution_id) { where.push(`${alias}.institution_id=?`); params.push(Number(f.institution_id)); }
  if (f.stage) { where.push(`${alias}.current_stage=?`); params.push(f.stage); }
  if (f.category) { where.push(`${alias}.category_code=?`); params.push(f.category); }
  if (f.status) { where.push(`${alias}.status=?`); params.push(f.status); }
  if (f.from) { where.push(`${alias}.submitted_at >= ?`); params.push(f.from); }
  if (f.to) { where.push(`${alias}.submitted_at < ?`); params.push(addCalendarDays(f.to, 1)); }
  return { where: where.join(' AND '), params };
}

export function pendingApps(db: DB, u: User, f: Filters = {}) {
  const w = appFilters(u, f);
  return (db.prepare(`SELECT a.*, r.name AS region_name, i.name AS institution_name, c.name AS category_name, us.name AS assigned_name, st.name AS stage_name
    FROM applications a JOIN regions r ON r.id=a.region_id JOIN institutions i ON i.id=a.institution_id JOIN application_categories c ON c.code=a.category_code
    LEFT JOIN users us ON us.id=a.assigned_user_id LEFT JOIN workflow_stages st ON st.version_id=a.workflow_version_id AND st.key=a.current_stage
    WHERE ${OPEN} AND ${w.where}`).all(...w.params) as any[]).map(a => ({ ...a, ...ageInfo(db, a) }));
}

// Completed stage durations (days), derived from consecutive stage_history rows. Used by reports, the dashboard and the forecast.
export function stageDurations(db: DB, u: User | null, f: Filters = {}) {
  const w = u ? appFilters(u, { ...f, stage: undefined, status: undefined }) : { where: '1=1', params: [] as any[] };
  const rows = db.prepare(`SELECT h.application_id, h.to_stage, h.at FROM stage_history h JOIN applications a ON a.id=h.application_id WHERE ${w.where} ORDER BY h.application_id, h.id`).all(...w.params) as any[];
  const by: Record<string, number[]> = {};
  for (let i = 0; i < rows.length - 1; i++) {
    if (rows[i].application_id !== rows[i + 1].application_id) continue;
    const days = (Date.parse(rows[i + 1].at) - Date.parse(rows[i].at)) / 86400000;
    (by[rows[i].to_stage] ??= []).push(days);
  }
  return by;
}

const stageNames = (db: DB) => Object.fromEntries((db.prepare(`SELECT s.key, s.name FROM workflow_stages s JOIN workflow_versions v ON v.id=s.version_id WHERE v.active=1`).all() as any[]).map(r => [r.key, r.name]));

export const REPORTS: Def[] = [
  { key: 'pendency_region', title: 'Application pendency by Region', description: 'Open applications, overdue cases and average age per Region.', filters: ['category', 'stage'],
    run: (db, u, f) => {
      const g: Record<string, any> = {};
      for (const a of pendingApps(db, u, f)) { const x = (g[a.region_name] ??= { region: a.region_name, pending: 0, overdue: 0, due_soon: 0, age: 0 }); x.pending++; x.age += a.age_days; if (a.due_status === 'overdue') x.overdue++; if (a.due_status === 'due_soon') x.due_soon++; }
      const rows = Object.values(g).map(x => ({ region: x.region, pending: x.pending, overdue: x.overdue, due_soon: x.due_soon, avg_age_days: round1(x.age / x.pending) })).sort((a, b) => b.pending - a.pending);
      return { columns: [{ key: 'region', label: 'Region' }, { key: 'pending', label: 'Pending' }, { key: 'overdue', label: 'Overdue' }, { key: 'due_soon', label: 'Due soon' }, { key: 'avg_age_days', label: 'Avg age (days)' }], rows,
        chart: { type: 'bar', x: 'region', series: [{ key: 'pending', label: 'Pending' }, { key: 'overdue', label: 'Overdue' }] } };
    } },
  { key: 'pendency_stage', title: 'Application pendency by workflow stage', description: 'Where open applications are currently sitting.', filters: ['region_id', 'category'],
    run: (db, u, f) => {
      const names = stageNames(db), g: Record<string, any> = {};
      for (const a of pendingApps(db, u, f)) { const x = (g[a.current_stage] ??= { stage: names[a.current_stage] ?? a.current_stage, pending: 0, overdue: 0, days: 0 }); x.pending++; x.days += a.days_in_stage; if (a.due_status === 'overdue') x.overdue++; }
      const rows = Object.values(g).map(x => ({ stage: x.stage, pending: x.pending, overdue: x.overdue, avg_days_in_stage: round1(x.days / x.pending) })).sort((a, b) => b.pending - a.pending);
      return { columns: [{ key: 'stage', label: 'Stage' }, { key: 'pending', label: 'Pending' }, { key: 'overdue', label: 'Overdue' }, { key: 'avg_days_in_stage', label: 'Avg days in stage' }], rows,
        chart: { type: 'bar', x: 'stage', series: [{ key: 'pending', label: 'Pending' }, { key: 'overdue', label: 'Overdue' }] } };
    } },
  { key: 'overdue_applications', title: 'Applications exceeding configured deadlines', description: 'Open applications whose current stage deadline has passed.', filters: ['region_id', 'category', 'stage'],
    run: (db, u, f) => ({
      columns: [{ key: 'ref', label: 'Application' }, { key: 'institution', label: 'Institution' }, { key: 'region', label: 'Region' }, { key: 'stage', label: 'Stage' }, { key: 'owner', label: 'Assigned to' }, { key: 'due', label: 'Deadline' }, { key: 'days_overdue', label: 'Days overdue' }],
      rows: pendingApps(db, u, f).filter(a => a.due_status === 'overdue').sort((a, b) => a.days_to_due - b.days_to_due)
        .map(a => ({ ref: a.ref, institution: a.institution_name, region: a.region_name, stage: a.stage_name ?? a.current_stage, owner: a.assigned_name ?? '(institution)', due: a.stage_due_date, days_overdue: -a.days_to_due })) }) },
  { key: 'stage_duration', title: 'Average and median processing time by stage', description: 'Completed stage durations in days, from stage history.', filters: ['region_id', 'category', 'from', 'to'],
    run: (db, u, f) => {
      const names = stageNames(db), by = stageDurations(db, u, f);
      const rows = Object.entries(by).map(([k, d]) => ({ stage: names[k] ?? k, completed: d.length, avg_days: round1(d.reduce((a, b) => a + b, 0) / d.length), median_days: round1(median(d)), max_days: round1(Math.max(...d)) })).sort((a, b) => b.avg_days - a.avg_days);
      return { columns: [{ key: 'stage', label: 'Stage' }, { key: 'completed', label: 'Completed stays' }, { key: 'avg_days', label: 'Average (days)' }, { key: 'median_days', label: 'Median (days)' }, { key: 'max_days', label: 'Longest (days)' }], rows,
        chart: { type: 'bar', x: 'stage', series: [{ key: 'avg_days', label: 'Average' }, { key: 'median_days', label: 'Median' }] } };
    } },
  { key: 'officer_workload', title: 'Officer workload distribution', description: 'Open tasks per responsible officer.', filters: ['region_id'], roles: ['regional_officer', 'bureau_officer', 'evc_coordinator', 'competent_authority', 'admin'],
    run: (db, u, f) => {
      const s = scope(u, 't'), today = clock.today(), params: any[] = [...s.params];
      let extra = ''; if (f.region_id) { extra = ' AND t.region_id=?'; params.push(Number(f.region_id)); }
      const rows = (db.prepare(`SELECT us.name AS officer, us.role, rg.name AS region, COUNT(*) AS open_tasks,
          SUM(CASE WHEN t.due_date < ? THEN 1 ELSE 0 END) AS overdue, SUM(CASE WHEN t.due_date BETWEEN ? AND ? THEN 1 ELSE 0 END) AS due_soon
        FROM tasks t JOIN users us ON us.id=t.assigned_user_id LEFT JOIN regions rg ON rg.id=us.region_id WHERE t.status='open' AND ${s.sql}${extra} GROUP BY us.id ORDER BY open_tasks DESC`)
        .all(today, today, addCalendarDays(today, 3), ...params) as any[]);
      return { columns: [{ key: 'officer', label: 'Officer' }, { key: 'role', label: 'Role' }, { key: 'region', label: 'Region' }, { key: 'open_tasks', label: 'Open tasks' }, { key: 'overdue', label: 'Overdue' }, { key: 'due_soon', label: 'Due in 3 days' }], rows,
        chart: { type: 'bar', x: 'officer', series: [{ key: 'open_tasks', label: 'Open' }, { key: 'overdue', label: 'Overdue' }] } };
    } },
  { key: 'evc_status', title: 'EVC scheduling and completion status', description: 'Every EVC record with its current state.', filters: ['region_id'],
    run: (db, u, f) => {
      const s = scope(u, 'e'), today = clock.today(), params: any[] = [...s.params];
      let extra = ''; if (f.region_id) { extra = ' AND e.region_id=?'; params.push(Number(f.region_id)); }
      const rows = (db.prepare(`SELECT e.*, a.ref, i.name AS inst, rg.name AS region, c.name AS committee FROM evc_schedules e JOIN applications a ON a.id=e.application_id JOIN institutions i ON i.id=e.institution_id JOIN regions rg ON rg.id=e.region_id
        LEFT JOIN evc_committees c ON c.id=e.committee_id WHERE ${s.sql} AND a.status <> 'draft'${extra} ORDER BY COALESCE(e.confirmed_date, e.schedule_deadline)`).all(...params) as any[])
        .map(e => { const st = evcState(e, today); return { ref: e.ref, institution: e.inst, region: e.region, state: st.state, detail: st.reason ?? '', schedule_deadline: e.schedule_deadline, visit_date: e.confirmed_date ?? '', committee: e.committee ?? '', reschedules: e.reschedule_count, completed: e.visit_date ?? '' }; });
      return { columns: [{ key: 'ref', label: 'Application' }, { key: 'institution', label: 'Institution' }, { key: 'region', label: 'Region' }, { key: 'state', label: 'State' }, { key: 'detail', label: 'Note' }, { key: 'schedule_deadline', label: 'Schedule by' }, { key: 'visit_date', label: 'Visit date' }, { key: 'committee', label: 'Committee' }, { key: 'reschedules', label: 'Reschedules' }], rows };
    } },
  { key: 'undertaking_compliance', title: 'Undertaking compliance status', description: 'Obligation status per institution, with the share verified.', filters: ['region_id', 'institution_id'],
    run: (db, u, f) => {
      const s = scope(u, 'u'), today = clock.today(), params: any[] = [...s.params];
      let extra = ''; if (f.region_id) { extra += ' AND u.region_id=?'; params.push(Number(f.region_id)); } if (f.institution_id) { extra += ' AND u.institution_id=?'; params.push(Number(f.institution_id)); }
      const g: Record<string, any> = {};
      for (const x of db.prepare(`SELECT u.*, i.name AS inst, rg.name AS region FROM undertakings u JOIN institutions i ON i.id=u.institution_id JOIN regions rg ON rg.id=u.region_id WHERE ${s.sql}${extra}`).all(...params) as any[]) {
        const e = (g[x.inst] ??= { institution: x.inst, region: x.region, total: 0, verified: 0, submitted: 0, overdue: 0, due_soon: 0, upcoming: 0, returned: 0 });
        const st = effectiveStatus(db, x, today); e.total++;
        if (st === 'verified' || st === 'closed') e.verified++; else if (st === 'submitted' || st === 'under_verification') e.submitted++; else if (st === 'overdue') e.overdue++; else if (st === 'due_soon') e.due_soon++; else if (st === 'returned_for_correction') e.returned++; else e.upcoming++;
      }
      const rows = Object.values(g).map((e: any) => ({ ...e, verified_pct: Math.round((e.verified / e.total) * 100) })).sort((a: any, b: any) => b.overdue - a.overdue);
      return { columns: [{ key: 'institution', label: 'Institution' }, { key: 'region', label: 'Region' }, { key: 'total', label: 'Total' }, { key: 'verified', label: 'Verified' }, { key: 'submitted', label: 'Awaiting review' }, { key: 'returned', label: 'Returned' }, { key: 'due_soon', label: 'Due soon' }, { key: 'upcoming', label: 'Upcoming' }, { key: 'overdue', label: 'Overdue' }, { key: 'verified_pct', label: 'Verified %' }], rows,
        chart: { type: 'bar', x: 'institution', series: [{ key: 'verified', label: 'Verified' }, { key: 'overdue', label: 'Overdue' }] } };
    } },
  { key: 'documents_validity', title: 'Upcoming and expired documents', description: 'Current document versions that have expired or expire within the chosen window (default 90 days).', filters: ['region_id', 'institution_id', 'doc_type', 'window'],
    run: (db, u, f) => {
      const s = scope(u, 'd'), today = clock.today(), params: any[] = [...s.params];
      let extra = ''; if (f.region_id) { extra += ' AND d.region_id=?'; params.push(Number(f.region_id)); } if (f.institution_id) { extra += ' AND d.institution_id=?'; params.push(Number(f.institution_id)); } if (f.doc_type) { extra += ' AND d.doc_type=?'; params.push(f.doc_type); }
      const win = Number(f.window ?? 90);
      const rows = (db.prepare(`SELECT d.*, i.name AS inst, rg.name AS region FROM documents d JOIN institutions i ON i.id=d.institution_id JOIN regions rg ON rg.id=d.region_id
        WHERE d.is_current=1 AND d.expiry_date IS NOT NULL AND d.expiry_date <= ? AND ${s.sql}${extra} ORDER BY d.expiry_date`).all(addCalendarDays(today, win), ...params) as any[])
        .map(d => ({ institution: d.inst, region: d.region, doc_type: docName(d.doc_type), doc_id: docCode(d.id), reference: d.reference_no ?? '', version: d.version, expiry_date: d.expiry_date, days_left: daysBetween(today, d.expiry_date), renewal: d.renewal_status.replace(/_/g, ' '), verification: d.verification_status }));
      return { columns: [{ key: 'institution', label: 'Institution' }, { key: 'region', label: 'Region' }, { key: 'doc_type', label: 'Document' }, { key: 'doc_id', label: 'Document ID' }, { key: 'reference', label: 'Reference' }, { key: 'version', label: 'Version' }, { key: 'expiry_date', label: 'Expiry' }, { key: 'days_left', label: 'Days left' }, { key: 'renewal', label: 'Renewal' }, { key: 'verification', label: 'Verification' }], rows };
    } },
  { key: 'overdue_compliance', title: 'Overdue compliance obligations', description: 'Obligations past their due date without accepted evidence.', filters: ['region_id', 'institution_id'],
    run: (db, u, f) => {
      const s = scope(u, 'u'), today = clock.today(), params: any[] = [...s.params];
      let extra = ''; if (f.region_id) { extra += ' AND u.region_id=?'; params.push(Number(f.region_id)); } if (f.institution_id) { extra += ' AND u.institution_id=?'; params.push(Number(f.institution_id)); }
      const rows = (db.prepare(`SELECT u.*, i.name AS inst, rg.name AS region FROM undertakings u JOIN institutions i ON i.id=u.institution_id JOIN regions rg ON rg.id=u.region_id WHERE u.status IN ('pending','returned') AND u.due_date < ? AND ${s.sql}${extra} ORDER BY u.due_date`).all(today, ...params) as any[])
        .map(x => ({ code: x.code, institution: x.inst, region: x.region, condition: x.condition_text, due_date: x.due_date, days_overdue: daysBetween(x.due_date, today), status: x.status }));
      return { columns: [{ key: 'code', label: 'Obligation' }, { key: 'institution', label: 'Institution' }, { key: 'region', label: 'Region' }, { key: 'condition', label: 'Condition' }, { key: 'due_date', label: 'Due' }, { key: 'days_overdue', label: 'Days overdue' }, { key: 'status', label: 'Status' }], rows };
    } },
  { key: 'escalation_history', title: 'Escalation history', description: 'Escalations raised by the configured rules, and what happened to them.', filters: ['region_id', 'from', 'to'], roles: ['regional_officer', 'bureau_officer', 'evc_coordinator', 'competent_authority', 'admin'],
    run: (db, u, f) => {
      const s = scope(u, 'x'), params: any[] = [...s.params]; let extra = '';
      if (f.region_id) { extra += ' AND x.region_id=?'; params.push(Number(f.region_id)); } if (f.from) { extra += ' AND x.triggered_at >= ?'; params.push(f.from); } if (f.to) { extra += ' AND x.triggered_at < ?'; params.push(addCalendarDays(f.to, 1)); }
      const rows = (db.prepare(`SELECT x.*, i.name AS inst, ru.name AS recipient, ru.role AS recipient_role FROM escalation_events x JOIN institutions i ON i.id=x.institution_id JOIN users ru ON ru.id=x.recipient_user_id WHERE ${s.sql}${extra} ORDER BY x.triggered_at DESC LIMIT 2000`).all(...params) as any[])
        .map(x => ({ triggered: x.triggered_at.slice(0, 10), type: x.trigger_type.replace(/_/g, ' '), level: x.level, institution: x.inst, recipient: `${x.recipient} (${x.recipient_role.replace('_', ' ')})`, overdue_days: x.overdue_days, status: x.status, reason: x.reason }));
      return { columns: [{ key: 'triggered', label: 'Date' }, { key: 'type', label: 'Type' }, { key: 'level', label: 'Level' }, { key: 'institution', label: 'Institution' }, { key: 'recipient', label: 'Recipient' }, { key: 'overdue_days', label: 'Days overdue' }, { key: 'status', label: 'Status' }, { key: 'reason', label: 'Reason' }], rows };
    } },
  { key: 'notification_delivery', title: 'Notification delivery performance', description: 'Delivery outcomes by channel. Email is simulated in this prototype.', filters: [], roles: ['bureau_officer', 'admin'],
    run: (db) => {
      const rows = (db.prepare(`SELECT n.event, d.channel, COUNT(*) AS total, SUM(d.status IN ('sent','simulated_sent')) AS delivered, SUM(d.status='failed') AS retrying, SUM(d.status='abandoned') AS abandoned, SUM(d.status='pending') AS pending, ROUND(AVG(d.attempts),2) AS avg_attempts
        FROM notification_deliveries d JOIN notifications n ON n.id=d.notification_id GROUP BY n.event, d.channel ORDER BY total DESC`).all() as any[]).map(r => ({ ...r, delivered_pct: Math.round((r.delivered / r.total) * 100) }));
      return { columns: [{ key: 'event', label: 'Event' }, { key: 'channel', label: 'Channel' }, { key: 'total', label: 'Total' }, { key: 'delivered', label: 'Delivered' }, { key: 'pending', label: 'Pending' }, { key: 'retrying', label: 'Retrying' }, { key: 'abandoned', label: 'Abandoned' }, { key: 'delivered_pct', label: 'Delivered %' }, { key: 'avg_attempts', label: 'Avg attempts' }], rows };
    } },
  { key: 'transition_history', title: 'Workflow transition history', description: 'Every stage change with actor, time and reason.', filters: ['region_id', 'category', 'from', 'to'],
    run: (db, u, f) => {
      const w = appFilters(u, { ...f, from: undefined, to: undefined }); const params = [...w.params]; let extra = '';
      if (f.from) { extra += ' AND h.at >= ?'; params.push(f.from); } if (f.to) { extra += ' AND h.at < ?'; params.push(addCalendarDays(f.to, 1)); }
      const rows = (db.prepare(`SELECT h.*, a.ref, i.name AS inst FROM stage_history h JOIN applications a ON a.id=h.application_id JOIN institutions i ON i.id=a.institution_id WHERE ${w.where}${extra} ORDER BY h.id DESC LIMIT 3000`).all(...params) as any[])
        .map(h => ({ at: h.at.replace('T', ' ').slice(0, 16), ref: h.ref, institution: h.inst, from: h.from_stage ?? '(new)', to: h.to_stage, action: h.action.replace(/_/g, ' '), actor: h.actor_label, auto: h.auto ? 'yes' : '', reason: h.reason ?? '' }));
      return { columns: [{ key: 'at', label: 'When (UTC)' }, { key: 'ref', label: 'Application' }, { key: 'institution', label: 'Institution' }, { key: 'from', label: 'From' }, { key: 'to', label: 'To' }, { key: 'action', label: 'Action' }, { key: 'actor', label: 'Actor' }, { key: 'auto', label: 'Auto' }, { key: 'reason', label: 'Reason' }], rows };
    } },
  { key: 'processing_trends', title: 'Overall processing-time trends', description: 'Applications submitted and completed per month, with average time to completion.', filters: ['region_id', 'category'],
    run: (db, u, f) => {
      const w = appFilters(u, { ...f, from: undefined, to: undefined }); const g: Record<string, any> = {};
      for (const a of db.prepare(`SELECT a.submitted_at, a.completed_at FROM applications a WHERE a.submitted_at IS NOT NULL AND ${w.where}`).all(...w.params) as any[]) {
        const sm = istDate(new Date(a.submitted_at)).slice(0, 7); (g[sm] ??= { month: sm, submitted: 0, completed: 0, days: 0, n: 0 }).submitted++;
        if (a.completed_at) { const cm = istDate(new Date(a.completed_at)).slice(0, 7); const c = (g[cm] ??= { month: cm, submitted: 0, completed: 0, days: 0, n: 0 }); c.completed++; c.days += daysBetween(istDate(new Date(a.submitted_at)), istDate(new Date(a.completed_at))); c.n++; }
      }
      const rows = Object.values(g).sort((a: any, b: any) => a.month.localeCompare(b.month)).map((x: any) => ({ month: x.month, submitted: x.submitted, completed: x.completed, avg_days_to_complete: x.n ? round1(x.days / x.n) : '' }));
      return { columns: [{ key: 'month', label: 'Month' }, { key: 'submitted', label: 'Submitted' }, { key: 'completed', label: 'Completed' }, { key: 'avg_days_to_complete', label: 'Avg days to complete' }], rows, chart: { type: 'line', x: 'month', series: [{ key: 'submitted', label: 'Submitted' }, { key: 'completed', label: 'Completed' }] } };
    } },
  { key: 'applications_register', title: 'Application register', description: 'All applications visible to you. Use the filters, then export.', filters: ['region_id', 'category', 'stage', 'status', 'from', 'to'],
    run: (db, u, f) => {
      const w = appFilters(u, f);
      const rows = (db.prepare(`SELECT a.*, i.name AS inst, r.name AS region, c.name AS category FROM applications a JOIN institutions i ON i.id=a.institution_id JOIN regions r ON r.id=a.region_id JOIN application_categories c ON c.code=a.category_code WHERE ${w.where} ORDER BY a.id DESC LIMIT 5000`).all(...w.params) as any[])
        .map(a => { const x = ageInfo(db, a); return { ref: a.ref, institution: a.inst, region: a.region, category: a.category, status: a.status.replace('_', ' '), stage: a.current_stage ?? '', submitted: a.submitted_at?.slice(0, 10) ?? '', age_days: x.age_days, deadline: a.stage_due_date ?? '', deadline_state: x.due_status.replace('_', ' ') }; });
      return { columns: [{ key: 'ref', label: 'Application' }, { key: 'institution', label: 'Institution' }, { key: 'region', label: 'Region' }, { key: 'category', label: 'Category' }, { key: 'status', label: 'Status' }, { key: 'stage', label: 'Stage' }, { key: 'submitted', label: 'Submitted' }, { key: 'age_days', label: 'Age (days)' }, { key: 'deadline', label: 'Deadline' }, { key: 'deadline_state', label: 'Deadline state' }], rows };
    } },
];

export const reportsFor = (u: User) => REPORTS.filter(r => !r.roles || r.roles.includes(u.role));
void getNumberSetting;
