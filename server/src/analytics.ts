import type { DB } from './db';
import { appScope, scope, type User } from './auth';
import { clock, istDate } from './clock';
import { addCalendarDays, daysBetween, getDaysSetting, getNumberSetting, median, round1 } from './util';
import { ageInfo, requiredDocs } from './workflow';
import { pendingApps, stageDurations } from './reports';
import { candidates } from './escalation';
import { pendencyForecast } from './insights';
import { docName, docCode } from './docnames';

type F = Record<string, string | undefined>;
const OPEN = `a.status IN ('in_progress','returned')`;

function where(u: User, f: F, alias = 'a') {
  const s = appScope(u, alias); const w = [s.sql], p: any[] = [...s.params];
  if (f.region_id) { w.push(`${alias}.region_id=?`); p.push(Number(f.region_id)); }
  if (f.category) { w.push(`${alias}.category_code=?`); p.push(f.category); }
  if (f.from) { w.push(`${alias}.submitted_at >= ?`); p.push(f.from); }
  if (f.to) { w.push(`${alias}.submitted_at < ?`); p.push(addCalendarDays(f.to, 1)); }
  return { sql: w.join(' AND '), params: p };
}

const stageNames = (db: DB) => Object.fromEntries((db.prepare(`SELECT s.key, s.name FROM workflow_stages s JOIN workflow_versions v ON v.id=s.version_id WHERE v.active=1`).all() as any[]).map(r => [r.key, r.name]));

// Every number returned here is a query over the stored records ("calculated"). The only illustrative block is `forecast`, labelled as such.
export function buildAnalytics(db: DB, user: User, f: F) {
  const today = clock.today(); const W = where(user, f);
  const names = stageNames(db);
  const group = (col: string, join = '', label = col) => (db.prepare(`SELECT ${col} AS key, ${label} AS label, COUNT(*) AS value FROM applications a ${join} WHERE ${W.sql} GROUP BY ${col} ORDER BY value DESC`).all(...W.params) as any[]);
  const one = (sql: string, ...p: any[]) => (db.prepare(sql).get(...p) as any).c as number;

  const open = pendingApps(db, user, { region_id: f.region_id, category: f.category, from: f.from, to: f.to });
  const stall = getNumberSetting(db, 'stall_days', 21);
  const totals = {
    applications: one(`SELECT COUNT(*) c FROM applications a WHERE ${W.sql} AND a.status<>'draft'`, ...W.params),
    drafts: one(`SELECT COUNT(*) c FROM applications a WHERE ${W.sql} AND a.status='draft'`, ...W.params),
    open: open.length, completed: one(`SELECT COUNT(*) c FROM applications a WHERE ${W.sql} AND a.status IN ('approved','rejected','withdrawn')`, ...W.params),
    overdue_open: open.filter(a => a.due_status === 'overdue').length, due_soon_open: open.filter(a => a.due_status === 'due_soon').length,
    unassigned_open: open.filter(a => a.status === 'in_progress' && !a.assigned_user_id).length,
    stalled_open: open.filter(a => a.status === 'in_progress' && a.days_in_stage >= stall).length,
    synthetic: one(`SELECT COUNT(*) c FROM applications a WHERE ${W.sql} AND a.synthetic=1`, ...W.params),
  };
  const status = group('a.status').map(r => ({ ...r, label: r.key.replace('_', ' '), drill: { status: r.key } }));
  const category = group('a.category_code', 'JOIN application_categories c ON c.code=a.category_code', 'c.name').map(r => ({ ...r, label: String(r.label).replace(/ \(demo( route)?\)/, ''), drill: { category: r.key } }));
  const region = group('a.region_id', 'JOIN regions r ON r.id=a.region_id', 'r.name').map(r => ({ ...r, drill: { region_id: r.key } }));
  const byStage: Record<string, number> = {}; for (const a of open) byStage[a.current_stage] = (byStage[a.current_stage] ?? 0) + 1;
  const stage = Object.entries(byStage).map(([k, v]) => ({ key: k, label: names[k] ?? k, value: v, drill: { stage: k, open: '1' } })).sort((a, b) => b.value - a.value);

  // time spent at each stage: completed stays from history, plus how long today's open cases have been waiting
  const hist = stageDurations(db, user, { region_id: f.region_id, category: f.category, from: f.from, to: f.to });
  const stage_time = Object.keys({ ...hist, ...byStage }).filter(k => !['approved', 'rejected', 'withdrawn'].includes(k)).map(k => {
    const d = hist[k] ?? [], o = open.filter(a => a.current_stage === k);
    return { key: k, label: names[k] ?? k, completed_stays: d.length, median_days: d.length ? round1(median(d)) : null, avg_days: d.length ? round1(d.reduce((a, b) => a + b, 0) / d.length) : null, open_now: o.length, open_avg_age_days: o.length ? round1(o.reduce((s, a) => s + a.days_in_stage, 0) / o.length) : null };
  }).sort((a, b) => b.open_now - a.open_now);

  // overdue actions and upcoming deadlines
  const T = scope(user, 't'), U = scope(user, 'u'), D = scope(user, 'd'), E = scope(user, 'e');
  const rfilter = (alias: string) => (f.region_id ? { sql: ` AND ${alias}.region_id=?`, p: [Number(f.region_id)] } : { sql: '', p: [] as any[] });
  const rt = rfilter('t'), ru = rfilter('u'), rd = rfilter('d'), re = rfilter('e');
  const overdue_actions = {
    stage_tasks: one(`SELECT COUNT(*) c FROM tasks t WHERE ${T.sql}${rt.sql} AND t.status='open' AND t.type<>'evc' AND t.due_date < ?`, ...T.params, ...rt.p, today),
    evc: stateEvcOverdue(db, E, re, today),
    obligations: one(`SELECT COUNT(*) c FROM undertakings u WHERE ${U.sql}${ru.sql} AND u.status IN ('pending','returned') AND u.due_date < ?`, ...U.params, ...ru.p, today),
    expired_documents: one(`SELECT COUNT(*) c FROM documents d WHERE ${D.sql}${rd.sql} AND d.is_current=1 AND d.expiry_date < ?`, ...D.params, ...rd.p, today),
  };
  const upcoming = [
    ...(db.prepare(`SELECT t.id, t.title AS what, t.due_date AS date, a.ref, a.id AS app FROM tasks t JOIN applications a ON a.id=t.application_id WHERE ${T.sql}${rt.sql} AND t.status='open' AND t.due_date BETWEEN ? AND ?`).all(...T.params, ...rt.p, today, addCalendarDays(today, 14)) as any[])
      .map(r => ({ type: 'stage deadline', what: r.what, date: r.date, link: `/applications/${r.app}` })),
    ...(db.prepare(`SELECT u.code, u.condition_text, u.due_date FROM undertakings u WHERE ${U.sql}${ru.sql} AND u.status IN ('pending','returned') AND u.due_date BETWEEN ? AND ?`).all(...U.params, ...ru.p, today, addCalendarDays(today, 14)) as any[])
      .map(r => ({ type: 'obligation', what: `${r.code}: ${r.condition_text}`, date: r.due_date, link: '/compliance' })),
    ...(db.prepare(`SELECT d.id, d.doc_type, d.expiry_date FROM documents d WHERE ${D.sql}${rd.sql} AND d.is_current=1 AND d.expiry_date BETWEEN ? AND ?`).all(...D.params, ...rd.p, today, addCalendarDays(today, 14)) as any[])
      .map(r => ({ type: 'document expiry', what: `${docName(r.doc_type)} (${docCode(r.id)})`, date: r.expiry_date, link: '/documents?expiry=30' })),
  ].sort((a, b) => a.date.localeCompare(b.date));
  const dq = (lo: number, hi: number) => one(`SELECT COUNT(*) c FROM documents d WHERE ${D.sql}${rd.sql} AND d.is_current=1 AND d.expiry_date BETWEEN ? AND ?`, ...D.params, ...rd.p, addCalendarDays(today, lo), addCalendarDays(today, hi));
  const documents = { expired: overdue_actions.expired_documents, within_30: dq(0, 30), within_60: dq(31, 60), within_90: dq(61, 90) };
  const evcRows = db.prepare(`SELECT e.* FROM evc_schedules e JOIN applications a ON a.id=e.application_id WHERE ${E.sql}${re.sql} AND a.status<>'draft'`).all(...E.params, ...re.p) as any[];
  const evc = { queued: 0, scheduled: 0, rescheduled: 0, completed: 0, overdue: overdue_actions.evc, rescheduled_visits: evcRows.filter(e => e.reschedule_count > 0).length } as Record<string, number>;
  for (const e of evcRows) evc[e.status] = (evc[e.status] ?? 0) + 1;

  // officer workload (open tasks), plus work that nobody owns
  const workload_rows = db.prepare(`SELECT u.id, u.name, u.role, rg.name AS region, COUNT(*) AS open,
      SUM(CASE WHEN t.due_date < ? THEN 1 ELSE 0 END) AS overdue FROM tasks t JOIN users u ON u.id=t.assigned_user_id LEFT JOIN regions rg ON rg.id=u.region_id
      WHERE ${T.sql}${rt.sql} AND t.status='open' GROUP BY u.id ORDER BY open DESC`).all(today, ...T.params, ...rt.p) as any[];
  const regionalOpen = workload_rows.filter(w => w.role === 'regional_officer').map(w => w.open);
  const imbalance = regionalOpen.length > 1 ? { max: Math.max(...regionalOpen), min: Math.min(...regionalOpen), ratio: round1(Math.max(...regionalOpen) / Math.max(1, Math.min(...regionalOpen))) } : null;
  const workload = { officers: workload_rows.map(w => ({ ...w, drill: { assigned_user_id: String(w.id), open: '1' } })), unassigned_open: totals.unassigned_open, imbalance,
    note: imbalance ? `Among regional officers the busiest has ${imbalance.max} open tasks and the least busy has ${imbalance.min} (ratio ${imbalance.ratio}).` : 'Not enough officers in scope to compare workload.' };

  // historical processing time (submitted to finished), by month finished
  const done = db.prepare(`SELECT a.submitted_at, a.completed_at, a.status FROM applications a WHERE ${W.sql} AND a.completed_at IS NOT NULL AND a.submitted_at IS NOT NULL`).all(...W.params) as any[];
  const months: Record<string, { n: number; days: number[]; approved: number }> = {};
  for (const a of done) { const m = istDate(new Date(a.completed_at)).slice(0, 7); const x = (months[m] ??= { n: 0, days: [], approved: 0 }); x.n++; x.days.push(daysBetween(istDate(new Date(a.submitted_at)), istDate(new Date(a.completed_at)))); if (a.status === 'approved') x.approved++; }
  const processing_time = Object.entries(months).sort().map(([m, x]) => ({ month: m, finished: x.n, approved: x.approved, median_days: round1(median(x.days)), avg_days: round1(x.days.reduce((a, b) => a + b, 0) / x.n) }));

  // bottleneck indicators: a transparent score from three measured ratios
  const maxOpen = Math.max(1, ...Object.values(byStage));
  const bottlenecks = Object.entries(byStage).map(([k, n]) => {
    const o = open.filter(a => a.current_stage === k), overdue = o.filter(a => a.due_status === 'overdue').length, h = hist[k] ?? [];
    const avgAge = o.reduce((s, a) => s + a.days_in_stage, 0) / o.length, med = h.length >= 5 ? median(h) : null;
    const share = overdue / n, ageRatio = med ? avgAge / Math.max(med, 0.5) : null;
    const score = Math.round((0.5 * share + 0.3 * Math.min((ageRatio ?? 1) / 2, 1) + 0.2 * (n / maxOpen)) * 100) / 100;
    const explanation = [`${overdue} of ${n} open case(s) at this stage are past their deadline (${Math.round(share * 100)}%).`,
      med ? `Open cases have waited ${round1(avgAge)} days on average here; completed stays took a median of ${round1(med)} days (${h.length} completed stays).` : `Open cases have waited ${round1(avgAge)} days on average; there are fewer than 5 completed stays, so no historical comparison is made.`,
      `This stage holds ${Math.round((n / Math.max(1, open.length)) * 100)}% of all open cases.`];
    return { key: k, label: names[k] ?? k, score, level: score >= 0.6 ? 'high' : score >= 0.35 ? 'medium' : 'low', open: n, overdue, overdue_share: Math.round(share * 100), avg_open_age_days: round1(avgAge), median_completed_days: med ? round1(med) : null, explanation, drill: { stage: k, open: '1' } };
  }).sort((a, b) => b.score - a.score);

  const fc = ['regional_officer', 'bureau_officer', 'competent_authority', 'admin'].includes(user.role) ? pendencyForecast(db, user) : null;
  return {
    generated_at: clock.iso(), today, filters: f, data_origin: totals.synthetic === totals.applications + totals.drafts ? 'All records in this view are synthetic demonstration data.' : 'This view mixes synthetic and user-entered records.',
    kinds: { calculated: 'Computed from stored records at the time of the request.', forecast: 'Illustrative estimate; not a confirmed status.' },
    totals, by_status: status, by_category: category, by_region: region, by_stage: stage, stage_time, overdue_actions, upcoming_deadlines: upcoming.slice(0, 40), documents, evc, workload, processing_time,
    bottlenecks: { kind: 'calculated', method: 'Score = 50% share of open cases that are overdue + 30% (average wait / historical median, capped at 2×) + 20% share of the busiest stage\'s open count. Level thresholds (0.35 medium, 0.6 high) are demonstration values.', rows: bottlenecks },
    forecast: fc ? { kind: 'forecast', notice: fc.notice, likely_late: fc.rows.filter((r: any) => r.risk === 'likely_late').length, watch: fc.rows.filter((r: any) => r.risk === 'watch').length, confirmed_overdue: fc.rows.filter((r: any) => r.risk === 'confirmed_overdue').length } : null,
  };
}

function stateEvcOverdue(db: DB, E: { sql: string; params: any[] }, re: { sql: string; p: any[] }, today: string) {
  return (db.prepare(`SELECT COUNT(*) c FROM evc_schedules e WHERE ${E.sql}${re.sql} AND e.status IN ('queued','scheduled','rescheduled') AND ((e.status='queued' AND e.schedule_deadline < ?) OR (e.status<>'queued' AND e.confirmed_date < ?) OR (e.completion_deadline IS NOT NULL AND e.completion_deadline < ?))`)
    .get(...E.params, ...re.p, today, today, today) as any).c as number;
}

// ---------------------------------------------------------------------------------------------------------------- alerts
export type Alert = { rule: string; severity: 'high' | 'medium' | 'low'; title: string; entity: string; link: string; region_id: number | null; evidence: string[]; at?: string };

export const ALERT_RULES = (db: DB) => {
  const stall = getNumberSetting(db, 'stall_days', 21), docWindow = Math.max(...getDaysSetting(db, 'reminder_days_document', [30, 7, 1])), soon = getNumberSetting(db, 'due_soon_days', 3);
  return [
    { id: 'DEADLINE_OVERDUE', title: 'Stage deadline passed', logic: 'An open application\'s stage deadline is before today.', threshold: 'Deadline set by the workflow stage (demonstration value)', basis: 'configurable' },
    { id: 'DEADLINE_SOON', title: 'Stage deadline approaching', logic: `The stage deadline falls within ${soon} day(s).`, threshold: `${soon} days (setting due_soon_days)`, basis: 'configurable' },
    { id: 'DOC_EXPIRED', title: 'Document expired', logic: 'The current version of a document has an expiry date before today and has not been renewed.', threshold: 'Recorded expiry date', basis: 'recorded data' },
    { id: 'DOC_EXPIRING', title: 'Document expiring', logic: `The current version expires within ${docWindow} day(s).`, threshold: `${docWindow} days (largest reminder interval)`, basis: 'configurable' },
    { id: 'MISSING_DOCUMENT', title: 'Required document missing or returned', logic: 'A submitted or draft application lacks a required document for its category, or its current copy was returned by a reviewer.', threshold: 'Document requirements of the category (see basis on the Rules page)', basis: 'configured requirements' },
    { id: 'STALLED', title: 'Case stalled at a stage', logic: `An in-progress case has been in its current stage for ${stall} day(s) or more.`, threshold: `${stall} days (setting stall_days)`, basis: 'configurable' },
    { id: 'UNASSIGNED', title: 'In-progress case has no assignee', logic: 'The case is in progress, owned by an officer role, and no officer is assigned.', threshold: 'None', basis: 'recorded data' },
    { id: 'ESCALATION_ELIGIBLE', title: 'Escalation due or about to be due', logic: 'An overdue item has reached (or will reach within 3 days) the delay set in an active escalation rule, and no escalation exists for it yet.', threshold: 'Delays in the escalation rules (demonstration values)', basis: 'configurable' },
  ];
};

export function computeAlerts(db: DB, user: User, f: F = {}): Alert[] {
  const today = clock.today(); const out: Alert[] = [];
  const stall = getNumberSetting(db, 'stall_days', 21), docWindow = Math.max(...getDaysSetting(db, 'reminder_days_document', [30, 7, 1]));
  const names = stageNames(db);
  const inRegion = (rid: number | null) => !f.region_id || rid === Number(f.region_id);
  const apps = pendingApps(db, user, { region_id: f.region_id });
  for (const a of apps) {
    const link = `/applications/${a.id}`, ent = a.ref;
    if (a.due_status === 'overdue') out.push({ rule: 'DEADLINE_OVERDUE', severity: -a.days_to_due > 14 ? 'high' : 'medium', title: `${a.ref} is ${-a.days_to_due} day(s) past its deadline`, entity: ent, link, region_id: a.region_id, evidence: [`Stage: ${names[a.current_stage] ?? a.current_stage}`, `Deadline: ${a.stage_due_date}`, `Days in stage: ${a.days_in_stage}`] });
    else if (a.due_status === 'due_soon') out.push({ rule: 'DEADLINE_SOON', severity: 'low', title: `${a.ref} is due in ${a.days_to_due} day(s)`, entity: ent, link, region_id: a.region_id, evidence: [`Stage: ${names[a.current_stage] ?? a.current_stage}`, `Deadline: ${a.stage_due_date}`] });
    if (a.status === 'in_progress' && a.days_in_stage >= stall) out.push({ rule: 'STALLED', severity: a.days_in_stage >= stall * 2 ? 'high' : 'medium', title: `${a.ref} has not moved for ${a.days_in_stage} days`, entity: ent, link, region_id: a.region_id, evidence: [`Stage: ${names[a.current_stage] ?? a.current_stage}`, `Entered stage: ${a.stage_entered_at.slice(0, 10)}`, `Threshold: ${stall} days`, a.assigned_name ? `Assigned to ${a.assigned_name}` : 'Nobody is assigned'] });
    if (a.status === 'in_progress' && !a.assigned_user_id) out.push({ rule: 'UNASSIGNED', severity: 'high', title: `${a.ref} has no assigned officer`, entity: ent, link, region_id: a.region_id, evidence: [`Stage: ${names[a.current_stage] ?? a.current_stage}`, `Region: ${a.region_name}`, 'No active officer with the required role exists for this Region or none was selected.'] });
  }
  // missing / returned documents (drafts included for institutions; officers see submitted cases only)
  const A = appScope(user, 'a');
  for (const a of db.prepare(`SELECT a.* FROM applications a WHERE ${A.sql} AND a.status IN ('draft','in_progress','returned')${f.region_id ? ' AND a.region_id=?' : ''}`).all(...A.params, ...(f.region_id ? [Number(f.region_id)] : [])) as any[]) {
    const docs = requiredDocs(db, a); const missing = docs.filter(d => !d.uploaded), returned = docs.filter(d => d.verification_status === 'returned');
    if (missing.length || returned.length) out.push({ rule: 'MISSING_DOCUMENT', severity: a.status === 'draft' ? 'low' : 'medium', title: `${a.ref}: ${missing.length ? `${missing.length} required document(s) missing` : `${returned.length} document(s) returned by the reviewer`}`, entity: a.ref, link: `/applications/${a.id}`, region_id: a.region_id,
      evidence: [...missing.map(d => `Missing: ${d.display_name}`), ...returned.map(d => `Returned: ${d.display_name}`), a.status === 'draft' ? 'Application is still a draft.' : `Application status: ${a.status.replace('_', ' ')}`] });
  }
  const D = scope(user, 'd');
  for (const d of db.prepare(`SELECT d.*, i.name AS inst FROM documents d JOIN institutions i ON i.id=d.institution_id WHERE ${D.sql} AND d.is_current=1 AND d.expiry_date IS NOT NULL AND d.expiry_date <= ?`).all(...D.params, addCalendarDays(today, docWindow)) as any[]) {
    if (!inRegion(d.region_id)) continue; const left = daysBetween(today, d.expiry_date);
    out.push(left < 0 ? { rule: 'DOC_EXPIRED', severity: -left > 30 ? 'high' : 'medium', title: `${docName(d.doc_type)} (${docCode(d.id)}) expired ${-left} day(s) ago`, entity: d.inst, link: '/documents?expiry=expired', region_id: d.region_id, evidence: [`Expiry date: ${d.expiry_date}`, `Institution: ${d.inst}`, `Renewal status: ${d.renewal_status.replace('_', ' ')}`] }
      : { rule: 'DOC_EXPIRING', severity: left <= 7 ? 'medium' : 'low', title: `${docName(d.doc_type)} (${docCode(d.id)}) expires in ${left} day(s)`, entity: d.inst, link: '/documents?expiry=30', region_id: d.region_id, evidence: [`Expiry date: ${d.expiry_date}`, `Institution: ${d.inst}`] });
  }
  // escalation eligibility, using the same candidate queries the escalation job uses
  const rules = db.prepare('SELECT * FROM escalation_rules WHERE active=1 ORDER BY trigger_type, level').all() as any[];
  const SC = (r: { institution_id: number; region_id: number }) => (user.role === 'institution' ? false : user.role === 'regional_officer' || user.role === 'evc_coordinator' ? r.region_id === user.region_id : true);
  if (user.role !== 'institution') for (const rule of rules) for (const c of candidates(db, rule.trigger_type, today)) {
    if (!SC(c) || !inRegion(c.region_id) || (rule.applies_to_role && c.role !== rule.applies_to_role)) continue;
    const gap = rule.after_days - c.overdue_days;
    if (gap > 3) continue;
    const raised = (db.prepare(`SELECT COUNT(*) c FROM escalation_events WHERE rule_id=? AND entity_type=? AND entity_id=?`).get(rule.id, c.entity_type, c.entity_id) as any).c;
    if (raised) continue;
    out.push({ rule: 'ESCALATION_ELIGIBLE', severity: gap <= 0 ? 'high' : 'low', title: gap <= 0 ? `Escalation level ${rule.level} is due: ${c.reason}` : `Escalation level ${rule.level} becomes due in ${gap} day(s): ${c.reason}`, entity: `${c.entity_type} ${c.entity_id}`, link: c.application_id ? `/applications/${c.application_id}` : c.entity_type === 'evc' ? '/evc' : c.entity_type === 'undertaking' ? '/compliance' : '/documents', region_id: c.region_id,
      evidence: [`Rule: ${rule.name}`, `Delay in the rule: ${rule.after_days} day(s); item is ${c.overdue_days} day(s) overdue`, `Would be sent to: ${rule.recipient_role.replace('_', ' ')}`, gap <= 0 ? 'The next job run will raise it.' : 'Not yet eligible.'] });
  }
  const rank = { high: 0, medium: 1, low: 2 };
  return out.sort((a, b) => rank[a.severity] - rank[b.severity] || a.title.localeCompare(b.title));
}
