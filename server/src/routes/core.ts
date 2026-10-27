import { Router } from 'express';
import bcrypt from 'bcryptjs';
import rateLimit from 'express-rate-limit';
import PDFDocument from 'pdfkit';
import { z } from 'zod';
import type { DB } from '../db';
import { config } from '../config';
import { authenticate, signToken, requireRole, scope, roleLabel, type User } from '../auth';
import { h, parse, paging, intParam } from '../http';
import { ApiError, forbidden, notFound } from '../util';
import { actorOf, audit, SYSTEM } from '../audit';
import { clock } from '../clock';
import { REPORTS, reportsFor } from '../reports';
import { askAssistant, buildDashboard, calendarEvents, pendencyForecast } from '../insights';
import { PREREQUISITES, WORKFLOW_ROLES } from '../workflow';
import { buildAttention } from '../attention';
import { DOC_NAMES, docName } from '../docnames';
import { askReference } from '../reference';
import { assistantModelStatus, assistantRateLimit, generateAssistantAnswer } from '../assistant-model';
import { matchingSampleDocuments, sampleKnowledge } from '../sample-documents';
import { websiteKnowledge } from '../assistant-context';

const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 10);

export function authRouter(db: DB) {
  const r = Router();
  const limiter = rateLimit({ windowMs: 60_000, limit: config.loginRateLimit, standardHeaders: true, legacyHeaders: false,
    message: { error: { code: 'RATE_LIMITED', message: 'Too many sign-in attempts. Wait a minute and try again.' } } });
  r.post('/login', limiter, h((req, res) => {
    const b = parse(z.object({ email: z.string().email().max(200), password: z.string().min(1).max(200) }), req.body);
    const u = db.prepare('SELECT * FROM users WHERE email=?').get(b.email.toLowerCase()) as any;
    const ok = bcrypt.compareSync(b.password, u?.password_hash ?? DUMMY_HASH) && u && u.active;   // same cost whether or not the user exists
    if (!ok) { audit(db, { actor: SYSTEM, type: 'auth.login_failed', entity: 'user', entityId: u?.id ?? null, reason: `email=${b.email.slice(0, 80)}` }); throw new ApiError(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect'); }
    audit(db, { actor: actorOf(u), type: 'auth.login', entity: 'user', entityId: u.id });
    res.json({ token: signToken(u), user: profile(db, u) });
  }));
  r.get('/me', authenticate(db), h((req, res) => res.json({ user: profile(db, req.user!) })));
  return r;
}
const profile = (db: DB, u: User) => ({
  id: u.id, name: u.name, email: u.email, role: u.role, role_label: roleLabel[u.role], region_id: u.region_id, institution_id: u.institution_id,
  region_name: u.region_id ? (db.prepare('SELECT name FROM regions WHERE id=?').get(u.region_id) as any)?.name : null,
  institution_name: u.institution_id ? (db.prepare('SELECT name FROM institutions WHERE id=?').get(u.institution_id) as any)?.name : null,
});

export function lookupsRouter(db: DB) {
  const r = Router();
  r.get('/', h((req, res) => {
    const u = req.user!;
    const regional = u.role === 'regional_officer' || u.role === 'evc_coordinator';
    // The institutions table is the tenant itself: institution users see their own row, regional roles their Region's rows.
    const S = u.role === 'institution' ? { sql: 'i.id = ?', params: [u.institution_id ?? -1] } : scope(u, 'i');
    const stages = db.prepare(`SELECT s.key, MIN(s.name) AS name FROM workflow_stages s JOIN workflow_versions v ON v.id=s.version_id WHERE v.active=1 GROUP BY s.key`).all();
    res.json({
      regions: regional ? db.prepare('SELECT id,code,name FROM regions WHERE id=?').all(u.region_id) : db.prepare('SELECT id,code,name FROM regions ORDER BY id').all(),
      institutions: db.prepare(`SELECT i.id, i.name, i.region_id FROM institutions i WHERE ${S.sql} ORDER BY i.name`).all(...S.params),
      categories: db.prepare('SELECT code,name,apph_ref,route_basis FROM application_categories ORDER BY code').all(),
      document_requirements: db.prepare('SELECT category_code, doc_type, required, has_expiry, basis FROM document_requirements').all(),
      doc_types: (db.prepare('SELECT DISTINCT doc_type FROM document_requirements ORDER BY doc_type').all() as any[]).map(x => x.doc_type),
      doc_type_names: Object.fromEntries((db.prepare('SELECT DISTINCT doc_type FROM document_requirements').all() as any[]).map(x => [x.doc_type, docName(x.doc_type)])),
      stages,
      officers: u.role === 'institution' ? [] : db.prepare(`SELECT id,name,role,region_id FROM users WHERE active=1 AND role IN ('regional_officer','evc_coordinator','bureau_officer','competent_authority') ${regional ? 'AND region_id=?' : ''} ORDER BY name`).all(...(regional ? [u.region_id] : [])),
      roles: WORKFLOW_ROLES.map(x => ({ value: x, label: roleLabel[x] })),
      prerequisites: Object.entries(PREREQUISITES).map(([key, label]) => ({ key, label })),
      clock: { today: clock.today(), simulated: clock.isPinned() },
    });
  }));
  return r;
}

export function insightsRouter(db: DB) {
  const r = Router();
  r.get('/assistant/status', h((_req, res) => res.json({ model: assistantModelStatus() })));
  r.get('/dashboard', h((req, res) => res.json({ ...buildDashboard(db, req.user!), attention: buildAttention(db, req.user!) })));
  r.get('/calendar', h((req, res) => {
    const from = String(req.query.from ?? ''), to = String(req.query.to ?? '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) throw new ApiError(400, 'BAD_REQUEST', 'from and to must be YYYY-MM-DD dates');
    res.json(calendarEvents(db, req.user!, from, to, typeof req.query.types === 'string' && req.query.types ? req.query.types.split(',') : undefined));
  }));
  r.get('/forecast', requireRole('regional_officer', 'bureau_officer', 'competent_authority', 'admin'), h((req, res) => res.json(pendencyForecast(db, req.user!))));
  r.post('/assistant/ask', assistantRateLimit, h(async (req, res) => {
    const body = parse(z.object({
      question: z.string().trim().min(2).max(300),
      history: z.array(z.object({ question: z.string().max(300), answer: z.string().max(1200) })).max(6).optional(),
    }), req.body);
    const q = body.question;
    audit(db, { actor: actorOf(req.user!), type: 'assistant.query', entity: 'assistant', entityId: null, reason: q.slice(0, 200) });
    const result = askAssistant(db, req.user!, q);
    const reference = askReference(db, q);
    const evidence = reference.evidence.map(e => ({
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
    const answer = await generateAssistantAnswer(q, { liveFacts: result.facts, siteContext: websiteKnowledge(db, req.user!), retrievedEvidence: [...evidence, ...sampleEvidence] }, body.history);
    res.json({ ...result, answer, model, evidence, sample_documents, reference_notice: reference.disclaimer });
  }));
  return r;
}

// ---------------------------------------------------------------- reports (JSON / CSV / PDF)
const csvCell = (v: any) => { let s = String(v ?? ''); if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };

export function reportsRouter(db: DB) {
  const r = Router();
  r.get('/', h((req, res) => res.json(reportsFor(req.user!).map(({ key, title, description, filters }) => ({ key, title, description, filters })))));
  r.get('/:key', h((req, res) => {
    const user = req.user!, def = REPORTS.find(x => x.key === req.params.key);
    if (!def || (def.roles && !def.roles.includes(user.role))) throw notFound('Report not found');
    const f: Record<string, string | undefined> = {};
    for (const k of ['region_id', 'institution_id', 'stage', 'category', 'status', 'from', 'to', 'doc_type', 'window']) if (typeof req.query[k] === 'string' && req.query[k]) f[k] = req.query[k] as string;
    const result = def.run(db, user, f);
    const format = String(req.query.format ?? 'json');
    const stamp = clock.iso();
    if (format === 'csv' || format === 'pdf') {
      audit(db, { actor: actorOf(user), type: 'report.exported', entity: 'report', entityId: def.key, next: { format, filters: f, rows: result.rows.length } });
      if (format === 'csv') {
        const lines = [result.columns.map(c => csvCell(c.label)).join(','), ...result.rows.map(row => result.columns.map(c => csvCell(row[c.key])).join(','))];
        res.setHeader('Content-Type', 'text/csv; charset=utf-8'); res.setHeader('Content-Disposition', `attachment; filename="${def.key}.csv"`);
        return res.send('\ufeff' + lines.join('\r\n'));
      }
      const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 30 });
      res.setHeader('Content-Type', 'application/pdf'); res.setHeader('Content-Disposition', `attachment; filename="${def.key}.pdf"`);
      doc.pipe(res);
      doc.fontSize(14).text(def.title).fontSize(8).fillColor('#555').text(`Demonstration prototype. Synthetic data. Generated ${stamp} for ${user.name}. Filters: ${JSON.stringify(f)}`).moveDown(0.6).fillColor('#000');
      const cols = result.columns.slice(0, 10), width = (doc.page.width - 60) / cols.length;
      const row = (vals: string[], bold = false) => {
        const y = doc.y; doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(7);
        let maxH = 10; vals.forEach((v, i) => { const hgt = doc.heightOfString(v, { width: width - 4 }); if (hgt > maxH) maxH = hgt; });
        if (y + maxH > doc.page.height - 40) { doc.addPage(); return row(vals, bold); }
        vals.forEach((v, i) => doc.text(v, 30 + i * width, y, { width: width - 4 }));
        doc.y = y + maxH + 3;
      };
      row(cols.map(c => c.label), true);
      for (const x of result.rows.slice(0, 1500)) row(cols.map(c => String(x[c.key] ?? '')));
      if (!result.rows.length) doc.text('No rows match the filters.');
      doc.end(); return;
    }
    const p = paging(req, 25);
    res.json({ key: def.key, title: def.title, description: def.description, columns: result.columns, chart: result.chart, total: result.rows.length, page: p.page, pageSize: p.pageSize,
      pages: Math.max(1, Math.ceil(result.rows.length / p.pageSize)), rows: result.rows.slice(p.offset, p.offset + p.pageSize), chartRows: result.chart ? result.rows.slice(0, 60) : undefined, generated_at: stamp });
  }));
  return r;
}
void forbidden; void intParam; void DOC_NAMES;
