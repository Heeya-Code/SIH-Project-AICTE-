import type { DB } from './db';
import { scope, type User } from './auth';
import { clock } from './clock';
import { addCalendarDays, daysBetween, getNumberSetting } from './util';
import { computeAlerts } from './analytics';
import { requiredDocs } from './workflow';
import { evcState } from './evc';
import { effectiveStatus } from './compliance';
import { docName, docCode } from './docnames';

// The order in which items are ranked. Shown to the user so the order is never a mystery.
export const ATTENTION_CRITERIA = [
  { rank: 1, label: 'Overdue', help: 'A deadline has already passed.' },
  { rank: 2, label: 'Deadline approaching', help: 'A deadline falls within the next few days.' },
  { rank: 3, label: 'Blocked', help: 'Nobody is assigned, or the case has not moved for a long time.' },
  { rank: 4, label: 'Missing or unresolved', help: 'A document is missing or returned, a deficiency is open, or something awaits review.' },
  { rank: 5, label: 'Coming up', help: 'Scheduled work that is not yet urgent.' },
] as const;

export type AttentionItem = { key: string; rank: number; rank_label: string; title: string; why: string[]; link: string; action: string; due?: string | null; mine?: boolean; severity: 'high' | 'medium' | 'low' };

const RANK_OF: Record<string, number> = { DEADLINE_OVERDUE: 1, DOC_EXPIRED: 1, ESCALATION_ELIGIBLE: 1, DEADLINE_SOON: 2, DOC_EXPIRING: 2, STALLED: 3, UNASSIGNED: 3, MISSING_DOCUMENT: 4 };
const ACTION_OF: Record<string, string> = { DEADLINE_OVERDUE: 'Open the case', DEADLINE_SOON: 'Open the case', DOC_EXPIRED: 'Review the document', DOC_EXPIRING: 'Review the document', STALLED: 'Review why it has not moved', UNASSIGNED: 'Assign or pick up the case', MISSING_DOCUMENT: 'Check the missing or returned documents', ESCALATION_ELIGIBLE: 'Check the escalation' };
const label = (rank: number) => ATTENTION_CRITERIA.find(c => c.rank === rank)!.label;
const sevOf = (rank: number): AttentionItem['severity'] => (rank <= 1 ? 'high' : rank <= 3 ? 'medium' : 'low');
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;

export function buildAttention(db: DB, user: User, limit = 12) {
  const today = clock.today(), soon = getNumberSetting(db, 'due_soon_days', 3) + 4;     // "approaching" = a week by default
  const items: AttentionItem[] = [];
  const add = (i: Omit<AttentionItem, 'rank_label' | 'severity'> & { rank: number }) => items.push({ ...i, rank_label: label(i.rank), severity: sevOf(i.rank) });

  if (user.role === 'institution') {
    const inst = user.institution_id ?? -1;
    for (const t of db.prepare(`SELECT t.*, a.ref, a.title AS atitle FROM tasks t JOIN applications a ON a.id=t.application_id WHERE t.institution_id=? AND t.status='open' AND t.role='institution'`).all(inst) as any[]) {
      const left = t.due_date ? daysBetween(today, t.due_date) : 99;
      const open = (db.prepare(`SELECT description FROM deficiencies WHERE application_id=? AND status='open' ORDER BY id DESC LIMIT 1`).get(t.application_id) as any)?.description;
      add({ key: `task-${t.id}`, rank: left < 0 ? 1 : left <= soon ? 2 : 4, title: `Respond to the request on ${t.ref}`, link: `/applications/${t.application_id}`, action: 'Respond and resubmit', due: t.due_date,
        why: [left < 0 ? `Your response was due ${plural(-left, 'day')} ago (${t.due_date})` : `Response due ${t.due_date} (${plural(left, 'day')} left)`, ...(open ? [`The officer asked: ${open}`] : []), 'The application is waiting for you; it will not move until you respond.'] });
    }
    for (const u of db.prepare(`SELECT * FROM undertakings WHERE institution_id=? AND status IN ('pending','returned')`).all(inst) as any[]) {
      const left = daysBetween(today, u.due_date), st = effectiveStatus(db, u, today);
      if (left > 30) continue;
      add({ key: `und-${u.id}`, rank: left < 0 ? 1 : left <= soon ? 2 : u.status === 'returned' ? 4 : 5, title: `${u.status === 'returned' ? 'Correct and resubmit' : 'Submit evidence for'} ${u.code}`, link: '/compliance', action: u.status === 'returned' ? 'Submit corrected evidence' : 'Submit evidence', due: u.due_date,
        why: [left < 0 ? `Overdue by ${plural(-left, 'day')} (due ${u.due_date})` : `Due ${u.due_date} (${plural(left, 'day')} left)`, u.condition_text, `Required: ${u.required_evidence}`, ...(st === 'returned_for_correction' && u.observations ? [`Reviewer note: ${u.observations}`] : [])] });
    }
    for (const d of db.prepare(`SELECT * FROM documents WHERE institution_id=? AND is_current=1 AND expiry_date IS NOT NULL AND expiry_date <= ? AND renewal_status <> 'renewed'`).all(inst, addCalendarDays(today, 30)) as any[]) {
      const left = daysBetween(today, d.expiry_date);
      add({ key: `doc-${d.id}`, rank: left < 0 ? 1 : left <= soon ? 2 : 5, title: `${left < 0 ? 'Renew the expired' : 'Renew the'} ${docName(d.doc_type)}`, link: '/documents?expiry=60', action: 'Upload the renewed document', due: d.expiry_date,
        why: [left < 0 ? `Expired ${plural(-left, 'day')} ago (${d.expiry_date})` : `Expires ${d.expiry_date} (${plural(left, 'day')} left)`, `${docName(d.doc_type)} (${docCode(d.id)}), version ${d.version}`] });
    }
    for (const d of db.prepare(`SELECT d.*, a.ref FROM documents d LEFT JOIN applications a ON a.id=d.application_id WHERE d.institution_id=? AND d.is_current=1 AND d.verification_status='returned'`).all(inst) as any[])
      add({ key: `ret-${d.id}`, rank: 4, title: `Replace the returned ${docName(d.doc_type)}`, link: d.application_id ? `/applications/${d.application_id}` : '/documents', action: 'Upload a corrected copy', why: [`The reviewer returned it${d.verification_note ? `: ${d.verification_note}` : ''}`, ...(d.ref ? [`Application ${d.ref}`] : [])] });
    for (const a of db.prepare(`SELECT * FROM applications WHERE institution_id=? AND status='draft'`).all(inst) as any[]) {
      const docs = requiredDocs(db, a), missing = docs.filter(x => !x.uploaded);
      add({ key: `draft-${a.id}`, rank: missing.length ? 4 : 5, title: missing.length ? `Finish your draft ${a.ref}` : `${a.ref} is ready to submit`, link: `/applications/${a.id}`, action: missing.length ? 'Upload the missing documents' : 'Review and submit',
        why: missing.length ? [`Missing: ${missing.map(m => m.display_name).join(', ')}`, 'It cannot be submitted until every required document is uploaded.'] : ['All required documents are uploaded.', 'Nothing has been sent to the Region yet. It is still a draft.'] });
    }
  } else {
    const mine = new Set((db.prepare(`SELECT application_id FROM tasks WHERE assigned_user_id=? AND status='open'`).all(user.id) as any[]).map(r => r.application_id));
    const appIdOf = (link: string) => { const m = /^\/applications\/(\d+)/.exec(link); return m ? Number(m[1]) : null; };
    let alerts = computeAlerts(db, user);
    if (user.role === 'competent_authority') {
      // a case waiting for a decision is shown once, as a specific decision item, not also as a generic deadline alert
      const atDecision = new Set((db.prepare(`SELECT id FROM applications WHERE current_stage='decision' AND status='in_progress'`).all() as any[]).map(r => `/applications/${r.id}`));
      alerts = alerts.filter(a => !['STALLED', 'UNASSIGNED'].includes(a.rule) && !atDecision.has(a.link));
    }
    if (user.role === 'evc_coordinator') alerts = alerts.filter(a => a.rule === 'DOC_EXPIRED' ? false : ['ESCALATION_ELIGIBLE'].includes(a.rule));
    if (user.role === 'admin') alerts = alerts.filter(a => ['DEADLINE_OVERDUE', 'UNASSIGNED', 'ESCALATION_ELIGIBLE'].includes(a.rule)).slice(0, 5);
    for (const a of alerts) {
      const rank = a.rule === 'ESCALATION_ELIGIBLE' && a.severity !== 'high' ? 2 : RANK_OF[a.rule] ?? 4, id = appIdOf(a.link);
      add({ key: `${a.rule}-${a.entity}-${a.link}`, rank, title: a.title, link: a.link, action: ACTION_OF[a.rule] ?? 'Open', why: [...a.evidence, ...(id && mine.has(id) ? ['Assigned to you'] : [])], mine: !!(id && mine.has(id)) });
    }
    if (user.role === 'competent_authority') {
      for (const a of db.prepare(`SELECT a.* FROM applications a WHERE a.current_stage='decision' AND a.status='in_progress'`).all() as any[]) {
        const left = a.stage_due_date ? daysBetween(today, a.stage_due_date) : 99;
        const defs = (db.prepare(`SELECT COUNT(*) c FROM deficiencies WHERE application_id=? AND status<>'closed'`).get(a.id) as any).c;
        add({ key: `decide-${a.id}`, rank: left < 0 ? 1 : left <= soon ? 2 : 4, title: `Decision needed on ${a.ref}`, link: `/applications/${a.id}`, action: 'Review the case summary and record a decision', due: a.stage_due_date,
          why: [left < 0 ? `Decision deadline passed ${plural(-left, 'day')} ago` : `Decision due ${a.stage_due_date}`, defs ? `${plural(defs, 'deficiency')} not yet closed` : 'No open deficiencies', 'Only the competent authority can record this decision.'] });
      }
    }
    if (user.role === 'regional_officer' || user.role === 'bureau_officer') {
      const D = scope(user, 'd');
      for (const d of db.prepare(`SELECT d.*, i.name AS inst FROM documents d JOIN institutions i ON i.id=d.institution_id LEFT JOIN applications a ON a.id=d.application_id WHERE ${D.sql} AND d.is_current=1 AND d.verification_status='pending' AND (a.id IS NULL OR a.status IN ('in_progress','returned')) AND substr(d.uploaded_at,1,10) <= ? ORDER BY d.uploaded_at LIMIT 6`).all(...D.params, addCalendarDays(today, -7)) as any[])
        add({ key: `verify-${d.id}`, rank: 4, title: `${docName(d.doc_type)} (${docCode(d.id)}) has waited ${daysBetween(d.uploaded_at.slice(0, 10), today)} days for verification`, link: '/verification', action: 'Verify or return the document', why: [`Institution: ${d.inst}`, `Uploaded ${d.uploaded_at.slice(0, 10)}`] });
    }
    if (user.role === 'evc_coordinator') {
      const E = scope(user, 'e');
      for (const e of db.prepare(`SELECT e.*, a.ref, i.name AS inst FROM evc_schedules e JOIN applications a ON a.id=e.application_id JOIN institutions i ON i.id=e.institution_id WHERE ${E.sql} AND e.status IN ('queued','scheduled','rescheduled') AND a.status='in_progress'`).all(...E.params) as any[]) {
        const st = evcState(e, today);
        if (e.status === 'queued') { const left = daysBetween(today, e.schedule_deadline); add({ key: `evcq-${e.id}`, rank: left < 0 ? 1 : left <= soon ? 2 : 4, title: `Schedule the EVC visit for ${e.ref}`, link: '/evc', action: 'Pick a date and committee', due: e.schedule_deadline, why: [left < 0 ? `Scheduling deadline passed ${plural(-left, 'day')} ago` : `Schedule by ${e.schedule_deadline} (${plural(left, 'day')} left)`, e.inst, `Complete the visit by ${e.completion_deadline}`] }); }
        else if (st.overdue) add({ key: `evcr-${e.id}`, rank: 1, title: `Record the visit report for ${e.ref}`, link: '/evc', action: 'Record the completed visit', due: e.confirmed_date, why: [st.reason ?? 'Overdue', e.inst, 'The application cannot move on until the visit is recorded.'] });
        else if (e.confirmed_date) { const left = daysBetween(today, e.confirmed_date); if (left <= 7) add({ key: `evcv-${e.id}`, rank: left <= 2 ? 2 : 5, title: `EVC visit for ${e.ref} ${left <= 0 ? 'is today' : `in ${plural(left, 'day')}`}`, link: '/evc', action: 'Prepare and confirm attendance', due: e.confirmed_date, why: [`Visit date ${e.confirmed_date}`, e.inst, 'Check the committee and the application documents beforehand.'] }); }
      }
    }
    if (user.role === 'bureau_officer' || user.role === 'competent_authority' || user.role === 'regional_officer' || user.role === 'evc_coordinator') {
      for (const x of db.prepare(`SELECT * FROM escalation_events WHERE recipient_user_id=? AND status='open' ORDER BY overdue_days DESC LIMIT 5`).all(user.id) as any[])
        add({ key: `esc-${x.id}`, rank: 1, title: `Escalation (level ${x.level}) is waiting for you`, link: '/escalations', action: 'Acknowledge and act', why: [x.reason, `${plural(x.overdue_days, 'day')} overdue`, 'Sent to you under the escalation rules.'] });
    }
    if (user.role === 'admin') {
      const c = (s: string) => (db.prepare(s).get() as any).c as number;
      const fails = c(`SELECT COUNT(*) c FROM job_runs WHERE status IN ('failed','partial') AND started_at >= '${new Date(Date.now() - 7 * 86400000).toISOString()}'`);
      if (fails) add({ key: 'jobs', rank: 3, title: `${plural(fails, 'background job run')} had problems this week`, link: '/admin', action: 'Check the job history', why: ['Reminders and escalations may have been delayed.'] });
      const conflicts = c(`SELECT COUNT(*) c FROM import_conflicts WHERE status='open'`); if (conflicts) add({ key: 'conf', rank: 4, title: `${plural(conflicts, 'import conflict')} need a decision`, link: '/public-data', action: 'Resolve the conflicts', why: ['Stored values were kept; nothing was overwritten.'] });
      const rules = c(`SELECT COUNT(*) c FROM regulatory_rules WHERE flagged_for_review=1`); if (rules) add({ key: 'rules', rank: 4, title: `${plural(rules, 'regulatory rule')} flagged for review`, link: '/rules?flagged=1', action: 'Review against the official handbook', why: ['They are unverified or need review, and must not be treated as rules.'] });
      const lic = c(`SELECT COUNT(*) c FROM data_sources WHERE usable_for_import=1 AND (licence IS NULL OR licence='')`); if (lic) add({ key: 'lic', rank: 4, title: `${plural(lic, 'data source')} without a recorded licence`, link: '/public-data', action: 'Record the licence', why: ['Imports from these sources are blocked until the licence is recorded.'] });
      const addenda = c(`SELECT COUNT(*) c FROM handbook_versions WHERE kind='addendum' AND status='current' AND text_reviewed=0`); if (addenda) add({ key: 'addenda', rank: 4, title: `${plural(addenda, 'current handbook addendum')} not yet reviewed`, link: '/public-data', action: 'Review the addendum text', why: ['No rule can be activated while a current addendum is unreviewed.'] });
    }
  }
  items.sort((a, b) => a.rank - b.rank || Number(!!b.mine) - Number(!!a.mine) || (a.due ?? '9999').localeCompare(b.due ?? '9999') || a.title.localeCompare(b.title));
  const byRank: Record<number, number> = {}; for (const i of items) byRank[i.rank] = (byRank[i.rank] ?? 0) + 1;
  return { items: items.slice(0, limit), total: items.length, by_rank: byRank, criteria: ATTENTION_CRITERIA, ordering: 'Ranked by the criteria in order. Within a rank, cases assigned to you come first, then the earliest deadline.' };
}
