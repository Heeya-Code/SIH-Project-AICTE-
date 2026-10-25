import { describe, it, expect, beforeEach } from 'vitest';
import { makeCtx, newApp, getApp, count, scrutinise, setNow, upload, type Ctx } from './helpers';
import { runJobs } from '../src/jobs';
import { clock } from '../src/clock';
import { ageInfo } from '../src/workflow';
import { processOutbox, setEmailAdapter, simulatedEmail } from '../src/notify';

let ctx: Ctx;
beforeEach(() => { ctx = makeCtx(); });
const notifs = (event: string) => count(ctx.db, 'SELECT COUNT(*) c FROM notifications WHERE event=?', event);

describe('deadline monitoring and reminders', () => {
  it('sends a reminder when a deadline approaches, and never duplicates it on repeated runs', async () => {
    const id = await newApp(ctx);                    // scrutiny due 2026-03-16
    setNow('2026-03-09T04:30:00Z');                  // 7 days before
    await runJobs(ctx.db, 'test'); expect(notifs('task.deadline_approaching')).toBe(1);
    await runJobs(ctx.db, 'test'); await runJobs(ctx.db, 'test'); expect(notifs('task.deadline_approaching')).toBe(1);
    setNow('2026-03-15T04:30:00Z');                  // 1 day before: a second, distinct reminder
    await runJobs(ctx.db, 'test'); expect(notifs('task.deadline_approaching')).toBe(2);
    expect(getApp(ctx.db, id).current_stage).toBe('scrutiny');
  });

  it('still sends exactly one reminder if the scheduler was down on the exact day (recovery after a restart)', async () => {
    await newApp(ctx);
    setNow('2026-03-13T04:30:00Z');                  // 3 days left; the 7-day mark was missed entirely
    await runJobs(ctx.db, 'test'); await runJobs(ctx.db, 'test');
    expect(notifs('task.deadline_approaching')).toBe(1);
  });

  it('computes deadline status at the IST date boundary', async () => {
    const id = await newApp(ctx);                    // due 2026-03-16
    const app = getApp(ctx.db, id);
    setNow('2026-03-16T18:29:00Z');                  // 23:59 IST on the due date
    expect(ageInfo(ctx.db, app, clock.today())).toMatchObject({ due_status: 'due_soon', days_to_due: 0 });
    setNow('2026-03-16T18:31:00Z');                  // 00:01 IST the next day
    expect(ageInfo(ctx.db, app, clock.today())).toMatchObject({ due_status: 'overdue', days_to_due: -1 });
  });

  it('marks tasks overdue and escalates to the configured recipient only after the configured delay, once', async () => {
    const id = await newApp(ctx);                    // due 2026-03-16; rule L1 fires 1 day after due, to the Bureau
    setNow('2026-03-16T10:00:00Z'); await runJobs(ctx.db, 'test');
    expect(count(ctx.db, 'SELECT COUNT(*) c FROM escalation_events')).toBe(0);
    setNow('2026-03-17T10:00:00Z'); await runJobs(ctx.db, 'test'); await runJobs(ctx.db, 'test');
    const ev = ctx.db.prepare('SELECT x.*, u.role FROM escalation_events x JOIN users u ON u.id=x.recipient_user_id').all() as any[];
    expect(ev).toHaveLength(1); expect(ev[0]).toMatchObject({ level: 1, role: 'bureau_officer', status: 'open', application_id: id });
    expect(notifs('task.overdue')).toBe(1); expect(notifs('escalation.triggered')).toBe(1);
    setNow('2026-03-23T10:00:00Z'); await runJobs(ctx.db, 'test');        // 7 days overdue: level 2 goes to the competent authority
    expect((ctx.db.prepare('SELECT level FROM escalation_events ORDER BY level').all() as any[]).map(x => x.level)).toEqual([1, 2]);
    expect(count(ctx.db, `SELECT COUNT(*) c FROM audit_log WHERE event_type='escalation.triggered'`)).toBe(2);
  });

  it('does not escalate a task that was completed before it became overdue', async () => {
    const id = await newApp(ctx);
    await scrutinise(ctx, id);                       // completes the scrutiny task on time
    setNow('2026-03-25T10:00:00Z'); await runJobs(ctx.db, 'test');
    expect(count(ctx.db, `SELECT COUNT(*) c FROM escalation_events WHERE entity_type='task' AND entity_id IN (SELECT id FROM tasks WHERE stage_key='scrutiny')`)).toBe(0);
  });

  it('cancels open escalations when the task is completed afterwards, and keeps them in the audit trail', async () => {
    const id = await newApp(ctx);
    setNow('2026-03-18T10:00:00Z'); await runJobs(ctx.db, 'test');
    expect(count(ctx.db, `SELECT COUNT(*) c FROM escalation_events WHERE status='open'`)).toBeGreaterThan(0);
    await scrutinise(ctx, id);
    expect(count(ctx.db, `SELECT COUNT(*) c FROM escalation_events WHERE status='open' AND application_id=?`, id)).toBe(0);
    expect(count(ctx.db, `SELECT COUNT(*) c FROM escalation_events WHERE status='cancelled'`)).toBeGreaterThan(0);
    expect(count(ctx.db, `SELECT COUNT(*) c FROM audit_log WHERE event_type='escalation.cancelled'`)).toBeGreaterThan(0);
    await runJobs(ctx.db, 'test');
    expect(count(ctx.db, `SELECT COUNT(*) c FROM escalation_events WHERE status='open' AND entity_type='task' AND application_id=? AND entity_id IN (SELECT id FROM tasks WHERE stage_key='scrutiny')`, id)).toBe(0);
  });

  it('records job runs and survives a failing sub-job without losing the rest', async () => {
    await newApp(ctx);
    ctx.db.exec(`CREATE TRIGGER boom BEFORE INSERT ON notifications WHEN NEW.event='task.deadline_approaching' BEGIN SELECT RAISE(ABORT,'simulated failure'); END;`);
    setNow('2026-03-09T04:30:00Z');
    const r: any = await runJobs(ctx.db, 'test');
    expect(r.status).toBe('partial'); expect(r.errors.join()).toContain('tasks');
    expect(count(ctx.db, `SELECT COUNT(*) c FROM job_runs WHERE status='partial'`)).toBe(1);
    expect(count(ctx.db, `SELECT COUNT(*) c FROM audit_log WHERE event_type='job.failed'`)).toBe(1);
    ctx.db.exec('DROP TRIGGER boom');
    await runJobs(ctx.db, 'test');                    // safe retry
    expect(notifs('task.deadline_approaching')).toBe(1);
  });

  it('uses working days when the stage is configured that way (weekends skipped)', async () => {
    const id = await newApp(ctx);
    expect(getApp(ctx.db, id).stage_due_date).toBe('2026-03-16');       // Mon + 10 working days
    ctx.db.prepare(`INSERT INTO holidays (date,name) VALUES ('2026-03-04','Synthetic holiday')`).run();
    const id2 = await newApp(ctx, 'inst2@demo.local');
    expect(getApp(ctx.db, id2).stage_due_date).toBe('2026-03-17');      // one holiday pushes it a day
  });
});

describe('notification delivery and retry', () => {
  it('retries a failed email with backoff and then delivers', async () => {
    const u = await ctx.as('admin@demo.local');
    let fail = true; setEmailAdapter({ name: 't', send: async () => { if (fail) throw new Error('smtp down'); } });
    try {
      await newApp(ctx);
      const r1 = await processOutbox(ctx.db); expect(r1.failed).toBeGreaterThan(0);
      expect(count(ctx.db, `SELECT COUNT(*) c FROM notification_deliveries WHERE channel='email' AND status='failed' AND attempts=1`)).toBeGreaterThan(0);
      const r2 = await processOutbox(ctx.db); expect(r2.attempted).toBe(0);            // backoff not elapsed yet
      fail = false; setNow('2026-03-02T05:00:00Z');                                      // 30 minutes later
      const r3 = await processOutbox(ctx.db); expect(r3.sent).toBeGreaterThan(0);
      expect(count(ctx.db, `SELECT COUNT(*) c FROM notification_deliveries WHERE channel='email' AND status IN ('failed','pending')`)).toBe(0);
    } finally { setEmailAdapter(simulatedEmail); }
    void u;
  });
  it('abandons delivery after the configured number of attempts', async () => {
    setEmailAdapter({ name: 't', send: async () => { throw new Error('always down'); } });
    try {
      await newApp(ctx);
      for (let i = 0; i < 4; i++) { await processOutbox(ctx.db); clock.set(new Date(clock.now().getTime() + 3 * 3600000)); }
      expect(count(ctx.db, `SELECT COUNT(*) c FROM notification_deliveries WHERE status='abandoned'`)).toBeGreaterThan(0);
      expect(count(ctx.db, `SELECT COUNT(*) c FROM notification_deliveries WHERE channel='email' AND status IN ('failed','pending')`)).toBe(0);
    } finally { setEmailAdapter(simulatedEmail); }
  });
  it('de-duplicates notifications by key and addresses only users in scope', async () => {
    await newApp(ctx);                                                      // institution 1 (Northern Region)
    const forUser = (email: string, event: string) => count(ctx.db, `SELECT COUNT(*) c FROM notifications n JOIN users u ON u.id=n.user_id WHERE u.email=? AND n.event=?`, email, event);
    expect(forUser('inst1@demo.local', 'application.submitted')).toBe(1);
    expect(forUser('inst2@demo.local', 'application.submitted')).toBe(0);   // different institution
    expect(count(ctx.db, `SELECT COUNT(*) c FROM notifications n JOIN users u ON u.id=n.user_id WHERE n.event='application.assigned' AND u.region_id<>(SELECT region_id FROM institutions WHERE id=1)`)).toBe(0);
    const total = count(ctx.db, 'SELECT COUNT(*) c FROM notifications');
    await runJobs(ctx.db, 'test'); await runJobs(ctx.db, 'test');
    expect(count(ctx.db, 'SELECT COUNT(*) c FROM notifications')).toBe(total);   // nothing new is due, nothing duplicated
  });
  it('persists notifications and supports read and acknowledgment', async () => {
    const id = await newApp(ctx);
    const ro = await ctx.as('ro.nr@demo.local'), inst = await ctx.as('inst1@demo.local');
    await ro.post(`/api/applications/${id}/transitions`, { action: 'return', reason: 'Please clarify' });
    const list = (await inst.get('/api/notifications?pending_ack=1')).body;
    expect(list.total).toBe(1); expect(list.rows[0].event).toBe('application.returned');
    expect((await inst.post(`/api/notifications/${list.rows[0].id}/ack`)).status).toBe(200);
    expect((await inst.get('/api/notifications/unread-count')).body.pending_ack).toBe(0);
    expect((await ro.post(`/api/notifications/${list.rows[0].id}/read`)).status).toBe(200);         // not the recipient: no effect
    expect(count(ctx.db, `SELECT COUNT(*) c FROM notifications WHERE id=? AND read_at IS NOT NULL AND user_id<>(SELECT id FROM users WHERE email='inst1@demo.local')`, list.rows[0].id)).toBe(0);
  });
});
void upload;
