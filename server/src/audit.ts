import type { DB } from './db';
import { clock } from './clock';
import { sha256, uuid } from './util';
import { originFlag } from './origin';

export type Actor = { id: number | null; label: string };
export const SYSTEM: Actor = { id: null, label: 'system' };
export const actorOf = (u: { id: number; name: string; role: string }): Actor => ({ id: u.id, label: `${u.name} (${u.role})` });

const GENESIS = '0'.repeat(64);
const j = (v: unknown) => (v === undefined || v === null ? null : typeof v === 'string' ? v : JSON.stringify(v));

export type AuditInput = {
  actor: Actor; type: string; entity: string; entityId?: number | string | null;
  prev?: unknown; next?: unknown; reason?: string | null; correlationId?: string | null;
};

function digest(prevHash: string, r: any) {
  return sha256([prevHash, r.event_id, r.actor_id ?? '', r.actor_label, r.event_type, r.entity_type, r.entity_id ?? '',
    r.prev_state ?? '', r.new_state ?? '', r.reason ?? '', r.correlation_id ?? '', r.at].join('|'));
}

// Append-only audit record. Timestamp is server-generated. Hash-links each row to the previous one so that
// edits made outside the application (e.g. directly in the database file) can be detected by verifyAuditChain.
export function audit(db: DB, e: AuditInput) {
  const last = db.prepare('SELECT hash FROM audit_log ORDER BY id DESC LIMIT 1').get() as any;
  const prevHash = last?.hash ?? GENESIS;
  const row = {
    event_id: uuid(), actor_id: e.actor.id, actor_label: e.actor.label, event_type: e.type, entity_type: e.entity,
    entity_id: e.entityId == null ? null : String(e.entityId), prev_state: j(e.prev), new_state: j(e.next),
    reason: e.reason ?? null, correlation_id: e.correlationId ?? null, at: clock.iso(),
  };
  const hash = digest(prevHash, row);
  db.prepare(`INSERT INTO audit_log (event_id,actor_id,actor_label,event_type,entity_type,entity_id,prev_state,new_state,reason,correlation_id,at,prev_hash,hash,synthetic)
    VALUES (@event_id,@actor_id,@actor_label,@event_type,@entity_type,@entity_id,@prev_state,@new_state,@reason,@correlation_id,@at,@prev_hash,@hash,@synthetic)`)
    .run({ ...row, prev_hash: prevHash, hash, synthetic: originFlag() });
}

export function verifyAuditChain(db: DB) {
  let prev = GENESIS, count = 0;
  for (const r of db.prepare('SELECT * FROM audit_log ORDER BY id').iterate() as any) {
    if (r.prev_hash !== prev || digest(prev, r) !== r.hash) return { ok: false, checked: count, brokenAtId: r.id as number };
    prev = r.hash; count++;
  }
  return { ok: true, checked: count, brokenAtId: null as number | null };
}
