import type { DB } from './db';
import { clock } from './clock';
import { getNumberSetting } from './util';
import type { Role } from './auth';

// ---------------------------------------------------------------- delivery adapters
export interface EmailAdapter { name: string; send(to: string, subject: string, body: string): Promise<void> }

// Development adapter: nothing leaves the machine. Messages are recorded as "simulated_sent" deliveries.
// Addresses containing "+bounce" simulate a temporary failure so that retry handling can be demonstrated.
export const simulatedEmail: EmailAdapter = {
  name: 'simulated-email',
  async send(to) { if (to.includes('+bounce')) throw new Error('Simulated SMTP failure (mailbox unavailable)'); },
};
let adapter: EmailAdapter = simulatedEmail;
export const setEmailAdapter = (a: EmailAdapter) => { adapter = a; };

// ---------------------------------------------------------------- templates
const render = (tpl: string, vars: Record<string, any>) => tpl.replace(/\{(\w+)\}/g, (_, k) => (vars[k] ?? `{${k}}`).toString());

export type NotifyInput = {
  userId: number; event: string; vars?: Record<string, any>; link?: string; dedupeKey?: string;
  ackRequired?: boolean; entity?: { type: string; id: number }; title?: string; body?: string;
};

// Inserts the notification + delivery rows in the caller's transaction (outbox pattern).
// Returns the notification id, or null when the dedupe key already exists.
export function notify(db: DB, n: NotifyInput): number | null {
  const tpl = db.prepare('SELECT * FROM notification_templates WHERE event=?').get(n.event) as any;
  const vars = n.vars ?? {};
  const title = n.title ?? (tpl ? render(tpl.title_tpl, vars) : n.event);
  const body = n.body ?? (tpl ? render(tpl.body_tpl, vars) : '');
  const channels = (tpl?.channels ?? 'in_app,email').split(',').map((s: string) => s.trim());
  const now = clock.iso();
  const r = db.prepare(`INSERT OR IGNORE INTO notifications (user_id,event,title,body,link,entity_type,entity_id,dedupe_key,ack_required,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?)`).run(n.userId, n.event, title, body, n.link ?? null, n.entity?.type ?? null, n.entity?.id ?? null,
    n.dedupeKey ?? null, n.ackRequired ? 1 : 0, now);
  if (r.changes === 0) return null;
  const id = Number(r.lastInsertRowid);
  const ins = db.prepare(`INSERT INTO notification_deliveries (notification_id,channel,status,attempts,created_at) VALUES (?,?,?,?,?)`);
  ins.run(id, 'in_app', 'sent', 1, now);
  if (channels.includes('email')) ins.run(id, 'email', 'pending', 0, now);
  return id;
}

export type RecipientSpec = { role: Role; regionId?: number | null; institutionId?: number | null };
// Recipients are always derived from the entity's own scope, never from client input:
// institution users -> that institution only; regional roles -> that region only; national roles -> all active holders.
export function recipients(db: DB, s: RecipientSpec): number[] {
  const rows = (() => {
    if (s.role === 'institution') return db.prepare(`SELECT id FROM users WHERE active=1 AND role='institution' AND institution_id=?`).all(s.institutionId ?? -1);
    if (s.role === 'regional_officer' || s.role === 'evc_coordinator')
      return db.prepare(`SELECT id FROM users WHERE active=1 AND role=? AND region_id=?`).all(s.role, s.regionId ?? -1);
    return db.prepare(`SELECT id FROM users WHERE active=1 AND role=?`).all(s.role);
  })() as any[];
  return rows.map(r => r.id);
}

export function notifyRole(db: DB, s: RecipientSpec, n: Omit<NotifyInput, 'userId'>) {
  let sent = 0;
  for (const userId of recipients(db, s)) {
    const key = n.dedupeKey ? `${n.dedupeKey}:u${userId}` : undefined;
    if (notify(db, { ...n, userId, dedupeKey: key }) !== null) sent++;
  }
  return sent;
}

// ---------------------------------------------------------------- outbox processing (runs outside request transactions)
const BACKOFF_MINUTES = [5, 30, 120];

export async function processOutbox(db: DB): Promise<{ attempted: number; sent: number; failed: number; abandoned: number }> {
  const now = clock.now();
  const maxAttempts = getNumberSetting(db, 'email_max_attempts', 3);
  const due = db.prepare(`
    SELECT d.id, d.attempts, n.title, n.body, u.email FROM notification_deliveries d
    JOIN notifications n ON n.id=d.notification_id JOIN users u ON u.id=n.user_id
    WHERE d.channel='email' AND (d.status='pending' OR (d.status='failed' AND (d.next_retry_at IS NULL OR d.next_retry_at <= ?)))
    ORDER BY d.id LIMIT 500`).all(now.toISOString()) as any[];
  let sent = 0, failed = 0, abandoned = 0;
  for (const d of due) {
    const attempts = d.attempts + 1;
    try {
      await adapter.send(d.email, d.title, d.body);
      db.prepare(`UPDATE notification_deliveries SET status='simulated_sent', attempts=?, last_attempt_at=?, last_error=NULL, next_retry_at=NULL WHERE id=?`)
        .run(attempts, now.toISOString(), d.id);
      sent++;
    } catch (e: any) {
      if (attempts >= maxAttempts) {
        db.prepare(`UPDATE notification_deliveries SET status='abandoned', attempts=?, last_attempt_at=?, last_error=?, next_retry_at=NULL WHERE id=?`)
          .run(attempts, now.toISOString(), String(e.message ?? e), d.id);
        abandoned++;
      } else {
        const next = new Date(now.getTime() + BACKOFF_MINUTES[Math.min(attempts - 1, BACKOFF_MINUTES.length - 1)] * 60000).toISOString();
        db.prepare(`UPDATE notification_deliveries SET status='failed', attempts=?, last_attempt_at=?, last_error=?, next_retry_at=? WHERE id=?`)
          .run(attempts, now.toISOString(), String(e.message ?? e), next, d.id);
        failed++;
      }
    }
  }
  return { attempted: due.length, sent, failed, abandoned };
}
