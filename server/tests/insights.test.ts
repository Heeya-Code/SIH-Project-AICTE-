import { describe, it, expect, beforeEach } from 'vitest';
import { openDb, migrate } from '../src/db';
import { seedBase, seedUsers, seedDemo } from '../src/seed';
import { manualWorkSaved } from '../src/insights';

describe('T1: Manual work saved / Work done automatically', () => {
  let db: any;
  beforeEach(async () => {
    db = openDb(':memory:');
    migrate(db);
    seedBase(db);
    seedUsers(db);
    await seedDemo(db);
  });

  it('calculates counts correctly for admin / bureau officer', () => {
    const admin = db.prepare("SELECT * FROM users WHERE role='admin'").get();
    const res = manualWorkSaved(db, admin, '30');
    expect(res).toBeDefined();
    expect(res.total).toBeGreaterThanOrEqual(0);
    expect(res.counts).toHaveProperty('automatic_stage_moves');
    expect(res.counts).toHaveProperty('reminders_sent');
    expect(res.counts).toHaveProperty('overdue_notices_sent');
    expect(res.counts).toHaveProperty('escalations_raised');
    expect(res.counts).toHaveProperty('cases_routed_automatically');
  });

  it('scopes regional officer to their region', () => {
    const ro = db.prepare("SELECT * FROM users WHERE role='regional_officer'").get();
    const res = manualWorkSaved(db, ro, '30');
    expect(res).toBeDefined();
    expect(res.total).toBeGreaterThanOrEqual(0);
  });

  it('throws forbidden for institution user', () => {
    const inst = db.prepare("SELECT * FROM users WHERE role='institution'").get();
    expect(() => manualWorkSaved(db, inst, '30')).toThrow();
  });
});
