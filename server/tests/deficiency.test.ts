import { describe, it, expect, beforeEach } from 'vitest';
import { makeCtx, newApp, count, type Ctx } from './helpers';

let ctx: Ctx;
beforeEach(() => { ctx = makeCtx(); });

describe('deficiencies and corrective actions', () => {
  it('raises a deficiency on return, records the corrective action on resubmission, and closes it when the officer accepts', async () => {
    const id = await newApp(ctx);
    const ro = await ctx.as('ro.nr@demo.local'), inst = await ctx.as('inst1@demo.local');
    await ro.post(`/api/applications/${id}/transitions`, { action: 'return', reason: 'Lease page 3 missing', deficiency_category: 'document' });
    let d = (await inst.get(`/api/applications/${id}`)).body.deficiencies;
    expect(d).toHaveLength(1); expect(d[0]).toMatchObject({ status: 'open', category: 'document', description: 'Lease page 3 missing', stage_key: 'scrutiny', rule_code: 'R-EOA-03' }); expect(d[0].due_date).toBe('2026-03-09');
    await inst.post(`/api/applications/${id}/transitions`, { action: 'resubmit', reason: 'Full lease deed uploaded' });
    d = (await inst.get(`/api/applications/${id}`)).body.deficiencies; expect(d[0]).toMatchObject({ status: 'responded', corrective_action: 'Full lease deed uploaded' });
    await ro.post(`/api/applications/${id}/observations`, { text: 'Lease now complete.' });
    await ro.post(`/api/applications/${id}/transitions`, { action: 'complete_scrutiny' });
    d = (await inst.get(`/api/applications/${id}`)).body.deficiencies; expect(d[0].status).toBe('closed'); expect(d[0].closed_at).toBeTruthy();
    expect(count(ctx.db, `SELECT COUNT(*) c FROM audit_log WHERE event_type LIKE 'deficiency.%'`)).toBe(3);
  });
  it('is scoped like the application: another institution cannot read it', async () => {
    const id = await newApp(ctx);
    await (await ctx.as('ro.nr@demo.local')).post(`/api/applications/${id}/transitions`, { action: 'return', reason: 'Clarify' });
    expect((await (await ctx.as('inst2@demo.local')).get(`/api/applications/${id}`)).status).toBe(404);
  });
  it('stores an EVC report with its outcome when the visit is recorded', async () => {
    const id = await newApp(ctx, 'inst1@demo.local', 'NEW');
    const ro = await ctx.as('ro.nr@demo.local'); await ro.post(`/api/applications/${id}/observations`, { text: 'Reviewed, fine.' }); await ro.post(`/api/applications/${id}/transitions`, { action: 'complete_scrutiny' });
    const e = ctx.db.prepare('SELECT * FROM evc_schedules WHERE application_id=?').get(id) as any; const co = await ctx.as('evc.nr@demo.local');
    const c = (ctx.db.prepare('SELECT id FROM evc_committees WHERE region_id=? LIMIT 1').get(e.region_id) as any).id;
    await co.post(`/api/evc/${e.id}/schedule`, { confirmed_date: '2026-03-03', committee_id: c });
    const { setNow } = await import('./helpers'); setNow('2026-03-04T04:30:00Z');
    await co.post(`/api/evc/${e.id}/complete`, { visit_date: '2026-03-03', notes: 'Labs incomplete', outcome: 'deficiencies_noted' });
    expect((await co.get(`/api/evc/${e.id}`)).body.report).toMatchObject({ outcome: 'deficiencies_noted', summary: 'Labs incomplete' });
  });
});
