import { describe, it, expect, beforeEach } from 'vitest';
import { makeCtx, newApp, setNow, count, scrutinise, type Ctx } from './helpers';
import { generateApplications } from '../src/generate';

let ctx: Ctx;
beforeEach(() => { ctx = makeCtx(); });

describe('document verification queue', () => {
  it('lists pending documents of submitted applications, oldest first, scoped to the Region, and excludes drafts', async () => {
    const a = await newApp(ctx, 'inst1@demo.local'); setNow('2026-03-05T04:30:00Z'); const b = await newApp(ctx, 'inst2@demo.local'); await newApp(ctx, 'inst1@demo.local', 'EXT', false); await newApp(ctx, 'inst3@demo.local');   // draft + other Region
    setNow('2026-03-12T04:30:00Z');
    const ro = await ctx.as('ro.nr@demo.local'); const q = (await ro.get('/api/documents?queue=1&pageSize=50')).body;
    expect(q.rows.every((d: any) => d.verification_status === 'pending' && d.is_current === 1 && d.app_status === 'in_progress')).toBe(true);
    expect(new Set(q.rows.map((d: any) => d.application_id))).toEqual(new Set([a, b]));
    const waits = q.rows.map((d: any) => d.waiting_days); expect(waits).toEqual([...waits].sort((x: number, y: number) => y - x)); expect(waits[0]).toBe(10); expect(waits[waits.length - 1]).toBe(7);
    const sum = (await ro.get('/api/documents/queue-summary')).body; expect(sum).toMatchObject({ pending: q.total, waiting_over_7_days: q.total });
    expect((await (await ctx.as('inst1@demo.local')).get('/api/documents/queue-summary')).status).toBe(403);
    expect((await (await ctx.as('evc.nr@demo.local')).get('/api/documents/queue-summary')).status).toBe(403);
  });
  it('removes a document from the queue when an officer decides, and a returned one waits for the institution', async () => {
    const id = await newApp(ctx); const ro = await ctx.as('ro.nr@demo.local');
    const first = (await ro.get('/api/documents?queue=1')).body.rows; expect(first.length).toBe(2);
    await ro.post(`/api/documents/${first[0].id}/verify`, { decision: 'verified', note: 'Checked' }); await ro.post(`/api/documents/${first[1].id}/verify`, { decision: 'returned', note: 'Unreadable scan' });
    expect((await ro.get('/api/documents?queue=1')).body.total).toBe(0);
    expect((await ro.get('/api/documents/queue-summary')).body).toMatchObject({ pending: 0, returned_awaiting_institution: 1 });
    void id;
  });
});

describe('case timeline and deadline risk', () => {
  it('shows deficiencies, corrective action, document verification and closure in order', async () => {
    const id = await newApp(ctx); const ro = await ctx.as('ro.nr@demo.local'), inst = await ctx.as('inst1@demo.local');
    const doc = (await ro.get('/api/documents?queue=1')).body.rows[0];
    await ro.post(`/api/documents/${doc.id}/verify`, { decision: 'returned', note: 'Page missing' });
    await ro.post(`/api/applications/${id}/transitions`, { action: 'return', reason: 'Lease page missing', deficiency_category: 'document' });
    setNow('2026-03-04T04:30:00Z'); await inst.post(`/api/applications/${id}/transitions`, { action: 'resubmit', reason: 'Full lease uploaded' });
    setNow('2026-03-05T04:30:00Z'); await scrutinise(ctx, id);
    const tl = (await inst.get(`/api/applications/${id}/timeline`)).body; const kinds = tl.map((e: any) => `${e.kind}:${e.title}`);
    expect(kinds.some((k: string) => k.startsWith('deficiency:Deficiency raised (document)'))).toBe(true); expect(kinds).toContain('deficiency:Corrective action submitted by the institution'); expect(kinds).toContain('deficiency:Deficiency closed');
    expect(kinds.some((k: string) => k.startsWith('verification:') && k.includes('returned') && k.includes('(DOC-'))).toBe(true);
    const at = (needle: string) => tl.findIndex((e: any) => `${e.kind}:${e.title}`.startsWith(needle)); expect(at('deficiency:Deficiency raised')).toBeLessThan(at('deficiency:Corrective action')); expect(at('deficiency:Corrective action')).toBeLessThan(at('deficiency:Deficiency closed'));
    expect(tl.map((e: any) => e.at)).toEqual([...tl.map((e: any) => e.at)].sort());
  });
  it('explains the deadline risk of a case from its own numbers, and is absent for finished cases', async () => {
    const id = await newApp(ctx); const ro = await ctx.as('ro.nr@demo.local');
    let r = (await ro.get(`/api/applications/${id}`)).body.deadline_risk; expect(r.risk).toBe('on_track'); expect(r.factors.join(' ')).toMatch(/deadline 2026-03-16/); expect(r.factors.join(' ')).toMatch(/too little history/);
    setNow('2026-03-14T04:30:00Z'); r = (await ro.get(`/api/applications/${id}`)).body.deadline_risk; expect(r.risk).toBe('watch'); expect(r.factors.join(' ')).toMatch(/only 2 day/);
    setNow('2026-03-20T04:30:00Z'); r = (await ro.get(`/api/applications/${id}`)).body.deadline_risk; expect(r.risk).toBe('confirmed_overdue'); expect(r.factors.join(' ')).toMatch(/4 day\(s\) past the deadline/);
    setNow('2026-03-20T04:40:00Z'); await ro.post(`/api/applications/${id}/observations`, { text: 'Fine for decision.' }); await ro.post(`/api/applications/${id}/transitions`, { action: 'complete_scrutiny' });
    await (await ctx.as('authority@demo.local')).post(`/api/applications/${id}/transitions`, { action: 'approve' });
    expect((await ro.get(`/api/applications/${id}`)).body.deadline_risk).toBeNull();
  });
});

describe('generator limits', () => {
  it('rejects counts and day ranges outside the supported bounds', async () => {
    for (const bad of [{ count: 0 }, { count: 5001 }, { count: 10.5 }, { days: 5 }, { days: 5000 }, { seed: 1.5 }]) await expect(generateApplications(ctx.db, { ...bad, quiet: true })).rejects.toThrow();
    expect(count(ctx.db, 'SELECT COUNT(*) c FROM seed_runs')).toBe(0);
  });
});
