import { Router } from 'express';
import { z } from 'zod';
import type { DB } from '../db';
import { requireRole } from '../auth';
import { h, parse, paging, paged, qs, intParam } from '../http';
import { actorOf, audit } from '../audit';
import { clock } from '../clock';
import { notFound, ApiError } from '../util';
import { buildAnalytics, computeAlerts, ALERT_RULES } from '../analytics';
import { askReference } from '../reference';
import { regulatorySummary } from '../regulatory';
import { validateIntegrity } from '../integrity';
import { assistantModelStatus, assistantRateLimit, generateAssistantAnswer } from '../assistant-model';
import { matchingSampleDocuments, sampleKnowledge } from '../sample-documents';
import { websiteKnowledge } from '../assistant-context';

const STAFF = ['regional_officer', 'bureau_officer', 'evc_coordinator', 'competent_authority', 'admin'] as const;

export function analyticsRouter(db: DB) {
  const r = Router();
  r.use(requireRole(...STAFF));
  r.get('/', h((req, res) => {
    const f: Record<string, string> = {}; for (const k of ['region_id', 'category', 'from', 'to']) if (qs(req.query[k])) f[k] = String(req.query[k]);
    res.json(buildAnalytics(db, req.user!, f));
  }));
  return r;
}

export function intelligenceRouter(db: DB) {
  const r = Router();
  r.get('/rules', h((_req, res) => res.json(ALERT_RULES(db))));
  r.get('/alerts', h((req, res) => {
    const p = paging(req, 15); const f: Record<string, string> = {}; if (qs(req.query.region_id)) f.region_id = String(req.query.region_id);
    const all = computeAlerts(db, req.user!, f);
    const summary: Record<string, number> = {}; for (const a of all) summary[a.rule] = (summary[a.rule] ?? 0) + 1;
    const rule = qs(req.query.rule), sev = qs(req.query.severity), text = qs(req.query.q)?.toLowerCase();
    const rows = all.filter(a => (!rule || a.rule === rule) && (!sev || a.severity === sev) && (!text || a.title.toLowerCase().includes(text) || a.entity.toLowerCase().includes(text)));
    res.json({ ...paged(rows.slice(p.offset, p.offset + p.pageSize), rows.length, p), summary, generated_at: clock.iso(), note: 'Every alert lists the facts and the rule that produced it. Alerts are prompts for a human; none changes a case.' });
  }));
  return r;
}

export function regulatoryRouter(db: DB) {
  const r = Router();
  r.get('/summary', h((_req, res) => res.json(regulatorySummary(db))));
  r.get('/sources', h((_req, res) => res.json(db.prepare(`SELECT s.*, (SELECT COUNT(*) FROM regulatory_rules r WHERE r.source_id=s.id) AS rules FROM regulatory_sources s ORDER BY s.trust, s.id`).all())));
  r.get('/rules', h((req, res) => {
    const p = paging(req, 20), where = ['1=1'], params: any[] = [];
    if (qs(req.query.status)) { where.push('r.verification_status=?'); params.push(req.query.status); }
    if (qs(req.query.kind)) { where.push('r.kind=?'); params.push(req.query.kind); }
    if (qs(req.query.flagged) === '1') where.push('r.flagged_for_review=1');
    if (qs(req.query.category)) { where.push('r.category_code=?'); params.push(req.query.category); }
    if (qs(req.query.q)) { where.push('(r.title LIKE ? OR r.statement LIKE ? OR r.code LIKE ?)'); params.push(...Array(3).fill(`%${req.query.q}%`)); }
    const base = `FROM regulatory_rules r LEFT JOIN regulatory_sources s ON s.id=r.source_id LEFT JOIN users u ON u.id=r.reviewed_by LEFT JOIN handbook_versions h ON h.id=r.handbook_version_id WHERE ${where.join(' AND ')}`;
    const total = (db.prepare(`SELECT COUNT(*) c ${base}`).get(...params) as any).c;
    const rows = db.prepare(`SELECT r.*, s.title AS source_title, s.url AS source_url, s.trust AS source_trust, s.version_label, u.name AS reviewed_by_name, h.code AS handbook_code, h.status AS handbook_status ${base}
      ORDER BY CASE r.verification_status WHEN 'verified_official' THEN 0 WHEN 'verified_excerpt' THEN 1 WHEN 'needs_review' THEN 2 WHEN 'unverified' THEN 3 WHEN 'outdated' THEN 4 ELSE 5 END, r.code LIMIT ? OFFSET ?`).all(...params, p.pageSize, p.offset);
    res.json(paged(rows as any[], total, p));
  }));
  r.put('/rules/:id/review', requireRole('admin'), h((req, res) => {
    const id = intParam(req.params.id), cur = db.prepare('SELECT * FROM regulatory_rules WHERE id=?').get(id) as any;
    if (!cur) throw notFound('Rule not found');
    const b = parse(z.object({ status: z.enum(['verified_official', 'verified_excerpt', 'needs_review', 'unverified', 'outdated']), notes: z.string().trim().min(3, 'Say what you checked').max(1000) }), req.body);
    if (cur.kind === 'configurable_assumption') throw new ApiError(400, 'BAD_REQUEST', 'Assumptions are configured, not verified. Change the setting instead.');
    db.prepare(`UPDATE regulatory_rules SET verification_status=?, flagged_for_review=?, last_reviewed_on=?, reviewed_by=?, review_notes=? WHERE id=?`)
      .run(b.status, ['needs_review', 'unverified', 'outdated'].includes(b.status) ? 1 : 0, clock.today(), req.user!.id, b.notes, id);
    audit(db, { actor: actorOf(req.user!), type: 'regulatory.rule_reviewed', entity: 'regulatory_rule', entityId: cur.code, prev: { status: cur.verification_status }, next: { status: b.status }, reason: b.notes });
    res.json({ ok: true });
  }));
  return r;
}

export function referenceRouter(db: DB) {
  const r = Router();
  r.post('/ask', assistantRateLimit, h(async (req, res) => {
    const body = parse(z.object({
      question: z.string().trim().min(3).max(300),
      history: z.array(z.object({ question: z.string().max(300), answer: z.string().max(1200) })).max(6).optional(),
    }), req.body);
    const q = body.question;
    audit(db, { actor: actorOf(req.user!), type: 'reference.query', entity: 'reference', entityId: null, reason: q.slice(0, 200) });
    const result = askReference(db, q);
    const evidence = result.evidence.map(e => ({
      title: e.title,
      statement: e.statement,
      status: e.verification_status,
      source: e.source?.title,
      section: e.section_ref,
      page: e.page_ref,
    }));
    const sample_documents = matchingSampleDocuments(db, q);
    const sampleEvidence = sampleKnowledge(sample_documents);
    const model = assistantModelStatus();
    const answer = result.reason === 'decision_request' ? null : await generateAssistantAnswer(q, { siteContext: websiteKnowledge(db, req.user!), retrievedEvidence: [...evidence, ...sampleEvidence] }, body.history);
    res.json({ ...result, answer, model, sample_documents });
  }));
  return r;
}

export function integrityRouter(db: DB) {
  const r = Router();
  r.get('/', requireRole('admin', 'bureau_officer'), h((_req, res) => res.json(validateIntegrity(db))));
  return r;
}
