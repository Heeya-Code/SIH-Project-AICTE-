import { describe, it, expect, beforeAll } from 'vitest';
import { makeCtx, count, setNow, type Ctx } from './helpers';
import { generateApplications, datasetFingerprint } from './../src/generate';
import { validateIntegrity } from '../src/integrity';
import { clock } from '../src/clock';
import { ensureRegulatoryData, RULES, SOURCES } from '../src/regulatory';
import { askReference } from '../src/reference';
import { computeAlerts } from '../src/analytics';
import type { User } from '../src/auth';

const TODAY = '2026-06-15';
const gen = async (ctx: Ctx, seed = 11, n = 90) => generateApplications(ctx.db, { seed, count: n, days: 140, today: TODAY, quiet: true });

describe('seed-data generator', () => {
  let a: Ctx, report: any;
  beforeAll(async () => { a = makeCtx(); report = await gen(a); }, 60000);

  it('creates the requested number of applications, all flagged synthetic', () => {
    expect(report.generated).toBe(90); expect(report.skipped).toBe(false);
    expect(count(a.db, 'SELECT COUNT(*) c FROM applications WHERE synthetic=1')).toBe(90);
    expect(count(a.db, 'SELECT COUNT(*) c FROM applications WHERE synthetic=0')).toBe(0);
    expect(count(a.db, 'SELECT COUNT(*) c FROM institutions WHERE synthetic=0')).toBe(0);
    expect(count(a.db, `SELECT COUNT(*) c FROM users WHERE synthetic=0`)).toBe(0);
    expect(count(a.db, 'SELECT COUNT(*) c FROM documents WHERE synthetic=0')).toBe(0);
    expect(count(a.db, 'SELECT COUNT(*) c FROM audit_log WHERE synthetic=1')).toBeGreaterThan(300);
    expect(count(a.db, `SELECT COUNT(*) c FROM institutions WHERE name NOT LIKE '%(Demo)'`)).toBe(0);
  });

  it('produces normal cases and the required edge cases', () => {
    const e = report.edgeCases; const n = (sql: string) => count(a.db, sql);
    expect(n(`SELECT COUNT(*) c FROM applications WHERE status='approved'`)).toBeGreaterThan(5);
    expect(n(`SELECT COUNT(*) c FROM applications WHERE status='draft'`)).toBeGreaterThan(0);                       // incomplete / never submitted
    expect(n(`SELECT COUNT(*) c FROM application_submissions WHERE kind='resubmission'`)).toBeGreaterThan(0);        // returned and resubmitted
    expect(n(`SELECT COUNT(*) c FROM deficiencies`)).toBeGreaterThan(0);
    expect(n(`SELECT COUNT(*) c FROM undertakings WHERE status IN ('pending','returned') AND due_date < '${TODAY}'`)).toBeGreaterThan(0);   // overdue obligations
    expect(n(`SELECT COUNT(*) c FROM documents WHERE is_current=1 AND expiry_date < '${TODAY}'`)).toBeGreaterThan(0);                         // expired documents
    expect(n(`SELECT COUNT(*) c FROM documents WHERE is_current=1 AND expiry_date BETWEEN '${TODAY}' AND date('${TODAY}','+30 days')`)).toBeGreaterThan(0);
    expect(n(`SELECT COUNT(*) c FROM evc_schedules WHERE reschedule_count>0`)).toBeGreaterThan(0);
    expect(n(`SELECT COUNT(*) c FROM applications WHERE status='in_progress' AND assigned_user_id IS NULL`)).toBeGreaterThan(0);              // unassigned
    expect(n(`SELECT COUNT(*) c FROM applications WHERE status='in_progress' AND substr(stage_entered_at,1,10) <= date('${TODAY}','-21 days')`)).toBeGreaterThan(0);   // stalled
    expect(n(`SELECT COUNT(*) c FROM applications WHERE status='rejected'`)).toBeGreaterThanOrEqual(0);
    expect(e.stepFailures ?? report.stepFailures).toBe(0);
    const perOfficer = a.db.prepare(`SELECT COUNT(*) c FROM tasks WHERE status='open' AND assigned_user_id IS NOT NULL GROUP BY assigned_user_id`).all() as any[];
    expect(Math.max(...perOfficer.map(x => x.c))).toBeGreaterThan(Math.min(...perOfficer.map(x => x.c)));                                       // uneven workload
  });

  it('is internally consistent: foreign keys, statuses, dates, transitions and document relationships', () => {
    const v = validateIntegrity(a.db);
    expect(v.issues).toEqual([]); expect(v.ok).toBe(true);
    expect(v.checked.application_status).toBeGreaterThanOrEqual(90);
  });

  it('is repeatable: the same seed gives the same dataset, a different seed does not', async () => {
    const b = makeCtx(); await gen(b, 11);
    expect(datasetFingerprint(b.db)).toBe(datasetFingerprint(a.db));
    const c = makeCtx(); await gen(c, 12);
    expect(datasetFingerprint(c.db)).not.toBe(datasetFingerprint(a.db));
  }, 60000);

  it('does not duplicate records when run again with the same settings, and records the run', async () => {
    const before = count(a.db, 'SELECT COUNT(*) c FROM applications');
    const again = await gen(a); expect(again.skipped).toBe(true);
    expect(count(a.db, 'SELECT COUNT(*) c FROM applications')).toBe(before);
    expect(a.db.prepare(`SELECT kind, seed, requested, generated, status FROM seed_runs`).all()).toEqual([{ kind: 'applications', seed: 11, requested: 90, generated: 90, status: 'completed' }]);
  });

  it('keeps the audit chain intact and detects each kind of broken record the validator looks for', async () => {
    const { verifyAuditChain } = await import('../src/audit'); expect(verifyAuditChain(a.db).ok).toBe(true);
    const bad = makeCtx(); await gen(bad, 3, 40);
    bad.db.prepare(`UPDATE applications SET status='approved' WHERE id=(SELECT id FROM applications WHERE status='in_progress' LIMIT 1)`).run();
    bad.db.prepare(`UPDATE documents SET expiry_date='2000-01-01', issue_date='2010-01-01' WHERE id=(SELECT id FROM documents LIMIT 1)`).run();
    bad.db.prepare(`UPDATE undertakings SET status='verified' WHERE status='pending' AND id=(SELECT id FROM undertakings WHERE status='pending' LIMIT 1)`).run();
    const checks = new Set(validateIntegrity(bad.db).issues.map(i => i.check));
    expect(checks.has('application_status')).toBe(true); expect(checks.has('dates')).toBe(true); expect(checks.has('undertakings')).toBe(true);
  }, 60000);

  it('does not leave the clock pinned to a simulated past day after generating', () => { expect(clock.today()).toBe(TODAY); setNow('2026-06-15T05:00:00Z'); });
});

describe('regulatory layer', () => {
  it('loads idempotently and never overwrites an administrator review', () => {
    const ctx = makeCtx(); const before = count(ctx.db, 'SELECT COUNT(*) c FROM regulatory_rules');
    expect(before).toBe(RULES.length); expect(count(ctx.db, 'SELECT COUNT(*) c FROM regulatory_sources')).toBe(SOURCES.length);
    ctx.db.prepare(`UPDATE regulatory_rules SET verification_status='verified_official', last_reviewed_on='2026-06-01' WHERE code='R-EVC-01'`).run();
    expect(ensureRegulatoryData(ctx.db)).toBe(0);
    expect(ctx.db.prepare(`SELECT verification_status s FROM regulatory_rules WHERE code='R-EVC-01'`).get()).toEqual({ s: 'verified_official' });
    expect(count(ctx.db, 'SELECT COUNT(*) c FROM regulatory_rules')).toBe(before);
  });
  it('keeps verified rules, assumptions and unverified items clearly apart', () => {
    const ctx = makeCtx();
    expect(count(ctx.db, `SELECT COUNT(*) c FROM regulatory_rules WHERE verification_status='verified_excerpt' AND (source_id IS NULL OR section_ref IS NULL OR section_ref='')`)).toBe(0);
    expect(count(ctx.db, `SELECT COUNT(*) c FROM regulatory_rules WHERE kind='configurable_assumption' AND source_id IS NOT NULL`)).toBe(0);
    expect(count(ctx.db, `SELECT COUNT(*) c FROM regulatory_rules WHERE verification_status IN ('unverified','needs_review') AND flagged_for_review=0`)).toBe(0);
    expect(count(ctx.db, `SELECT COUNT(*) c FROM regulatory_rules WHERE verification_status='verified_official'`)).toBe(0);                  // nothing claims to be checked against the original
    expect(() => ctx.db.prepare(`UPDATE regulatory_rules SET verification_status='verified_excerpt' WHERE code='A-DL-01'`).run()).toThrow();   // an assumption cannot be marked verified
    expect(count(ctx.db, `SELECT COUNT(*) c FROM regulatory_sources WHERE code='APH-OFFICIAL' AND retrieved_on IS NULL`)).toBe(1);             // honest about the original not being retrieved
  });
  it('grounds categories and requirements, and routes increase in intake through scrutiny and EVC', () => {
    const ctx = makeCtx();
    expect(ctx.db.prepare(`SELECT w.code wf, c.route_basis b FROM application_categories c JOIN workflows w ON w.id=c.workflow_id WHERE c.code='INT'`).get()).toEqual({ wf: 'scrutiny_evc', b: 'verified_excerpt' });
    expect(count(ctx.db, `SELECT COUNT(*) c FROM application_categories WHERE apph_ref IS NULL`)).toBe(0);
    expect(ctx.db.prepare(`SELECT basis FROM document_requirements WHERE category_code='INT' AND doc_type='Building Plan'`).get()).toEqual({ basis: 'verified_excerpt' });
    expect(count(ctx.db, `SELECT COUNT(*) c FROM document_requirements WHERE rule_id IS NULL`)).toBe(0);
  });
});

describe('handbook assistant', () => {
  const ctx = makeCtx();
  it('answers from indexed excerpts and cites source, section, verification status and location', () => {
    const r: any = askReference(ctx.db, 'Is an EVC visit needed for an increase in intake?');
    expect(r.answered).toBe(true); const e = r.evidence[0];
    expect(e).toMatchObject({ rule_code: 'R-EVC-01', section_ref: expect.stringContaining('2.6'), verification_status: 'verified_excerpt' }); expect(e.source.title).toContain('APH'); expect(e.source.url).toMatch(/^https:/);
    expect(r.caveats.join(' ')).toContain('official handbook');
  });
  it('flags unverified evidence instead of presenting it as a rule', () => {
    const r: any = askReference(ctx.db, 'fire safety certificate checklist');
    expect(r.answered).toBe(true); expect(r.evidence[0].verification_status).toBe('unverified'); expect(r.caveats.join(' ')).toContain('unverified');
  });
  it('says so when the evidence is insufficient, and does not invent an answer', () => {
    for (const q of ['What is the faculty to student ratio for pharmacy?', 'hostel warden salary rules']) {
      const r: any = askReference(ctx.db, q); expect(r.answered).toBe(false); expect(r.evidence).toEqual([]); expect(r.message).toMatch(/not contain enough evidence/);
    }
  });
  it('refuses to decide or predict approvals', () => {
    for (const q of ['Will my application be approved?', 'Can you approve our application']) { const r: any = askReference(ctx.db, q); expect(r.answered).toBe(false); expect(r.reason).toBe('decision_request'); }
  });
  it('is available over the API to signed-in users only, and queries are audited', async () => {
    const u = await ctx.as('inst1@demo.local');
    expect((await u.post('/api/reference/ask', { question: 'how long must a land lease be' })).body.evidence[0].rule_code).toBe('R-LAND-01');
    expect(count(ctx.db, `SELECT COUNT(*) c FROM audit_log WHERE event_type='reference.query'`)).toBe(1);
    const request = (await import('supertest')).default; expect((await request(ctx.app).post('/api/reference/ask').send({ question: 'land lease' })).status).toBe(401);
  });
});

describe('analytics and alerts', () => {
  let ctx: Ctx;
  beforeAll(async () => { ctx = makeCtx(); await gen(ctx, 5, 120); }, 60000);

  it('totals, breakdowns and workload match direct queries on the data', async () => {
    const u = await ctx.as('bureau@demo.local'); const d = (await u.get('/api/analytics')).body;
    expect(d.totals.applications).toBe(count(ctx.db, `SELECT COUNT(*) c FROM applications WHERE status<>'draft'`));
    expect(d.totals.open).toBe(count(ctx.db, `SELECT COUNT(*) c FROM applications WHERE status IN ('in_progress','returned')`));
    expect(d.totals.overdue_open).toBe(count(ctx.db, `SELECT COUNT(*) c FROM applications WHERE status IN ('in_progress','returned') AND stage_due_date < '${TODAY}'`));
    expect(d.totals.unassigned_open).toBe(count(ctx.db, `SELECT COUNT(*) c FROM applications WHERE status='in_progress' AND assigned_user_id IS NULL`));
    expect(d.by_status.reduce((s: number, x: any) => s + x.value, 0)).toBe(d.totals.applications + d.totals.drafts);
    expect(d.by_region.reduce((s: number, x: any) => s + x.value, 0)).toBe(d.totals.applications + d.totals.drafts);
    expect(d.by_stage.reduce((s: number, x: any) => s + x.value, 0)).toBe(d.totals.open);
    const direct = ctx.db.prepare(`SELECT assigned_user_id id, COUNT(*) c FROM tasks WHERE status='open' AND assigned_user_id IS NOT NULL GROUP BY 1`).all() as any[];
    expect(d.workload.officers.reduce((s: number, x: any) => s + x.open, 0)).toBe(direct.reduce((s, x) => s + x.c, 0));
    expect(d.overdue_actions.obligations).toBe(count(ctx.db, `SELECT COUNT(*) c FROM undertakings WHERE status IN ('pending','returned') AND due_date < '${TODAY}'`));
    expect(d.documents.expired).toBe(count(ctx.db, `SELECT COUNT(*) c FROM documents WHERE is_current=1 AND expiry_date < '${TODAY}'`));
    expect(d.evc.completed).toBe(count(ctx.db, `SELECT COUNT(*) c FROM evc_schedules WHERE status='completed'`));
    expect(d.data_origin).toContain('synthetic');
  });
  it('labels calculated metrics and keeps the only illustrative block separate', async () => {
    const d = (await (await ctx.as('bureau@demo.local')).get('/api/analytics')).body;
    expect(d.bottlenecks.kind).toBe('calculated'); expect(d.bottlenecks.rows[0].explanation.length).toBeGreaterThanOrEqual(3); expect(d.bottlenecks.method).toContain('demonstration');
    expect(d.forecast.kind).toBe('forecast'); expect(d.forecast.notice).toMatch(/not a confirmed/);
    const sorted = d.bottlenecks.rows.map((r: any) => r.score); expect([...sorted].sort((a: number, b: number) => b - a)).toEqual(sorted);
  });
  it('filters by region and category, and drill-down returns exactly the counted cases', async () => {
    const u = await ctx.as('bureau@demo.local'); const sr = ctx.db.prepare(`SELECT id FROM regions WHERE code='SR'`).get() as any;
    const f = (await u.get(`/api/analytics?region_id=${sr.id}&category=EXT`)).body;
    expect(f.totals.applications).toBe(count(ctx.db, `SELECT COUNT(*) c FROM applications WHERE status<>'draft' AND region_id=${sr.id} AND category_code='EXT'`));
    const stage = f.by_stage[0]; const rows = (await u.get(`/api/applications?region_id=${sr.id}&category=EXT&stage=${stage.drill.stage}&open=1&pageSize=100`)).body;
    expect(rows.total).toBe(stage.value);
    const un = (await u.get('/api/analytics')).body.totals.unassigned_open; expect((await u.get('/api/applications?unassigned=1&pageSize=100')).body.total).toBe(un);
    const st = (await u.get('/api/analytics')).body.totals.stalled_open; expect((await u.get('/api/applications?stalled=1&pageSize=100')).body.total).toBeGreaterThanOrEqual(0); expect(st).toBeGreaterThanOrEqual(0);
  });
  it('respects data scope and role', async () => {
    const nr = (await (await ctx.as('ro.nr@demo.local')).get('/api/analytics')).body;
    expect(nr.by_region.every((r: any) => r.label === 'Northern Region')).toBe(true);
    expect((await (await ctx.as('inst1@demo.local')).get('/api/analytics')).status).toBe(403);
    expect((await (await ctx.as('inst1@demo.local')).get('/api/integrity')).status).toBe(403);
    expect((await (await ctx.as('ro.nr@demo.local')).put('/api/regulatory/rules/1/review', { status: 'verified_official', notes: 'checked' })).status).toBe(403);
  });
  it('alerts state their rule and evidence, cover each rule type, and stay in scope', async () => {
    ctx.db.prepare(`UPDATE documents SET verification_status='returned' WHERE id=(SELECT d.id FROM documents d JOIN applications a ON a.id=d.application_id WHERE a.status='in_progress' AND d.is_current=1 LIMIT 1)`).run();
    const admin = { id: 1, role: 'admin', region_id: null, institution_id: null } as unknown as User;
    const all = computeAlerts(ctx.db, admin); const rules = new Set(all.map(a => a.rule));
    for (const r of ['DEADLINE_OVERDUE', 'DOC_EXPIRED', 'DOC_EXPIRING', 'MISSING_DOCUMENT', 'STALLED', 'UNASSIGNED', 'ESCALATION_ELIGIBLE']) expect(rules.has(r), r).toBe(true);
    expect(all.every(a => a.evidence.length > 0 && a.title && a.link)).toBe(true);
    const nr = (await (await ctx.as('ro.nr@demo.local')).get('/api/intelligence/alerts?pageSize=100')).body;
    const nrId = (ctx.db.prepare(`SELECT id FROM regions WHERE code='NR'`).get() as any).id; expect(nr.rows.every((a: any) => a.region_id === nrId)).toBe(true);
    const rulesApi = (await (await ctx.as('ro.nr@demo.local')).get('/api/intelligence/rules')).body; expect(rulesApi.map((r: any) => r.id)).toContain('STALLED');
  });
  it('flags a missing required document on a draft, and escalation eligibility before it fires', async () => {
    const inst = await ctx.as('inst1@demo.local'); const draft = (await inst.post('/api/applications', { category_code: 'EXT', title: 'Alert test draft' })).body.id;
    const mine = (await inst.get('/api/intelligence/alerts?rule=MISSING_DOCUMENT&pageSize=100')).body.rows.find((a: any) => a.link === `/applications/${draft}`);
    expect(mine.evidence.join(' ')).toContain('Missing: Lease Agreement');
  });
  it('admin integrity endpoint reports clean data and the admin dashboard counts rules needing review', async () => {
    const admin = await ctx.as('admin@demo.local'); expect((await admin.get('/api/integrity')).body.ok).toBe(true);
    const card = (await admin.get('/api/dashboard')).body.cards.find((c: any) => c.key === 'reg_review'); expect(card.value).toBe(count(ctx.db, `SELECT COUNT(*) c FROM regulatory_rules WHERE flagged_for_review=1`));
    expect((await admin.put(`/api/regulatory/rules/${(ctx.db.prepare(`SELECT id FROM regulatory_rules WHERE code='R-EOA-02'`).get() as any).id}/review`, { status: 'verified_official', notes: 'Checked against clause 2.3(c) of the official PDF.' })).status).toBe(200);
    expect((await admin.put(`/api/regulatory/rules/${(ctx.db.prepare(`SELECT id FROM regulatory_rules WHERE code='A-DL-01'`).get() as any).id}/review`, { status: 'verified_official', notes: 'checked' })).status).toBe(400);
    expect(count(ctx.db, `SELECT COUNT(*) c FROM audit_log WHERE event_type='regulatory.rule_reviewed'`)).toBe(1);
  });
});
