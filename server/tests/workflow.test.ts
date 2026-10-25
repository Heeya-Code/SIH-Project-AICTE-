import { describe, it, expect, beforeEach } from 'vitest';
import { makeCtx, newApp, getApp, count, scrutinise, setNow, type Ctx } from './helpers';
import { validateDefinition } from '../src/workflow';

let ctx: Ctx;
beforeEach(() => { ctx = makeCtx(); });

describe('workflow engine', () => {
  it('routes a submitted application to the initial stage and opens a task', async () => {
    const id = await newApp(ctx);
    const a = getApp(ctx.db, id);
    expect(a.status).toBe('in_progress'); expect(a.current_stage).toBe('scrutiny'); expect(a.assigned_user_id).toBeTruthy();
    expect(count(ctx.db, `SELECT COUNT(*) c FROM tasks WHERE application_id=? AND status='open'`, id)).toBe(1);
    expect(a.stage_due_date).toBe('2026-03-16');           // 10 working days after Monday 2 March
  });

  it('performs a valid transition and records history, task and audit', async () => {
    const id = await newApp(ctx);
    const r = await scrutinise(ctx, id);
    expect(r.status).toBe(200); expect(r.body.stage).toBe('decision');
    const h = ctx.db.prepare('SELECT * FROM stage_history WHERE application_id=? ORDER BY id').all(id) as any[];
    expect(h.map(x => x.to_stage)).toEqual(['scrutiny', 'decision']);
    expect(h[1]).toMatchObject({ from_stage: 'scrutiny', action: 'complete_scrutiny', auto: 0 });
    expect(count(ctx.db, `SELECT COUNT(*) c FROM audit_log WHERE event_type='application.transition' AND entity_id=?`, String(id))).toBe(1);
  });

  it('rejects an invalid transition and a stage skip', async () => {
    const id = await newApp(ctx);
    const auth = await ctx.as('authority@demo.local');
    expect((await auth.post(`/api/applications/${id}/transitions`, { action: 'approve' })).status).toBe(409); // not available from scrutiny
    const ro = await ctx.as('ro.nr@demo.local');
    expect((await ro.post(`/api/applications/${id}/transitions`, { action: 'approve' })).status).toBe(409);
    expect(getApp(ctx.db, id).current_stage).toBe('scrutiny');
  });

  it('refuses unauthorised actors and other regions', async () => {
    const id = await newApp(ctx);
    const inst = await ctx.as('inst1@demo.local');
    expect((await inst.post(`/api/applications/${id}/transitions`, { action: 'complete_scrutiny' })).status).toBe(403);
    const otherRegion = await ctx.as('ro.sr@demo.local');
    expect((await otherRegion.post(`/api/applications/${id}/transitions`, { action: 'complete_scrutiny' })).status).toBe(404);
  });

  it('enforces transition prerequisites on the server', async () => {
    const id = await newApp(ctx);
    const ro = await ctx.as('ro.nr@demo.local');
    const r = await ro.post(`/api/applications/${id}/transitions`, { action: 'complete_scrutiny' });
    expect(r.status).toBe(422); expect(JSON.stringify(r.body)).toContain('observation');
    expect(getApp(ctx.db, id).current_stage).toBe('scrutiny');
  });

  it('advances automatically when the EVC visit is completed', async () => {
    const id = await newApp(ctx, 'inst1@demo.local', 'NEW');
    expect((await scrutinise(ctx, id)).body.stage).toBe('evc');
    const evc = ctx.db.prepare('SELECT * FROM evc_schedules WHERE application_id=?').get(id) as any;
    const co = await ctx.as('evc.nr@demo.local');
    const committee = (ctx.db.prepare('SELECT id FROM evc_committees WHERE region_id=? LIMIT 1').get(evc.region_id) as any).id;
    expect((await co.post(`/api/evc/${evc.id}/schedule`, { confirmed_date: '2026-03-04', committee_id: committee })).status).toBe(200);
    setNow('2026-03-05T04:30:00Z');
    const done = await co.post(`/api/evc/${evc.id}/complete`, { visit_date: '2026-03-04', notes: 'Visit done; all facilities checked.' });
    expect(done.status).toBe(200); expect(done.body.advanced).toBe(true);
    expect(getApp(ctx.db, id).current_stage).toBe('decision');
    expect(ctx.db.prepare(`SELECT auto FROM stage_history WHERE application_id=? AND to_stage='decision'`).get(id)).toMatchObject({ auto: 1 });
  });

  it('returns for clarification with a mandatory reason, then accepts a resubmission and keeps both submissions', async () => {
    const id = await newApp(ctx);
    const ro = await ctx.as('ro.nr@demo.local'), inst = await ctx.as('inst1@demo.local');
    expect((await ro.post(`/api/applications/${id}/transitions`, { action: 'return' })).status).toBe(422);
    expect((await ro.post(`/api/applications/${id}/transitions`, { action: 'return', reason: 'Lease deed unclear' })).status).toBe(200);
    expect(getApp(ctx.db, id)).toMatchObject({ status: 'returned', current_stage: 'clarification' });
    expect((await inst.post(`/api/applications/${id}/transitions`, { action: 'resubmit' })).status).toBe(422);
    expect((await inst.post(`/api/applications/${id}/transitions`, { action: 'resubmit', reason: 'Clear copy uploaded' })).status).toBe(200);
    expect(getApp(ctx.db, id)).toMatchObject({ status: 'in_progress', current_stage: 'scrutiny' });
    expect(ctx.db.prepare('SELECT version, kind FROM application_submissions WHERE application_id=? ORDER BY version').all(id)).toEqual([{ version: 1, kind: 'initial' }, { version: 2, kind: 'resubmission' }]);
    expect(count(ctx.db, 'SELECT COUNT(*) c FROM stage_history WHERE application_id=?', id)).toBe(3);
  });

  it('rejects a stale or duplicate concurrent transition (optimistic lock)', async () => {
    const id = await newApp(ctx);
    const ro = await ctx.as('ro.nr@demo.local');
    await ro.post(`/api/applications/${id}/observations`, { text: 'Checked.' });
    const v = getApp(ctx.db, id).row_version;
    const [a, b] = await Promise.all([
      ro.post(`/api/applications/${id}/transitions`, { action: 'complete_scrutiny', row_version: v }),
      ro.post(`/api/applications/${id}/transitions`, { action: 'complete_scrutiny', row_version: v }),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    expect(count(ctx.db, `SELECT COUNT(*) c FROM stage_history WHERE application_id=? AND to_stage='decision'`, id)).toBe(1);
  });

  it('keeps existing applications on their workflow version when a new version is activated', async () => {
    const oldId = await newApp(ctx);
    const admin = await ctx.as('admin@demo.local');
    const wf = (await admin.get('/api/workflows')).body.find((w: any) => w.code === 'scrutiny_only');
    const v1 = (await admin.get(`/api/workflows/versions/${wf.versions[0].id}`)).body.definition;
    v1.stages.find((s: any) => s.key === 'scrutiny').deadline_days = 3;
    const created = await admin.post(`/api/workflows/${wf.id}/versions`, { definition: v1, activate: true, note: 'Shorter scrutiny' });
    expect(created.status).toBe(201); expect(created.body.version).toBe(2);
    const newId = await newApp(ctx, 'inst2@demo.local');
    expect(getApp(ctx.db, oldId).workflow_version_id).toBe(wf.versions[0].id);
    expect(getApp(ctx.db, newId).workflow_version_id).toBe(created.body.id);
    expect(getApp(ctx.db, oldId).stage_due_date).toBe('2026-03-16');
    expect(getApp(ctx.db, newId).stage_due_date).toBe('2026-03-05');
    expect(count(ctx.db, `SELECT COUNT(*) c FROM audit_log WHERE event_type IN ('workflow.version_created','workflow.version_activated')`)).toBe(2);
  });

  it('records decisions with reasons, supports reopening only for the configured role, and creates obligations on approval', async () => {
    const id = await newApp(ctx);
    await scrutinise(ctx, id);
    const auth = await ctx.as('authority@demo.local');
    expect((await auth.post(`/api/applications/${id}/transitions`, { action: 'reject' })).status).toBe(422);
    expect((await auth.post(`/api/applications/${id}/transitions`, { action: 'reject', reason: 'Norms not met' })).status).toBe(200);
    expect((await auth.post(`/api/applications/${id}/transitions`, { action: 'reopen', reason: 'x' })).status).toBe(403);
    const bureau = await ctx.as('bureau@demo.local');
    expect((await bureau.post(`/api/applications/${id}/transitions`, { action: 'reopen', reason: 'New evidence received' })).status).toBe(200);
    expect(getApp(ctx.db, id).current_stage).toBe('scrutiny');
    await scrutinise(ctx, id);
    expect((await auth.post(`/api/applications/${id}/transitions`, { action: 'approve' })).status).toBe(200);
    expect(getApp(ctx.db, id).status).toBe('approved');
    expect(count(ctx.db, 'SELECT COUNT(*) c FROM undertakings WHERE application_id=?', id)).toBe(1);   // from the EXT template
  });

  it('blocks submission until required documents exist', async () => {
    const u = await ctx.as('inst1@demo.local');
    const { body } = await u.post('/api/applications', { category_code: 'EXT', title: 'Missing documents test' });
    const r = await u.post(`/api/applications/${body.id}/submit`);
    expect(r.status).toBe(422); expect(r.body.error.details.missing_documents).toContain('Lease Agreement');
  });
});

describe('workflow definition validation', () => {
  const stage = (key: string, extra: any = {}) => ({ key, name: key.toUpperCase(), responsible_role: 'regional_officer', deadline_days: 5, day_mode: 'calendar', is_initial: 0, is_terminal: 0, terminal_status: null, is_evc: 0, evc_schedule_days: null, ...extra });
  const t = (from: string, to: string, action: string, extra: any = {}) => ({ from_key: from, to_key: to, action, requires_reason: 0, auto: 0, allowed_role: null, prerequisites: [], ...extra });
  const base = () => ({
    stages: [stage('a', { is_initial: 1 }), stage('b'), stage('orphan'), stage('end', { responsible_role: 'competent_authority', deadline_days: null, is_terminal: 1, terminal_status: 'approved' })],
    transitions: [t('a', 'b', 'go'), t('b', 'end', 'finish'), t('orphan', 'end', 'finish')],
  }) as any;

  it('reports unreachable stages', () => {
    const v = validateDefinition(base()); expect(v.valid).toBe(false); expect(v.unreachable).toEqual(['orphan']);
  });
  it('detects automatic loops and a missing initial stage', () => {
    const d = base(); d.stages = d.stages.filter((s: any) => s.key !== 'orphan'); d.transitions.pop();
    expect(validateDefinition(d).valid).toBe(true);
    d.transitions.push(t('b', 'a', 'loop', { auto: 1, prerequisites: ['evc_completed'] }), t('a', 'b', 'loop2', { auto: 1, prerequisites: ['evc_completed'] }));
    expect(validateDefinition(d).errors.join(' ')).toContain('loop');
    d.stages[0].is_initial = 0; expect(validateDefinition(d).errors.join(' ')).toContain('initial');
  });
  it('rejects saving an invalid workflow through the API', async () => {
    const admin = await ctx.as('admin@demo.local');
    const wf = (await admin.get('/api/workflows')).body[0];
    expect((await admin.post(`/api/workflows/${wf.id}/versions`, { definition: base(), activate: true })).status).toBe(422);
  });
  it('simulates a workflow on synthetic data without touching real records', async () => {
    const admin = await ctx.as('admin@demo.local');
    const wf = (await admin.get('/api/workflows')).body.find((w: any) => w.code === 'scrutiny_evc');
    const def = (await admin.get(`/api/workflows/versions/${wf.versions[0].id}`)).body.definition;
    const before = count(ctx.db, 'SELECT COUNT(*) c FROM applications');
    const r = await admin.post('/api/workflows/simulate', { definition: def, start_date: '2026-03-02', steps: [{ action: 'complete_scrutiny', after_days: 9 }, { action: 'evc_completed', after_days: 20 }, { action: 'approve', after_days: 3 }] });
    expect(r.body.ok).toBe(true); expect(r.body.timeline.map((x: any) => x.stage)).toEqual(['scrutiny', 'evc', 'decision', 'approved']);
    expect(count(ctx.db, 'SELECT COUNT(*) c FROM applications')).toBe(before);
  });
});
