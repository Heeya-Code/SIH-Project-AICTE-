import type { DB } from './db';
import { clock } from './clock';
import { audit, SYSTEM } from './audit';
import { notify, recipients } from './notify';
import { addCalendarDays, daysBetween } from './util';
import { docName, docCode } from './docnames';

type Candidate = { entity_type: 'task' | 'evc' | 'undertaking' | 'document'; entity_id: number; application_id: number | null; institution_id: number; region_id: number; overdue_days: number; reason: string; role?: string };

export type { Candidate };
export function candidates(db: DB, type: string, today: string): Candidate[] {
  switch (type) {
    case 'task_overdue':
      return (db.prepare(`SELECT t.*, a.ref FROM tasks t JOIN applications a ON a.id=t.application_id WHERE t.status='open' AND t.due_date IS NOT NULL AND t.due_date < ? AND t.type <> 'evc'`).all(today) as any[])
        .map(t => ({ entity_type: 'task', entity_id: t.id, application_id: t.application_id, institution_id: t.institution_id, region_id: t.region_id, role: t.role,
          overdue_days: daysBetween(t.due_date, today), reason: `Task "${t.title}" was due on ${t.due_date}` }));
    case 'evc_overdue': {
      const out: Candidate[] = [];
      for (const e of db.prepare(`SELECT e.*, a.ref FROM evc_schedules e JOIN applications a ON a.id=e.application_id WHERE e.status IN ('queued','scheduled','rescheduled')`).all() as any[]) {
        const lateBy: { d: number; why: string }[] = [];
        if (e.status === 'queued' && e.schedule_deadline < today) lateBy.push({ d: daysBetween(e.schedule_deadline, today), why: `EVC for ${e.ref} was not scheduled by ${e.schedule_deadline}` });
        if (e.status !== 'queued' && e.confirmed_date && e.confirmed_date < today) lateBy.push({ d: daysBetween(e.confirmed_date, today), why: `EVC visit for ${e.ref} was due on ${e.confirmed_date} but is not recorded as completed` });
        if (e.completion_deadline && e.completion_deadline < today) lateBy.push({ d: daysBetween(e.completion_deadline, today), why: `EVC for ${e.ref} missed its completion deadline of ${e.completion_deadline}` });
        if (lateBy.length) { const w = lateBy.sort((a, b) => b.d - a.d)[0];
          out.push({ entity_type: 'evc', entity_id: e.id, application_id: e.application_id, institution_id: e.institution_id, region_id: e.region_id, overdue_days: w.d, reason: w.why }); }
      }
      return out;
    }
    case 'undertaking_overdue':
      return (db.prepare(`SELECT * FROM undertakings WHERE status IN ('pending','returned') AND due_date < ?`).all(today) as any[])
        .map(u => ({ entity_type: 'undertaking', entity_id: u.id, application_id: u.application_id, institution_id: u.institution_id, region_id: u.region_id,
          overdue_days: daysBetween(u.due_date, today), reason: `Obligation ${u.code} was due on ${u.due_date}` }));
    case 'document_expired':
      return (db.prepare(`SELECT * FROM documents WHERE is_current=1 AND expiry_date IS NOT NULL AND expiry_date < ? AND renewal_status <> 'renewed'`).all(today) as any[])
        .map(d => ({ entity_type: 'document', entity_id: d.id, application_id: d.application_id, institution_id: d.institution_id, region_id: d.region_id,
          overdue_days: daysBetween(d.expiry_date, today), reason: `${docName(d.doc_type)} (${docCode(d.id)}) expired on ${d.expiry_date} and has not been renewed` }));
  }
  return [];
}

const linkFor = (c: Candidate) => c.entity_type === 'evc' ? '/evc' : c.entity_type === 'undertaking' ? '/compliance' : c.entity_type === 'document' ? '/documents' : `/applications/${c.application_id}`;

// Creates escalation events for overdue items. Idempotent: each (rule, entity, repeat index, recipient) can exist only once,
// so re-running the job - or restarting the server - never produces duplicates. Repeats are bounded by max_repeats.
export function runEscalations(db: DB, today = clock.today(), cap = 2000) {
  const rules = db.prepare('SELECT * FROM escalation_rules WHERE active=1 ORDER BY trigger_type, level').all() as any[];
  const now = clock.iso();
  let created = 0;
  for (const rule of rules) {
    for (const c of candidates(db, rule.trigger_type, today)) {
      if (rule.applies_to_role && c.role !== rule.applies_to_role) continue;
      if (c.overdue_days < rule.after_days) continue;
      const repeats = rule.repeat_every_days && rule.max_repeats > 0
        ? Math.min(rule.max_repeats, Math.floor((c.overdue_days - rule.after_days) / rule.repeat_every_days)) : 0;
      for (let i = 0; i <= repeats; i++) {
        for (const uid of recipients(db, { role: rule.recipient_role, regionId: c.region_id })) {
          if (created >= cap) return created;
          const key = `esc:${rule.id}:${c.entity_type}:${c.entity_id}:${i}:u${uid}`;
          const r = db.prepare(`INSERT OR IGNORE INTO escalation_events (rule_id,trigger_type,entity_type,entity_id,application_id,institution_id,region_id,level,recipient_user_id,status,reason,overdue_days,dedupe_key,triggered_at)
            VALUES (?,?,?,?,?,?,?,?,?, 'open', ?,?,?,?)`).run(rule.id, rule.trigger_type, c.entity_type, c.entity_id, c.application_id, c.institution_id, c.region_id, rule.level, uid, c.reason, c.overdue_days, key, now);
          if (r.changes === 0) continue;
          created++;
          const eid = Number(r.lastInsertRowid);
          notify(db, { userId: uid, event: 'escalation.triggered', vars: { level: rule.level, reason: c.reason, days: c.overdue_days }, link: linkFor(c), dedupeKey: `esc-n:${key}`, ackRequired: true, entity: { type: 'escalation', id: eid } });
          audit(db, { actor: SYSTEM, type: 'escalation.triggered', entity: 'escalation', entityId: eid, next: { rule: rule.name, level: rule.level, to_user: uid, entity: `${c.entity_type}:${c.entity_id}` }, reason: c.reason });
        }
      }
    }
  }
  return created;
}

// Cancels open escalations whose underlying item has since been resolved (task done, evidence submitted, visit recorded, document renewed).
export function sweepEscalations(db: DB, why: string) {
  const rows = db.prepare(`SELECT id FROM escalation_events WHERE status='open' AND (
    (entity_type='task' AND entity_id NOT IN (SELECT id FROM tasks WHERE status='open')) OR
    (entity_type='evc' AND entity_id NOT IN (SELECT id FROM evc_schedules WHERE status IN ('queued','scheduled','rescheduled') AND (
        (status='queued' AND schedule_deadline < ?) OR (status<>'queued' AND confirmed_date < ?) OR (completion_deadline IS NOT NULL AND completion_deadline < ?)))) OR
    (entity_type='undertaking' AND entity_id NOT IN (SELECT id FROM undertakings WHERE status IN ('pending','returned'))) OR
    (entity_type='document' AND entity_id NOT IN (SELECT id FROM documents WHERE is_current=1 AND renewal_status <> 'renewed')))`).all(clock.today(), clock.today(), clock.today()) as any[];
  const upd = db.prepare(`UPDATE escalation_events SET status='cancelled', cancelled_at=?, cancel_reason=? WHERE id=?`);
  for (const r of rows) { upd.run(clock.iso(), why, r.id); audit(db, { actor: SYSTEM, type: 'escalation.cancelled', entity: 'escalation', entityId: r.id, reason: why }); }
  return rows.length;
}

export { addCalendarDays };
