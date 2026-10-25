import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { makeCtx, newApp, count, setNow, upload, type Ctx } from './helpers';
import { placeholderPdf } from '../src/files';
import { runJobs } from '../src/jobs';

let ctx: Ctx;
beforeEach(() => { ctx = makeCtx(); });

const create = async (ro = 'ro.nr@demo.local', due = '2026-04-01', inst = 1) =>
  (await ctx.as(ro)).post('/api/undertakings', { institution_id: inst, condition_text: 'Submit audited accounts', description: 'Audited accounts for the last year', required_evidence: 'Signed PDF', due_date: due });
async function evidence(email: string, id: number, note = 'Evidence attached', buf = placeholderPdf('e'), name = 'e.pdf') {
  const t = await ctx.login(email);
  let r = request(ctx.app).post(`/api/undertakings/${id}/submissions`).set('Authorization', `Bearer ${t}`);
  if (note !== null) r = r.field('note', note);
  return r.attach('file', buf, { filename: name });
}

describe('undertakings and compliance', () => {
  it('lets officers record an obligation, notifies the institution and audits it', async () => {
    const r = await create(); expect(r.status).toBe(201);
    expect(count(ctx.db, `SELECT COUNT(*) c FROM notifications n JOIN users u ON u.id=n.user_id WHERE n.event='undertaking.created' AND u.email='inst1@demo.local'`)).toBe(1);
    expect(count(ctx.db, `SELECT COUNT(*) c FROM audit_log WHERE event_type='undertaking.created'`)).toBe(1);
    expect((await create('ro.sr@demo.local')).status).toBe(404);                         // other Region's officer cannot touch this institution
    expect((await (await ctx.as('inst1@demo.local')).post('/api/undertakings', { institution_id: 1, condition_text: 'abc', description: 'abc', required_evidence: 'abc', due_date: '2026-05-01' })).status).toBe(403);
    expect((await create('ro.nr@demo.local', '2026-01-01')).status).toBe(422);          // due date in the past
  });

  it('does not treat an upload as verification: an authorised review is required', async () => {
    const id = (await create()).body.id;
    expect((await evidence('inst1@demo.local', id)).status).toBe(201);
    expect(ctx.db.prepare('SELECT status FROM undertakings WHERE id=?').get(id)).toEqual({ status: 'submitted' });
    expect((await (await ctx.as('inst1@demo.local')).post(`/api/undertakings/${id}/review`, { decision: 'verify' })).status).toBe(403);
    expect((await (await ctx.as('ro.sr@demo.local')).post(`/api/undertakings/${id}/review`, { decision: 'verify' })).status).toBe(404);
    expect((await (await ctx.as('ro.nr@demo.local')).post(`/api/undertakings/${id}/review`, { decision: 'verify', note: 'Complete' })).body.status).toBe('verified');
  });

  it('returns incomplete evidence for correction, keeps every submission, and records review notes', async () => {
    const id = (await create()).body.id; const ro = await ctx.as('ro.nr@demo.local');
    await evidence('inst1@demo.local', id, 'First attempt');
    expect((await ro.post(`/api/undertakings/${id}/review`, { decision: 'return' })).status).toBe(422);          // note required
    expect((await ro.post(`/api/undertakings/${id}/review`, { decision: 'return', note: 'Unsigned' })).body.status).toBe('returned');
    expect((await evidence('inst1@demo.local', id, 'Signed copy')).body.version).toBe(2);
    const d = (await ro.get(`/api/undertakings/${id}`)).body;
    expect(d.submissions.map((s: any) => [s.version, s.review_status])).toEqual([[2, 'pending'], [1, 'returned']]);
    expect(d.audit.map((a: any) => a.event_type)).toEqual(['undertaking.created', 'compliance.evidence_submitted', 'compliance.return', 'compliance.evidence_submitted']);
  });

  it('validates evidence submissions and blocks other institutions', async () => {
    const id = (await create()).body.id;
    expect((await evidence('inst2@demo.local', id)).status).toBe(404);
    expect((await evidence('inst1@demo.local', id, '')).status).toBe(400);                                         // note missing
    expect((await evidence('inst1@demo.local', id, 'x ok', Buffer.from('MZ not a pdf'), 'evidence.pdf')).status).toBe(400);
    const t = await ctx.login('inst1@demo.local');
    expect((await request(ctx.app).post(`/api/undertakings/${id}/submissions`).set('Authorization', `Bearer ${t}`).field('note', 'no file')).status).toBe(400);
  });

  it('detects overdue obligations, notifies and escalates, and clears the escalation once evidence arrives', async () => {
    const id = (await create('ro.nr@demo.local', '2026-03-10')).body.id;
    setNow('2026-03-08T04:30:00Z'); await runJobs(ctx.db, 'test');
    expect(count(ctx.db, `SELECT COUNT(*) c FROM notifications WHERE event='undertaking.deadline_approaching'`)).toBe(1);   // 2 days left: the 7-day bucket, sent once to the institution's user
    setNow('2026-03-12T04:30:00Z'); await runJobs(ctx.db, 'test'); await runJobs(ctx.db, 'test');
    const ro = await ctx.as('ro.nr@demo.local');
    expect((await ro.get('/api/undertakings?status=overdue')).body.rows.map((r: any) => r.id)).toEqual([id]);
    expect((await ro.get(`/api/undertakings/${id}`)).body.effective_status).toBe('overdue');
    expect(count(ctx.db, `SELECT COUNT(*) c FROM notifications WHERE event='compliance.overdue'`)).toBeGreaterThan(0);
    expect(count(ctx.db, `SELECT COUNT(*) c FROM escalation_events WHERE trigger_type='undertaking_overdue' AND status='open'`)).toBe(2);   // both regional officers, once
    await evidence('inst1@demo.local', id);
    expect(count(ctx.db, `SELECT COUNT(*) c FROM escalation_events WHERE trigger_type='undertaking_overdue' AND status='open'`)).toBe(0);
    expect((await ro.get(`/api/undertakings/${id}`)).body.effective_status).toBe('submitted');
  });
});

describe('documents, renewals and expiry', () => {
  const lease = async (expiry = '2026-04-15') => {
    const id = await newApp(ctx); const doc = ctx.db.prepare(`SELECT * FROM documents WHERE application_id=? AND doc_type='Lease Deed'`).get(id) as any;
    ctx.db.prepare('UPDATE documents SET expiry_date=? WHERE id=?').run(expiry, doc.id); return doc.id as number;
  };

  it('sends configurable advance reminders once per interval, then expiry notices and escalation', async () => {
    const docId = await lease('2026-04-15');
    setNow('2026-03-20T04:30:00Z'); await runJobs(ctx.db, 'test'); await runJobs(ctx.db, 'test');
    expect(count(ctx.db, `SELECT COUNT(*) c FROM notifications WHERE event='document.expiry_approaching'`)).toBe(1);          // 30-day bucket, one institution user
    expect(ctx.db.prepare('SELECT renewal_status FROM documents WHERE id=?').get(docId)).toEqual({ renewal_status: 'due_for_renewal' });
    setNow('2026-04-14T04:30:00Z'); await runJobs(ctx.db, 'test');
    expect(count(ctx.db, `SELECT COUNT(*) c FROM notifications WHERE event='document.expiry_approaching'`)).toBe(2);          // 1-day bucket
    setNow('2026-04-17T04:30:00Z'); await runJobs(ctx.db, 'test');
    expect(ctx.db.prepare('SELECT renewal_status FROM documents WHERE id=?').get(docId)).toEqual({ renewal_status: 'expired' });
    expect(count(ctx.db, `SELECT COUNT(*) c FROM notifications WHERE event='document.expired'`)).toBeGreaterThan(0);
    expect(count(ctx.db, `SELECT COUNT(*) c FROM escalation_events WHERE trigger_type='document_expired' AND status='open'`)).toBe(2);
  });

  it('accepts a renewal as a new version, keeps the old one traceable and clears the escalation', async () => {
    const docId = await lease('2026-04-15');
    setNow('2026-04-17T04:30:00Z'); await runJobs(ctx.db, 'test');
    const r = await upload(ctx, 'inst1@demo.local', { renew_of: String(docId), expiry_date: '2029-04-15', issue_date: '2026-04-16', reference_no: 'LEASE-2' });
    expect(r.status).toBe(201);
    const rows = ctx.db.prepare('SELECT id, version, is_current, renewal_status, supersedes_id, lineage_id FROM documents WHERE lineage_id=? ORDER BY version').all(docId) as any[];
    expect(rows).toEqual([{ id: docId, version: 1, is_current: 0, renewal_status: 'renewed', supersedes_id: null, lineage_id: docId }, { id: r.body.id, version: 2, is_current: 1, renewal_status: 'not_due', supersedes_id: docId, lineage_id: docId }]);
    expect((await (await ctx.as('inst1@demo.local')).get(`/api/documents/${r.body.id}/versions`)).body.map((d: any) => d.version)).toEqual([2, 1]);
    expect(count(ctx.db, `SELECT COUNT(*) c FROM escalation_events WHERE trigger_type='document_expired' AND status='open'`)).toBe(0);
    expect(count(ctx.db, `SELECT COUNT(*) c FROM audit_log WHERE event_type='document.renewed'`)).toBe(1);
    expect((await upload(ctx, 'inst1@demo.local', { renew_of: String(docId), expiry_date: '2030-01-01' })).status).toBe(409);   // only the current version can be renewed
  });

  it('requires a reviewer decision to verify a document, with a note when returning', async () => {
    const id = await lease(); const ro = await ctx.as('ro.nr@demo.local');
    expect((await (await ctx.as('inst1@demo.local')).post(`/api/documents/${id}/verify`, { decision: 'verified' })).status).toBe(403);
    expect((await ro.post(`/api/documents/${id}/verify`, { decision: 'returned' })).status).toBe(422);
    expect((await ro.post(`/api/documents/${id}/verify`, { decision: 'verified', note: 'ok' })).status).toBe(200);
    expect(ctx.db.prepare('SELECT verification_status FROM documents WHERE id=?').get(id)).toEqual({ verification_status: 'verified' });
  });

  it('filters the validity list by expiry window, type and institution, and supports documents without an expiry', async () => {
    await lease('2026-03-20'); await newApp(ctx, 'inst2@demo.local');
    const ro = await ctx.as('ro.nr@demo.local');
    expect((await ro.get('/api/documents?expiry=30')).body.rows.every((d: any) => d.days_to_expiry >= 0 && d.days_to_expiry <= 30)).toBe(true);
    expect((await ro.get('/api/documents?expiry=no_expiry')).body.rows.every((d: any) => d.expiry_date === null)).toBe(true);
    expect((await ro.get('/api/documents?doc_type=Lease Deed&institution_id=1')).body.total).toBe(1);
    const rep = (await ro.get('/api/reports/documents_validity?window=60')).body;
    expect(rep.rows.length).toBe(1);
  });

  it('uses per-document reminder schedule, creates auto-renewal task once without duplication, and closes it upon renewal', async () => {
    ctx.db.prepare(`UPDATE document_requirements SET reminder_days=?, auto_renewal=1 WHERE doc_type='Lease Deed'`).run(JSON.stringify([10, 2]));
    const docId = await lease('2026-03-20');

    setNow('2026-03-10T04:30:00Z');
    await runJobs(ctx.db, 'test');
    expect(count(ctx.db, `SELECT COUNT(*) c FROM notifications WHERE event='document.expiry_approaching'`)).toBe(1);

    const und = ctx.db.prepare(`SELECT * FROM undertakings WHERE document_id=?`).get(docId) as any;
    expect(und).toBeDefined();
    expect(und.status).toBe('pending');

    await runJobs(ctx.db, 'test');
    expect(count(ctx.db, `SELECT COUNT(*) c FROM undertakings WHERE document_id=?`, docId)).toBe(1);

    const r = await upload(ctx, 'inst1@demo.local', { renew_of: String(docId), expiry_date: '2029-04-15', issue_date: '2026-04-16', reference_no: 'LEASE-NEW' });
    expect(r.status).toBe(201);

    const updatedUnd = ctx.db.prepare(`SELECT status FROM undertakings WHERE id=?`).get(und.id) as any;
    expect(updatedUnd.status).toBe('closed');
  });
});
