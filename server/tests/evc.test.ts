import { describe, it, expect, beforeEach } from 'vitest';
import { makeCtx, newApp, count, scrutinise, setNow, type Ctx } from './helpers';

let ctx: Ctx;
beforeEach(() => { ctx = makeCtx(); });
const committee = (region: number, n = 0) => (ctx.db.prepare('SELECT id FROM evc_committees WHERE region_id=? ORDER BY id LIMIT 1 OFFSET ?').get(region, n) as any).id;

describe('EVC scheduling', () => {
  it('queues an eligible application; an application that does not need EVC never appears', async () => {
    const needs = await newApp(ctx, 'inst1@demo.local', 'NEW'); await scrutinise(ctx, needs);
    const no = await newApp(ctx, 'inst2@demo.local', 'EXT');
    const co = await ctx.as('evc.nr@demo.local');
    const list = (await co.get('/api/evc')).body;
    expect(list.rows.map((r: any) => r.application_id)).toEqual([needs]);
    expect(list.rows[0]).toMatchObject({ status: 'queued', schedule_deadline: '2026-03-12' });
    expect(count(ctx.db, 'SELECT COUNT(*) c FROM evc_schedules WHERE application_id=?', no)).toBe(0);
  });

  it('only the EVC coordinator of the Region can schedule', async () => {
    const id = await newApp(ctx, 'inst1@demo.local', 'NEW'); await scrutinise(ctx, id);
    const evc = ctx.db.prepare('SELECT * FROM evc_schedules WHERE application_id=?').get(id) as any;
    const body = { confirmed_date: '2026-03-05', committee_id: committee(evc.region_id) };
    expect((await (await ctx.as('ro.nr@demo.local')).post(`/api/evc/${evc.id}/schedule`, body)).status).toBe(403);
    expect((await (await ctx.as('evc.sr@demo.local')).post(`/api/evc/${evc.id}/schedule`, body)).status).toBe(404);
    expect((await (await ctx.as('evc.nr@demo.local')).post(`/api/evc/${evc.id}/schedule`, body)).status).toBe(200);
    expect((await (await ctx.as('inst1@demo.local')).post(`/api/evc/${evc.id}/schedule`, body)).status).toBe(403);
  });

  it('prevents a committee from being booked twice on the same date and rejects bad dates', async () => {
    const a = await newApp(ctx, 'inst1@demo.local', 'NEW'); const b = await newApp(ctx, 'inst2@demo.local', 'NEW');
    await scrutinise(ctx, a); await scrutinise(ctx, b);
    const [ea, eb] = ctx.db.prepare('SELECT * FROM evc_schedules ORDER BY id').all() as any[];
    const co = await ctx.as('evc.nr@demo.local'); const c = committee(ea.region_id);
    expect((await co.post(`/api/evc/${ea.id}/schedule`, { confirmed_date: '2026-03-05', committee_id: c })).status).toBe(200);
    const clash = await co.post(`/api/evc/${eb.id}/schedule`, { confirmed_date: '2026-03-05', committee_id: c });
    expect(clash.status).toBe(409); expect(clash.body.error.message).toContain('already booked');
    expect((await co.post(`/api/evc/${eb.id}/schedule`, { confirmed_date: '2026-03-05', committee_id: committee(ea.region_id, 1) })).status).toBe(200);
    expect((await co.post(`/api/evc/${eb.id}/reschedule`, { confirmed_date: '2026-02-01', committee_id: c, reason: 'Rescheduling test' })).status).toBe(422);   // past
  });

  it('requires a reason to reschedule and preserves the scheduling history', async () => {
    const id = await newApp(ctx, 'inst1@demo.local', 'NEW'); await scrutinise(ctx, id);
    const e = ctx.db.prepare('SELECT * FROM evc_schedules WHERE application_id=?').get(id) as any; const c = committee(e.region_id);
    const co = await ctx.as('evc.nr@demo.local');
    await co.post(`/api/evc/${e.id}/schedule`, { confirmed_date: '2026-03-05', committee_id: c });
    expect((await co.post(`/api/evc/${e.id}/reschedule`, { confirmed_date: '2026-03-06', committee_id: c })).status).toBe(400);
    expect((await co.post(`/api/evc/${e.id}/reschedule`, { confirmed_date: '2026-03-06', committee_id: c, reason: 'Committee member unavailable' })).status).toBe(200);
    const detail = (await co.get(`/api/evc/${e.id}`)).body;
    expect(detail.status).toBe('rescheduled'); expect(detail.reschedule_count).toBe(1);
    expect(detail.history.map((h: any) => h.action)).toEqual(['queued', 'scheduled', 'rescheduled']);
    expect(detail.history[2]).toMatchObject({ from_date: '2026-03-05', to_date: '2026-03-06', reason: 'Committee member unavailable' });
  });

  it('cannot record completion before the visit is scheduled, and completion moves the workflow on', async () => {
    const id = await newApp(ctx, 'inst1@demo.local', 'NEW'); await scrutinise(ctx, id);
    const e = ctx.db.prepare('SELECT * FROM evc_schedules WHERE application_id=?').get(id) as any;
    const co = await ctx.as('evc.nr@demo.local');
    expect((await co.post(`/api/evc/${e.id}/complete`, { visit_date: '2026-03-02', notes: 'Visit notes here' })).status).toBe(409);
    await co.post(`/api/evc/${e.id}/schedule`, { confirmed_date: '2026-03-03', committee_id: committee(e.region_id) });
    setNow('2026-03-04T04:30:00Z');
    expect((await co.post(`/api/evc/${e.id}/complete`, { visit_date: '2026-03-03', notes: 'Visit notes here' })).body.advanced).toBe(true);
    expect(count(ctx.db, `SELECT COUNT(*) c FROM applications WHERE id=? AND current_stage='decision'`, id)).toBe(1);
  });

  it('flags delayed EVCs, notifies the coordinator and escalates under the configured rules', async () => {
    const { runJobs } = await import('../src/jobs');
    const id = await newApp(ctx, 'inst1@demo.local', 'NEW'); await scrutinise(ctx, id);   // schedule by 2026-03-12
    setNow('2026-03-11T04:30:00Z'); await runJobs(ctx.db, 'test');
    expect(count(ctx.db, `SELECT COUNT(*) c FROM notifications WHERE event='evc.deadline_approaching'`)).toBeGreaterThan(0);
    setNow('2026-03-14T04:30:00Z'); await runJobs(ctx.db, 'test');
    expect(count(ctx.db, `SELECT COUNT(*) c FROM notifications WHERE event='evc.overdue'`)).toBeGreaterThan(0);
    const esc = ctx.db.prepare(`SELECT x.level, u.role FROM escalation_events x JOIN users u ON u.id=x.recipient_user_id WHERE x.trigger_type='evc_overdue'`).all() as any[];
    expect(esc).toEqual([{ level: 1, role: 'regional_officer' }, { level: 1, role: 'regional_officer' }]);   // both regional officers of the Region, each once
    const co = await ctx.as('evc.nr@demo.local');
    expect((await co.get('/api/evc?status=overdue')).body.total).toBe(1);
    const e = ctx.db.prepare('SELECT * FROM evc_schedules WHERE application_id=?').get(id) as any;
    await co.post(`/api/evc/${e.id}/schedule`, { confirmed_date: '2026-03-16', committee_id: committee(e.region_id) });
    expect(count(ctx.db, `SELECT COUNT(*) c FROM escalation_events WHERE status='open' AND trigger_type='evc_overdue'`)).toBe(0);   // scheduling resolved it
  });

  it('suggests free slots with reasoning and respects existing bookings', async () => {
    const a = await newApp(ctx, 'inst1@demo.local', 'NEW'); await scrutinise(ctx, a);
    const e = ctx.db.prepare('SELECT * FROM evc_schedules WHERE application_id=?').get(a) as any;
    const co = await ctx.as('evc.nr@demo.local');
    const s = (await co.get(`/api/evc/${e.id}/suggestions`)).body.suggestions;
    expect(s.length).toBeGreaterThan(0); expect(s[0].reasoning.length).toBeGreaterThan(1);
    expect(s.every((x: any) => !['Sat', 'Sun'].includes(new Date(x.date + 'T00:00:00Z').toUTCString().slice(0, 3)))).toBe(true);
  });
});
