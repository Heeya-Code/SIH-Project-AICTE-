import { describe, it, expect, beforeEach } from 'vitest';
import { makeCtx, newApp, setNow, count, scrutinise, type Ctx } from './helpers';
import { runJobs } from '../src/jobs';

let ctx: Ctx;
beforeEach(() => { ctx = makeCtx(); });

describe('global search', () => {
  it('finds applications, documents and obligations, only within the caller\'s own scope', async () => {
    const a = await newApp(ctx, 'inst1@demo.local'); const b = await newApp(ctx, 'inst3@demo.local');          // Northern and Southern Region
    const ro = await (await ctx.as('ro.nr@demo.local')).get(`/api/search?q=AF-2026`);
    expect(ro.body.applications.map((x: any) => x.id)).toEqual([a]);
    const inst2 = await (await ctx.as('inst2@demo.local')).get('/api/search?q=AF-2026'); expect(inst2.body.applications).toEqual([]);
    const docs = (await (await ctx.as('inst1@demo.local')).get('/api/search?q=lease agree')).body.documents; expect(docs[0]).toMatchObject({ name: 'Lease Agreement' }); expect(docs[0].code).toMatch(/^DOC-\d{4}$/);
    expect((await (await ctx.as('ro.nr@demo.local')).get('/api/search?q=lease')).body.documents.every((d: any) => d.institution.includes('Aravalli') || d.institution.includes('Himalaya'))).toBe(true);
    const byTitle = (await (await ctx.as('bureau@demo.local')).get(`/api/search?q=${encodeURIComponent('Test application')}`)).body.applications; expect(byTitle.length).toBe(2); void b;
    expect((await (await ctx.as('inst1@demo.local')).get('/api/search?q=a')).body.applications).toEqual([]);                  // too short: nothing is sent to the database
    expect((await (await ctx.as('inst1@demo.local')).get('/api/search?q=%25%25')).status).toBe(200);                              // wildcards are neutralised
    const { default: request } = await import('supertest'); expect((await request(ctx.app).get('/api/search?q=AF')).status).toBe(401);
  });
  it('does not show draft applications to officers', async () => {
    await newApp(ctx, 'inst1@demo.local', 'EXT', false);
    expect((await (await ctx.as('ro.nr@demo.local')).get('/api/search?q=AF-2026')).body.applications).toEqual([]);
    expect((await (await ctx.as('inst1@demo.local')).get('/api/search?q=AF-2026')).body.applications.length).toBe(1);
  });
});

describe('priority list ("needs your attention")', () => {
  it('ranks an institution\'s items by urgency and explains each one', async () => {
    const ready = await newApp(ctx, 'inst1@demo.local', 'EXT', false);                                                    // every document uploaded, not submitted
    const draft = (await (await ctx.as('inst1@demo.local')).post('/api/applications', { category_code: 'EXT', title: 'Bare draft without documents' })).body.id;
    const sub = await newApp(ctx, 'inst1@demo.local'); await (await ctx.as('ro.nr@demo.local')).post(`/api/applications/${sub}/transitions`, { action: 'return', reason: 'Lease unclear' });
    const u = await (await ctx.as('ro.nr@demo.local')).post('/api/undertakings', { institution_id: 1, condition_text: 'Submit audited accounts', description: 'Accounts', required_evidence: 'Signed PDF', due_date: '2026-03-20' });
    setNow('2026-03-12T04:30:00Z');
    const att = (await (await ctx.as('inst1@demo.local')).get('/api/dashboard')).body.attention;
    expect(att.criteria.map((c: any) => c.rank)).toEqual([1, 2, 3, 4, 5]); expect(att.ordering).toMatch(/assigned to you come first/);
    const ranks = att.items.map((i: any) => i.rank); expect(ranks).toEqual([...ranks].sort((a: number, b: number) => a - b));
    expect(att.items.every((i: any) => i.why.length > 0 && i.action && i.link && i.rank_label)).toBe(true);
    const respond = att.items.find((i: any) => i.title.startsWith('Respond to the request')); expect(respond.rank).toBe(1); expect(respond.why.join(' ')).toMatch(/Lease unclear/); expect(respond.why.join(' ')).toMatch(/3 days ago/);       // the 7-day response window ended on 9 March
    setNow('2026-03-25T04:30:00Z'); const later = (await (await ctx.as('inst1@demo.local')).get('/api/dashboard')).body.attention;
    expect(later.items[0].rank).toBe(1); expect(later.items.filter((i: any) => i.rank === 1).map((i: any) => i.title).join('|')).toMatch(/Respond to the request.*|Submit evidence for UT/);
    expect(later.items.find((i: any) => i.key === `draft-${draft}`).why.join(' ')).toMatch(/Missing: .*Lease Agreement/); expect(later.items.find((i: any) => i.key === `draft-${draft}`).rank).toBe(4);
    const rdy = later.items.find((i: any) => i.key === `draft-${ready}`); expect(rdy.title).toMatch(/ready to submit/); expect(rdy.rank).toBe(5); expect(rdy.why.join(' ')).toMatch(/still a draft/);
    expect(later.items.find((i: any) => i.title.includes('UT-')).why.join(' ')).toMatch(/Overdue by 5 days/); void u;
  });
  it('puts overdue cases first for an officer and marks the ones assigned to them', async () => {
    const a = await newApp(ctx, 'inst1@demo.local'); const b = await newApp(ctx, 'inst2@demo.local');
    const mine = ctx.db.prepare('SELECT u.id, u.email FROM applications a JOIN users u ON u.id=a.assigned_user_id WHERE a.id=?').get(a) as any;
    setNow('2026-03-24T04:30:00Z');
    const att = (await (await ctx.as(mine.email)).get('/api/dashboard')).body.attention;
    expect(att.items[0].rank).toBe(1); expect(att.items[0].why.join(' ')).toMatch(/past its deadline|Days in stage|Deadline/);
    const assigned = att.items.filter((i: any) => i.why.includes('Assigned to you')); expect(assigned.length).toBeGreaterThan(0);
    const firstRank1 = att.items.filter((i: any) => i.rank === 1); expect(firstRank1[0].why).toContain('Assigned to you');
    void b;
  });
  it('gives the competent authority overdue decisions, the EVC coordinator unscheduled visits, and the administrator configuration gaps', async () => {
    const id = await newApp(ctx); await scrutinise(ctx, id);
    const e = await newApp(ctx, 'inst1@demo.local', 'NEW'); await scrutinise(ctx, e);
    setNow('2026-03-20T04:30:00Z');
    const auth = (await (await ctx.as('authority@demo.local')).get('/api/dashboard')).body.attention.items; const d = auth.find((i: any) => i.title.startsWith('Decision needed on')); expect(d).toBeTruthy(); expect(d.why.join(' ')).toMatch(/Only the competent authority/);
    const evc = (await (await ctx.as('evc.nr@demo.local')).get('/api/dashboard')).body.attention.items.find((i: any) => i.title.startsWith('Schedule the EVC visit')); expect(evc.rank).toBe(1); expect(evc.why.join(' ')).toMatch(/Scheduling deadline passed/);
    const adm = (await (await ctx.as('admin@demo.local')).get('/api/dashboard')).body.attention.items.map((i: any) => i.title).join('|'); expect(adm).toMatch(/without a recorded licence/); expect(adm).toMatch(/not yet reviewed/);
  });
  it('is never empty-handed about why: every item for every role carries reasons', async () => {
    await newApp(ctx); setNow('2026-04-10T04:30:00Z'); await runJobs(ctx.db, 'test');
    for (const e of ['inst1@demo.local', 'ro.nr@demo.local', 'bureau@demo.local', 'authority@demo.local', 'evc.nr@demo.local', 'admin@demo.local']) {
      const att = (await (await ctx.as(e)).get('/api/dashboard')).body.attention; expect(att.items.every((i: any) => i.why.length > 0 && i.rank >= 1 && i.rank <= 5), e).toBe(true);
    }
  });
});

describe('case detail: stage summary, next steps and readiness', () => {
  it('explains where the case is, who has it, and what can happen next', async () => {
    const id = await newApp(ctx, 'inst1@demo.local', 'NEW'); const d = (await (await ctx.as('inst1@demo.local')).get(`/api/applications/${id}`)).body;
    expect(d.stage_summary).toMatchObject({ name: 'Scrutiny', responsible_role: 'regional_officer', waiting_on: 'regional officer' }); expect(d.stage_summary.assignee).toBeTruthy(); expect(d.stage_summary.pending_action).toMatch(/Before this can move on: .*observation.*Then complete scrutiny and send for EVC\./);
    const next = d.next_steps.map((s: any) => `${s.action}->${s.to_stage_name}`); expect(next).toEqual(['complete_scrutiny->Expert Visit Committee', 'return->Clarification by institution']);
    expect(d.next_steps[0]).toMatchObject({ role: 'regional_officer', requires_reason: false }); expect(d.next_steps[0].requirements.join(' ')).toMatch(/observation/);
    await (await ctx.as('ro.nr@demo.local')).post(`/api/applications/${id}/observations`, { text: 'Documents checked.' });
    expect((await (await ctx.as('inst1@demo.local')).get(`/api/applications/${id}`)).body.stage_summary.pending_action).toBe('Ready for the next step: complete scrutiny and send for EVC.');
    await scrutinise(ctx, id); const evc = (await (await ctx.as('inst1@demo.local')).get(`/api/applications/${id}`)).body;
    expect(evc.stage_summary.pending_action).toMatch(/Schedule the expert visit/); expect(evc.next_steps[0]).toMatchObject({ action: 'evc_completed', automatic: true });
  });
  it('distinguishes not ready, ready to submit, submitted and approved, and never calls unverified documents ready', async () => {
    const inst = await ctx.as('inst1@demo.local'); const draft = (await inst.post('/api/applications', { category_code: 'EXT', title: 'Readiness test application' })).body.id;
    let r = (await inst.get(`/api/applications/${draft}`)).body.readiness; expect(r).toMatchObject({ state: 'not_ready', can_submit: false, missing: 2 }); expect(r.stage_summary).toBeUndefined();
    const { upload } = await import('./helpers'); await upload(ctx, 'inst1@demo.local', { application_id: String(draft), doc_type: 'Lease Deed', expiry_date: '2028-01-01' }); await upload(ctx, 'inst1@demo.local', { application_id: String(draft), doc_type: 'Annual Self-Disclosure' });
    r = (await inst.get(`/api/applications/${draft}`)).body.readiness; expect(r).toMatchObject({ state: 'ready_to_submit', can_submit: true, awaiting_verification: 2, verified: 0 }); expect(r.label).toMatch(/Nothing has been sent yet/); expect(r.note).toMatch(/does not mean the documents are accepted/);
    await inst.post(`/api/applications/${draft}/submit`); r = (await inst.get(`/api/applications/${draft}`)).body.readiness; expect(r.state).toBe('submitted');
    const ro = await ctx.as('ro.nr@demo.local'); const doc = (await ro.get('/api/documents?queue=1')).body.rows[0]; await ro.post(`/api/documents/${doc.id}/verify`, { decision: 'returned', note: 'Scan unreadable' });
    const items = (await inst.get(`/api/applications/${draft}`)).body.readiness.items; expect(items.find((i: any) => i.state === 'returned').correction).toBe('Scan unreadable');
    await scrutinise(ctx, draft); await (await ctx.as('authority@demo.local')).post(`/api/applications/${draft}/transitions`, { action: 'approve' });
    expect((await inst.get(`/api/applications/${draft}`)).body.readiness.state).toBe('approved');
  });
});

describe('case audit history and notifications', () => {
  it('shows officers the audit trail of the case, its documents and deficiencies, but not institutions or other Regions', async () => {
    const id = await newApp(ctx); const ro = await ctx.as('ro.nr@demo.local');
    await ro.post(`/api/applications/${id}/transitions`, { action: 'return', reason: 'Clarify lease' });
    const rows = (await ro.get(`/api/applications/${id}/audit`)).body.rows; const types = rows.map((r: any) => r.event_type);
    expect(types).toEqual(expect.arrayContaining(['application.created', 'application.submitted', 'application.transition', 'document.uploaded', 'deficiency.raised']));
    expect(rows.every((r: any) => r.actor_label && r.at)).toBe(true);
    expect((await (await ctx.as('inst1@demo.local')).get(`/api/applications/${id}/audit`)).status).toBe(403);
    expect((await (await ctx.as('ro.sr@demo.local')).get(`/api/applications/${id}/audit`)).status).toBe(404);
    expect((await (await ctx.as('admin@demo.local')).get(`/api/applications/${id}/audit`)).status).toBe(200);
  });
  it('lists only the caller\'s own notifications about the case', async () => {
    const id = await newApp(ctx); await (await ctx.as('ro.nr@demo.local')).post(`/api/applications/${id}/transitions`, { action: 'return', reason: 'Clarify' });
    const mine = (await (await ctx.as('inst1@demo.local')).get(`/api/applications/${id}/notifications`)).body; expect(mine.map((n: any) => n.event)).toEqual(expect.arrayContaining(['application.returned', 'application.submitted']));
    expect((await (await ctx.as('inst2@demo.local')).get(`/api/applications/${id}/notifications`)).status).toBe(404);
    expect(count(ctx.db, `SELECT COUNT(*) c FROM notifications WHERE user_id=(SELECT id FROM users WHERE email='bureau@demo.local')`)).toBe(0);
  });
  it('groups notifications by urgency and names the related record', async () => {
    const id = await newApp(ctx); await (await ctx.as('ro.nr@demo.local')).post(`/api/applications/${id}/transitions`, { action: 'return', reason: 'Clarify' });
    setNow('2026-03-20T04:30:00Z'); await runJobs(ctx.db, 'test');
    const rows = (await (await ctx.as('inst1@demo.local')).get('/api/notifications?pageSize=50')).body.rows;
    const returned = rows.find((n: any) => n.event === 'application.returned'); expect(returned).toMatchObject({ urgency: 'action', related: expect.stringMatching(/^AF-2026-/) });
    expect(rows.find((n: any) => n.event === 'application.submitted').urgency).toBe('update'); expect(rows.some((n: any) => n.urgency === 'urgent')).toBe(true);
  });
  it('groups the institution\'s deadlines by urgency with the responsible role and the required action', async () => {
    const id = await newApp(ctx); await (await ctx.as('ro.nr@demo.local')).post(`/api/applications/${id}/transitions`, { action: 'return', reason: 'Clarify' });
    await (await ctx.as('ro.nr@demo.local')).post('/api/undertakings', { institution_id: 1, condition_text: 'Submit accounts', description: 'Accounts', required_evidence: 'PDF', due_date: '2026-03-30' });
    setNow('2026-03-12T04:30:00Z');
    const list = (await (await ctx.as('inst1@demo.local')).get('/api/dashboard')).body.lists.find((l: any) => l.key === 'deadlines'); expect(list.grouped).toBe(true);
    expect(list.rows.every((r: any) => ['overdue', 'due_soon', 'later'].includes(r.group) && r.role && r.action && r.urgency && r.link)).toBe(true);
    expect(list.rows.find((r: any) => r.what.startsWith('Response to the request')).group).toBe('overdue'); expect(list.rows.find((r: any) => r.what.includes('Submit accounts')).group).toBe('later');
  });
});
