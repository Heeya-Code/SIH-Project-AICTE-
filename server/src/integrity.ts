import type { DB } from './db';
import { loadDefinition } from './workflow';

export type Issue = { check: string; id: string | number | null; message: string };

// Independent consistency checks over the stored data. They do not trust the engine: they re-derive what must be true from the rows.
export function validateIntegrity(db: DB) {
  const issues: Issue[] = [];
  const add = (check: string, id: any, message: string) => { if (issues.filter(i => i.check === check).length < 25) issues.push({ check, id, message }); };
  const counts: Record<string, number> = {};
  const run = (check: string, fn: () => number) => { counts[check] = fn(); };

  run('foreign_keys', () => { const bad = db.prepare('PRAGMA foreign_key_check').all() as any[]; for (const b of bad) add('foreign_keys', b.rowid, `${b.table} row ${b.rowid} points to a missing ${b.parent}`); return bad.length; });

  run('application_status', () => {
    let n = 0;
    for (const a of db.prepare('SELECT a.*, v.id vid FROM applications a LEFT JOIN workflow_versions v ON v.id=a.workflow_version_id').all() as any[]) {
      n++;
      if (a.status === 'draft') { if (a.current_stage || a.submitted_at) add('application_status', a.ref, 'Draft has a stage or submission time'); continue; }
      if (!a.workflow_version_id || !a.current_stage || !a.submitted_at) { add('application_status', a.ref, 'Submitted application lacks workflow version, stage or submission time'); continue; }
      const stage = (db.prepare('SELECT * FROM workflow_stages WHERE version_id=? AND key=?').get(a.workflow_version_id, a.current_stage) as any);
      if (!stage) { add('application_status', a.ref, `Stage ${a.current_stage} is not in its workflow version`); continue; }
      const terminal = ['approved', 'rejected', 'withdrawn'].includes(a.status);
      if (!!stage.is_terminal !== terminal) add('application_status', a.ref, `Status ${a.status} does not match stage ${a.current_stage}`);
      if (terminal && !a.completed_at) add('application_status', a.ref, 'Finished application has no completion time');
      if (!terminal && a.completed_at) add('application_status', a.ref, 'Open application has a completion time');
      if (a.status === 'returned' && stage.responsible_role !== 'institution') add('application_status', a.ref, 'Returned status outside an institution-owned stage');
      if (a.completed_at && a.submitted_at && a.completed_at < a.submitted_at) add('dates', a.ref, 'Completed before it was submitted');
      if (a.stage_due_date && a.stage_entered_at && a.stage_due_date < a.stage_entered_at.slice(0, 10)) add('dates', a.ref, 'Stage deadline is before the stage was entered (UTC date check)');
    }
    return n;
  });

  run('workflow_history', () => {
    let n = 0;
    const defs = new Map<number, ReturnType<typeof loadDefinition>>();
    for (const a of db.prepare(`SELECT id, ref, workflow_version_id, current_stage FROM applications WHERE status <> 'draft'`).all() as any[]) {
      const h = db.prepare('SELECT * FROM stage_history WHERE application_id=? ORDER BY id').all(a.id) as any[]; n++;
      if (!h.length) { add('workflow_history', a.ref, 'No history'); continue; }
      const def = defs.get(a.workflow_version_id) ?? loadDefinition(db, a.workflow_version_id); defs.set(a.workflow_version_id, def);
      if (h[0].action !== 'submit' || h[0].from_stage !== null) add('workflow_history', a.ref, 'History does not start with a submission');
      for (let i = 0; i < h.length; i++) {
        if (i > 0 && h[i].from_stage !== h[i - 1].to_stage) add('workflow_history', a.ref, `Gap in history at row ${h[i].id}`);
        if (i > 0 && h[i].at < h[i - 1].at) add('dates', a.ref, `History goes backwards at row ${h[i].id}`);
        if (i > 0 && !def.transitions.some(t => t.from_key === h[i].from_stage && t.to_key === h[i].to_stage && t.action === h[i].action)) add('workflow_transitions', a.ref, `${h[i].from_stage} --${h[i].action}--> ${h[i].to_stage} is not defined in the workflow`);
      }
      if (h[h.length - 1].to_stage !== a.current_stage) add('workflow_history', a.ref, 'Last history row does not match the current stage');
    }
    return n;
  });

  run('tasks', () => {
    let n = 0;
    for (const a of db.prepare(`SELECT a.id, a.ref, a.status, s.is_terminal FROM applications a LEFT JOIN workflow_stages s ON s.version_id=a.workflow_version_id AND s.key=a.current_stage WHERE a.status <> 'draft'`).all() as any[]) {
      const open = (db.prepare(`SELECT COUNT(*) c FROM tasks WHERE application_id=? AND status='open'`).get(a.id) as any).c; n++;
      if (a.is_terminal && open) add('tasks', a.ref, 'Finished application still has open tasks');
      if (!a.is_terminal && open !== 1) add('tasks', a.ref, `Expected exactly one open task, found ${open}`);
    }
    return n;
  });

  run('documents', () => {
    let n = 0;
    for (const l of db.prepare('SELECT lineage_id, COUNT(*) total, SUM(is_current) cur, MAX(version) mv FROM documents GROUP BY lineage_id').all() as any[]) {
      n++;
      if (l.cur !== 1) add('documents', l.lineage_id, `Lineage has ${l.cur} current versions`);
      if (l.mv !== l.total) add('documents', l.lineage_id, 'Version numbers have gaps');
    }
    for (const d of db.prepare('SELECT d.* FROM documents d').all() as any[]) {
      if (d.issue_date && d.expiry_date && d.expiry_date < d.issue_date) add('dates', `DOC-${d.id}`, 'Expiry is before issue');
      if (d.supersedes_id) { const p = db.prepare('SELECT * FROM documents WHERE id=?').get(d.supersedes_id) as any; if (!p || p.is_current || p.doc_type !== d.doc_type || p.version !== d.version - 1) add('documents', `DOC-${d.id}`, 'Version chain is inconsistent'); }
      if (!d.doc_type?.trim()) add('documents', `DOC-${d.id}`, 'Document has no type');
      if (d.verification_status === 'verified' && !d.verified_by) add('documents', `DOC-${d.id}`, 'Verified without a verifier');
    }
    return n;
  });

  run('undertakings', () => {
    let n = 0;
    for (const u of db.prepare('SELECT * FROM undertakings').all() as any[]) {
      n++;
      const subs = db.prepare('SELECT * FROM compliance_submissions WHERE undertaking_id=? ORDER BY version').all(u.id) as any[];
      if (['submitted', 'under_verification', 'verified', 'returned', 'closed'].includes(u.status) && !subs.length) add('undertakings', u.code, `Status ${u.status} with no submission`);
      if (['verified', 'closed'].includes(u.status) && subs[subs.length - 1]?.review_status !== 'verified') add('undertakings', u.code, 'Verified without a verified submission (an upload alone is not verification)');
      if (u.status === 'verified' && !u.verified_by) add('undertakings', u.code, 'Verified without a verifier');
      subs.forEach((s, i) => { if (s.version !== i + 1) add('undertakings', u.code, 'Submission versions have gaps'); });
    }
    return n;
  });

  run('evc', () => {
    let n = 0;
    for (const e of db.prepare('SELECT e.*, a.status app_status FROM evc_schedules e JOIN applications a ON a.id=e.application_id').all() as any[]) {
      n++;
      if (e.status === 'completed' && !(db.prepare('SELECT 1 FROM evc_reports WHERE evc_id=?').get(e.id))) add('evc', e.id, 'Completed visit has no report');
      if (['scheduled', 'rescheduled'].includes(e.status) && (!e.confirmed_date || !e.committee_id)) add('evc', e.id, 'Scheduled visit lacks a date or committee');
      if (e.status === 'queued' && e.confirmed_date) add('evc', e.id, 'Queued visit has a date');
    }
    for (const c of db.prepare(`SELECT committee_id, confirmed_date, COUNT(*) c FROM evc_schedules WHERE status IN ('scheduled','rescheduled') GROUP BY committee_id, confirmed_date HAVING c > 1`).all() as any[]) add('evc', c.committee_id, `Committee double-booked on ${c.confirmed_date}`);
    return n;
  });

  run('deficiencies', () => {
    let n = 0;
    for (const d of db.prepare('SELECT * FROM deficiencies').all() as any[]) {
      n++;
      if (d.status === 'closed' && !d.closed_at) add('deficiencies', d.id, 'Closed without a closing time');
      if (d.status !== 'open' && !d.corrective_action) add('deficiencies', d.id, 'Responded or closed without a corrective action');
    }
    return n;
  });

  run('notifications', () => { const bad = db.prepare(`SELECT n.id FROM notifications n JOIN users u ON u.id=n.user_id WHERE u.active=0`).all(); for (const b of bad as any[]) add('notifications', b.id, 'Sent to a deactivated user'); return (db.prepare('SELECT COUNT(*) c FROM notifications').get() as any).c; });

  run('regulatory', () => {
    for (const r of db.prepare(`SELECT code FROM regulatory_rules WHERE verification_status='verified_excerpt' AND (section_ref IS NULL OR source_id IS NULL)`).all() as any[]) add('regulatory', r.code, 'Verified rule lacks a source or section reference');
    for (const r of db.prepare(`SELECT code FROM regulatory_rules WHERE kind='configurable_assumption' AND verification_status<>'assumption'`).all() as any[]) add('regulatory', r.code, 'Assumption presented as verified');
    return (db.prepare('SELECT COUNT(*) c FROM regulatory_rules').get() as any).c;
  });

  return { ok: issues.length === 0, checked: counts, issues };
}
