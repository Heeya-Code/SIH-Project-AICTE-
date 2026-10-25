import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { makeCtx, newApp, count, upload, type Ctx } from './helpers';
import { placeholderPdf } from '../src/files';
import { audit, verifyAuditChain, actorOf } from '../src/audit';

let ctx: Ctx;
beforeEach(() => { ctx = makeCtx(); });

describe('tenant isolation', () => {
  it('institution A cannot see, change or download institution B records', async () => {
    const idB = await newApp(ctx, 'inst2@demo.local');
    const a = await ctx.as('inst1@demo.local');
    expect((await a.get(`/api/applications/${idB}`)).status).toBe(404);
    expect((await a.get(`/api/applications/${idB}/timeline`)).status).toBe(404);
    expect((await a.get('/api/applications')).body.total).toBe(0);
    const doc = ctx.db.prepare('SELECT id FROM documents WHERE application_id=? LIMIT 1').get(idB) as any;
    expect((await a.get(`/api/documents/${doc.id}/download`)).status).toBe(404);
    expect((await a.get(`/api/documents/${doc.id}/versions`)).status).toBe(404);
    expect((await a.get('/api/documents')).body.total).toBe(0);
    expect((await upload(ctx, 'inst1@demo.local', { application_id: String(idB), doc_type: 'Lease Deed', expiry_date: '2028-01-01' })).status).toBe(404);
    const rep = (await a.get('/api/reports/applications_register')).body; expect(rep.total).toBe(0);
    const owner = await ctx.as('inst2@demo.local'); expect((await owner.get(`/api/documents/${doc.id}/download`)).status).toBe(200);
  });

  it('officers see only their Region, and drafts stay private to the institution', async () => {
    await newApp(ctx, 'inst1@demo.local'); await newApp(ctx, 'inst3@demo.local');       // NR and SR
    const draft = await newApp(ctx, 'inst1@demo.local', 'EXT', false);
    const nr = await ctx.as('ro.nr@demo.local');
    const ids = (await nr.get('/api/applications')).body.rows;
    expect(ids).toHaveLength(1); expect(ids.every((x: any) => x.region_code === 'NR')).toBe(true);
    expect((await nr.get(`/api/applications/${draft}`)).status).toBe(404);
    expect((await (await ctx.as('bureau@demo.local')).get('/api/applications')).body.total).toBe(2);
    expect((await (await ctx.as('ro.nr@demo.local')).get('/api/dashboard')).body.cards[0].value).toBe(1);
  });

  it('hides internal observations and escalations from the institution', async () => {
    const id = await newApp(ctx);
    await (await ctx.as('ro.nr@demo.local')).post(`/api/applications/${id}/observations`, { text: 'Internal note' });
    const inst = await ctx.as('inst1@demo.local');
    expect((await inst.get(`/api/applications/${id}`)).body.observations).toEqual([]);
    expect(JSON.stringify((await inst.get(`/api/applications/${id}/timeline`)).body)).not.toContain('Internal note');
    expect((await inst.get('/api/escalations')).status).toBe(403);
  });
});

describe('authorisation cannot be bypassed from the client', () => {
  it('blocks restricted endpoints for the wrong roles', async () => {
    const inst = await ctx.as('inst1@demo.local'), ro = await ctx.as('ro.nr@demo.local'), evc = await ctx.as('evc.nr@demo.local');
    for (const [who, method, url] of [[inst, 'get', '/api/users'], [inst, 'get', '/api/audit'], [inst, 'get', '/api/admin/settings'], [ro, 'get', '/api/users'], [ro, 'get', '/api/admin/jobs'], [evc, 'get', '/api/audit']] as const)
      expect((await (who as any)[method](url)).status, `${method} ${url}`).toBe(403);
    expect((await ro.post('/api/workflows/1/versions', { definition: { stages: [], transitions: [] }, activate: true })).status).toBe(403);
    expect((await ro.post('/api/admin/clock', { advance_days: 3 })).status).toBe(403);
    expect((await ro.get('/api/reports/notification_delivery')).status).toBe(404);
    expect((await inst.post('/api/applications/1/observations', { text: 'abc' })).status).toBe(404);
    expect((await inst.post('/api/undertakings', { institution_id: 1, condition_text: 'abc', description: 'abc', required_evidence: 'abc', due_date: '2026-09-01' })).status).toBe(403);
    expect((await ro.post('/api/applications', { category_code: 'EXT', title: 'Created by officer' })).status).toBe(403);
  });
  it('does not allow editing a submitted application or acting on someone else’s escalation', async () => {
    const id = await newApp(ctx);
    expect((await (await ctx.as('inst1@demo.local')).patch(`/api/applications/${id}`, { title: 'Changed after submit' })).status).toBe(403);
    const { runJobs } = await import('../src/jobs'); const { setNow } = await import('./helpers');
    setNow('2026-03-20T04:30:00Z'); await runJobs(ctx.db, 'test');
    const e = ctx.db.prepare(`SELECT x.id, u.email FROM escalation_events x JOIN users u ON u.id=x.recipient_user_id LIMIT 1`).get() as any;
    const stranger = e.email === 'bureau@demo.local' ? 'authority@demo.local' : 'bureau@demo.local';
    expect((await (await ctx.as(stranger)).post(`/api/escalations/${e.id}/ack`)).status).toBe(403);
    expect((await (await ctx.as(e.email)).post(`/api/escalations/${e.id}/ack`)).status).toBe(200);
    expect((await (await ctx.as(e.email)).post(`/api/escalations/${e.id}/ack`)).status).toBe(409);
  });
  it('ignores a client-supplied institution, role or Region', async () => {
    const a = await ctx.as('inst1@demo.local');
    const r = await a.post('/api/applications', { category_code: 'EXT', title: 'Spoof attempt', institution_id: 2, region_id: 3, role: 'admin', status: 'approved' });
    expect(r.status).toBe(201);
    expect(ctx.db.prepare('SELECT institution_id, region_id, status FROM applications WHERE id=?').get(r.body.id)).toEqual({ institution_id: 1, region_id: 1, status: 'draft' });
  });
});

describe('authentication', () => {
  it('rejects bad credentials, forged tokens and deactivated users', async () => {
    expect((await request(ctx.app).post('/api/auth/login').send({ email: 'ro.nr@demo.local', password: 'wrong-password' })).status).toBe(401);
    expect((await request(ctx.app).post('/api/auth/login').send({ email: 'nobody@demo.local', password: 'x' })).status).toBe(401);
    expect((await request(ctx.app).get('/api/applications')).status).toBe(401);
    const forged = jwt.sign({ sub: 1 }, 'not-the-secret');
    expect((await request(ctx.app).get('/api/applications').set('Authorization', `Bearer ${forged}`)).status).toBe(401);
    const admin = await ctx.as('admin@demo.local'); const ro = await ctx.as('ro.nr@demo.local');
    const roId = (ctx.db.prepare(`SELECT id FROM users WHERE email='ro.nr@demo.local'`).get() as any).id;
    expect((await admin.patch(`/api/users/${roId}`, { active: false })).status).toBe(200);
    expect((await ro.get('/api/applications')).status).toBe(401);                            // existing token stops working at once
  });
  it('stores only password hashes and never returns them', async () => {
    const admin = await ctx.as('admin@demo.local');
    expect((ctx.db.prepare('SELECT password_hash FROM users LIMIT 1').get() as any).password_hash).toMatch(/^\$2[aby]\$/);
    expect(JSON.stringify((await admin.get('/api/users')).body)).not.toContain('password');
    const created = await admin.post('/api/users', { email: 'new.ro@demo.local', name: 'New Officer', role: 'regional_officer', region_id: 1, password: 'short' });
    expect(created.status).toBe(400);
  });
  it('audits user, role and configuration changes and protects the last administrator', async () => {
    const admin = await ctx.as('admin@demo.local');
    const roId = (ctx.db.prepare(`SELECT id FROM users WHERE email='ro.nr@demo.local'`).get() as any).id;
    expect((await admin.patch(`/api/users/${roId}`, { role: 'bureau_officer' })).status).toBe(200);
    expect((await admin.put('/api/admin/settings/reminder_days_task', { value: '[10,3,1]' })).status).toBe(200);
    expect((await admin.put('/api/admin/settings/reminder_days_task', { value: 'abc' })).status).toBe(400);
    const events = (ctx.db.prepare(`SELECT event_type FROM audit_log WHERE (event_type LIKE 'user.%' OR event_type LIKE 'config.%') AND event_type NOT IN ('config.regulatory_data_loaded','config.category_route_changed','config.public_data_registry_loaded') ORDER BY id`).all() as any[]).map(e => e.event_type);
    expect(events).toEqual(['user.role_changed', 'config.setting_changed']);
    const adminId = (ctx.db.prepare(`SELECT id FROM users WHERE email='admin@demo.local'`).get() as any).id;
    expect((await admin.patch(`/api/users/${adminId}`, { active: false })).status).toBe(403);
  });
});

describe('uploads', () => {
  const t = (name: string, buf: Buffer, fields: Record<string, string> = {}) => upload(ctx, 'inst1@demo.local', { doc_type: 'Other', ...fields }, name, buf);
  it('accepts only PDF/PNG/JPEG whose content matches the extension', async () => {
    expect((await t('a.pdf', placeholderPdf('x'))).status).toBe(201);
    expect((await t('a.exe', Buffer.from('MZ\x90\x00'))).status).toBe(400);
    expect((await t('a.pdf', Buffer.from('MZ\x90\x00 pretending to be a pdf'))).status).toBe(400);
    expect((await t('a.png', placeholderPdf('x'))).status).toBe(400);                        // PDF content, PNG extension
    expect((await t('a.pdf', Buffer.from('plain text'))).status).toBe(400);
    expect((await t('a.png', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]))).status).toBe(201);
    expect((await t('a.pdf', Buffer.alloc(0))).status).toBe(400);
  });
  it('rejects oversized files and unsafe names, and never stores the client-supplied name on disk', async () => {
    const big = Buffer.concat([Buffer.from('%PDF-'), Buffer.alloc(6 * 1024 * 1024)]);
    const r = await t('big.pdf', big); expect(r.status).toBe(400); expect(r.body.error.message).toContain('too large');
    const ok = await t('../../etc/passwd.pdf', placeholderPdf('x')); expect(ok.status).toBe(201);
    const row = ctx.db.prepare('SELECT file_name, storage_ref FROM documents WHERE id=?').get(ok.body.id) as any;
    expect(row.storage_ref).toMatch(/^[0-9a-f-]{36}\.pdf$/); expect(row.file_name).not.toContain('/');
  });
  it('serves files only with attachment headers and no sniffing', async () => {
    const ok = await t('a.pdf', placeholderPdf('x'));
    const a = await ctx.as('inst1@demo.local'); const r = await a.get(`/api/documents/${ok.body.id}/download`);
    expect(r.headers['content-disposition']).toContain('attachment'); expect(r.headers['x-content-type-options']).toBe('nosniff');
  });
});

describe('error handling does not leak internals', () => {
  it('returns structured errors without stack traces or SQL', async () => {
    const a = await ctx.as('inst1@demo.local');
    const bad = await request(ctx.app).post('/api/auth/login').set('Content-Type', 'application/json').send('{not json');
    expect(bad.status).toBe(400); expect(JSON.stringify(bad.body)).not.toMatch(/at .*\(|node_modules|SyntaxError/);
    expect((await request(ctx.app).get('/api/does-not-exist').set(a.headers)).body.error.code).toBe('NOT_FOUND');
    expect((await a.post('/api/applications', { category_code: 'EXT', title: 'x' })).body.error.details[0].field).toBe('title');
    ctx.db.exec('ALTER TABLE tasks RENAME TO tasks_broken');                                 // force an unexpected internal failure
    const boom = await a.get('/api/tasks');
    expect(boom.status).toBe(500); expect(boom.body.error.code).toBe('INTERNAL');
    expect(JSON.stringify(boom.body)).not.toMatch(/tasks|SQLITE|SqliteError|at /); expect(boom.body.error.correlationId).toBeTruthy();
  });
});

describe('audit trail integrity', () => {
  it('refuses to modify or delete audit events and detects tampering done outside the application', async () => {
    await newApp(ctx);
    expect(count(ctx.db, 'SELECT COUNT(*) c FROM audit_log')).toBeGreaterThan(3);
    expect(() => ctx.db.prepare(`UPDATE audit_log SET reason='x' WHERE id=1`).run()).toThrow(/append-only/);
    expect(() => ctx.db.prepare('DELETE FROM audit_log WHERE id=1').run()).toThrow(/append-only/);
    expect(verifyAuditChain(ctx.db)).toMatchObject({ ok: true });
    ctx.db.exec('DROP TRIGGER audit_log_no_update');                                          // someone with raw database access
    ctx.db.prepare(`UPDATE audit_log SET new_state='{"stage":"forged"}' WHERE id=2`).run();
    expect(verifyAuditChain(ctx.db)).toMatchObject({ ok: false, brokenAtId: 2 });
  });
  it('records actor, entity, previous and new state, reason, server time and correlation id', async () => {
    const id = await newApp(ctx);
    const ro = await ctx.as('ro.nr@demo.local');
    await ro.post(`/api/applications/${id}/transitions`, { action: 'return', reason: 'Needs clarification' });
    const e = ctx.db.prepare(`SELECT * FROM audit_log WHERE event_type='application.transition' ORDER BY id DESC LIMIT 1`).get() as any;
    expect(e).toMatchObject({ entity_type: 'application', entity_id: String(id), reason: 'Needs clarification' });
    expect(e.actor_label).toContain('regional_officer'); expect(JSON.parse(e.prev_state).stage).toBe('scrutiny'); expect(JSON.parse(e.new_state).stage).toBe('clarification');
    expect(e.at).toMatch(/^\d{4}-\d{2}-\d{2}T/); expect(e.event_id).toHaveLength(36);
    const admin = await ctx.as('admin@demo.local');
    expect((await admin.get('/api/audit?event_type=application.transition')).body.total).toBe(1);
    expect((await admin.get('/api/audit/verify')).body.ok).toBe(true);
    void audit; void actorOf;
  });
});
