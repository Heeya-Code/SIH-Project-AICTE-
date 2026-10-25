import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import type { DB } from '../db';
import { requireRole } from '../auth';
import { h, parse, paging, paged, qs, intParam } from '../http';
import { actorOf, audit } from '../audit';
import { clock } from '../clock';
import { ApiError, badRequest, notFound } from '../util';
import { assessProvenance, importFile, resolveConflict } from '../importer';
import { activationCheck, activateRule } from '../publicdata';

const STAFF = ['regional_officer', 'bureau_officer', 'evc_coordinator', 'competent_authority', 'admin'] as const;
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024, files: 1 } });
const csvCell = (v: any) => { let s = String(v ?? ''); if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };

export function publicDataRouter(db: DB) {
  const r = Router();
  r.use(requireRole(...STAFF));

  r.get('/summary', h((_req, res) => {
    const c = (s: string) => (db.prepare(s).get() as any).c as number;
    res.json({
      institutions: c('SELECT COUNT(*) c FROM public_institutions'), batches: c(`SELECT COUNT(*) c FROM import_batches WHERE status IN ('completed','completed_with_warnings')`), open_conflicts: c(`SELECT COUNT(*) c FROM import_conflicts WHERE status='open'`),
      sources: db.prepare('SELECT access_status, COUNT(*) AS n FROM data_sources GROUP BY access_status').all(), states: c('SELECT COUNT(DISTINCT state) c FROM public_institutions'),
      note: c('SELECT COUNT(*) c FROM public_institutions') === 0 ? 'No public data has been imported yet. Sources are registered, but no file has been downloaded or validated.' : 'Public records come from files that were imported here. See each batch for its source, year and data-quality report.',
    });
  }));

  r.get('/sources', h((_req, res) => res.json((db.prepare('SELECT * FROM data_sources ORDER BY id').all() as any[]).map(s => ({ ...s, provenance_gaps: assessProvenance(s, '2000-01', clock.today()).filter(x => !x.startsWith('academic') && !x.startsWith('retrieval')),
    imported_batches: (db.prepare(`SELECT COUNT(*) c FROM import_batches WHERE source_id=? AND status IN ('completed','completed_with_warnings')`).get(s.id) as any).c })))));
  r.put('/sources/:id', requireRole('admin'), h((req, res) => {
    const id = intParam(req.params.id), cur = db.prepare('SELECT * FROM data_sources WHERE id=?').get(id) as any; if (!cur) throw notFound('Source not found');
    const b = parse(z.object({ licence: z.string().trim().max(300).optional(), licence_note: z.string().trim().max(1000).optional(), dataset_date: z.string().trim().max(40).nullable().optional(), field_definitions_ref: z.string().trim().max(1000).optional(), publisher: z.string().trim().max(300).optional() }), req.body);
    db.prepare('UPDATE data_sources SET licence=COALESCE(?,licence), licence_note=COALESCE(?,licence_note), dataset_date=COALESCE(?,dataset_date), field_definitions_ref=COALESCE(?,field_definitions_ref), publisher=COALESCE(?,publisher) WHERE id=?')
      .run(b.licence ?? null, b.licence_note ?? null, b.dataset_date ?? null, b.field_definitions_ref ?? null, b.publisher ?? null, id);
    audit(db, { actor: actorOf(req.user!), type: 'config.data_source_updated', entity: 'data_source', entityId: cur.code, prev: { licence: cur.licence }, next: b });
    res.json({ ok: true });
  }));

  r.post('/import', requireRole('admin'), upload.single('file'), h(async (req, res) => {
    if (!req.file) throw badRequest('Attach a .csv, .xlsx or .json file');
    const b = parse(z.object({ source_code: z.string().min(1), academic_year: z.string().min(1), retrieved_on: z.string().min(1), dry_run: z.string().optional(), force: z.string().optional(), sheet: z.string().optional(), mapping: z.string().optional() }), req.body);
    let mapping: Record<string, string> | undefined; if (b.mapping) { try { mapping = JSON.parse(b.mapping); } catch { throw badRequest('The column mapping must be valid JSON, for example {"Institute Name":"name"}'); } }
    const out = await importFile(db, req.user!, { sourceCode: b.source_code, buffer: req.file.buffer, fileName: req.file.originalname, academicYear: b.academic_year, retrievedOn: b.retrieved_on, mapping, sheet: b.sheet, dryRun: b.dry_run === '1', force: b.force === '1' });
    res.status(out.dry_run ? 200 : 201).json(out);
  }));

  r.get('/batches', h((req, res) => {
    const p = paging(req, 10);
    const total = (db.prepare('SELECT COUNT(*) c FROM import_batches').get() as any).c;
    res.json(paged(db.prepare(`SELECT b.id,b.file_name,b.format,b.academic_year,b.retrieved_on,b.status,b.rows_read,b.rows_new,b.rows_unchanged,b.rows_filled,b.rows_rejected,b.rows_duplicate,b.conflicts_opened,b.possible_duplicates,b.started_at,b.finished_at, s.code AS source_code, s.name AS source_name, u.name AS imported_by_name
      FROM import_batches b JOIN data_sources s ON s.id=b.source_id LEFT JOIN users u ON u.id=b.imported_by ORDER BY b.id DESC LIMIT ? OFFSET ?`).all(p.pageSize, p.offset) as any[], total, p));
  }));
  r.get('/batches/:id', h((req, res) => {
    const id = intParam(req.params.id), b = db.prepare(`SELECT b.*, s.code AS source_code, s.name AS source_name, s.url AS source_url, s.licence FROM import_batches b JOIN data_sources s ON s.id=b.source_id WHERE b.id=?`).get(id) as any;
    if (!b) throw notFound('Batch not found');
    res.json({ ...b, report: JSON.parse(b.report ?? '{}'), mapping: JSON.parse(b.mapping ?? 'null'), rejects: db.prepare('SELECT row_number, reason FROM import_rejects WHERE batch_id=? ORDER BY row_number LIMIT 200').all(id), duplicates: db.prepare('SELECT kind, key, row_numbers, detail FROM import_duplicates WHERE batch_id=? LIMIT 200').all(id) });
  }));
  r.get('/batches/:id/rejects.csv', h((req, res) => {
    const id = intParam(req.params.id); if (!db.prepare('SELECT 1 FROM import_batches WHERE id=?').get(id)) throw notFound('Batch not found');
    const rows = db.prepare('SELECT row_number, reason, raw FROM import_rejects WHERE batch_id=? ORDER BY row_number').all(id) as any[];
    res.setHeader('Content-Type', 'text/csv; charset=utf-8'); res.setHeader('Content-Disposition', `attachment; filename="batch-${id}-rejected-rows.csv"`);
    res.send('\ufeff' + ['row_number,reason,raw_row', ...rows.map(x => [x.row_number, x.reason, x.raw].map(csvCell).join(','))].join('\r\n'));
  }));

  r.get('/conflicts', h((req, res) => {
    const p = paging(req, 15), where = ['1=1'], params: any[] = [];
    if (qs(req.query.status)) { where.push('c.status=?'); params.push(req.query.status); }
    if (qs(req.query.batch_id)) { where.push('c.batch_id=?'); params.push(Number(req.query.batch_id)); }
    const base = `FROM import_conflicts c JOIN public_institutions i ON i.id=c.institution_id LEFT JOIN users u ON u.id=c.resolved_by WHERE ${where.join(' AND ')}`;
    const total = (db.prepare(`SELECT COUNT(*) c ${base}`).get(...params) as any).c;
    res.json(paged(db.prepare(`SELECT c.*, i.name AS institution_name, i.aishe_code, i.state, u.name AS resolved_by_name ${base} ORDER BY CASE c.status WHEN 'open' THEN 0 ELSE 1 END, c.id DESC LIMIT ? OFFSET ?`).all(...params, p.pageSize, p.offset) as any[], total, p));
  }));
  r.post('/conflicts/:id/resolve', requireRole('admin'), h((req, res) => {
    const b = parse(z.object({ decision: z.enum(['keep_existing', 'use_incoming']), note: z.string().trim().min(3, 'Say why').max(500) }), req.body);
    resolveConflict(db, req.user!, intParam(req.params.id), b.decision, b.note); res.json({ ok: true });
  }));

  r.get('/institutions', h((req, res) => {
    const p = paging(req, 15), where = ['1=1'], params: any[] = [];
    if (qs(req.query.q)) { where.push('(i.name LIKE ? OR i.aishe_code LIKE ?)'); params.push(`%${req.query.q}%`, `%${req.query.q}%`); }
    for (const [k, col] of [['state', 'i.state'], ['district', 'i.district'], ['type', 'i.institution_type'], ['management', 'i.management']] as const) if (qs(req.query[k])) { where.push(`${col}=?`); params.push(req.query[k]); }
    const base = `FROM public_institutions i JOIN data_sources s ON s.id=i.source_id WHERE ${where.join(' AND ')}`;
    const total = (db.prepare(`SELECT COUNT(*) c ${base}`).get(...params) as any).c;
    res.json({ ...paged(db.prepare(`SELECT i.*, s.code AS source_code, s.name AS source_name, s.url AS source_url,
        (SELECT COUNT(*) FROM import_conflicts c WHERE c.institution_id=i.id AND c.status='open') AS open_conflicts ${base} ORDER BY i.state, i.name LIMIT ? OFFSET ?`).all(...params, p.pageSize, p.offset) as any[], total, p),
      states: (db.prepare('SELECT DISTINCT state FROM public_institutions ORDER BY state').all() as any[]).map(x => x.state) });
  }));

  r.get('/handbook-versions', h((_req, res) => res.json(db.prepare('SELECT * FROM handbook_versions ORDER BY id').all())));
  r.put('/handbook-versions/:id', requireRole('admin'), h((req, res) => {
    const id = intParam(req.params.id), cur = db.prepare('SELECT * FROM handbook_versions WHERE id=?').get(id) as any; if (!cur) throw notFound('Version not found');
    const b = parse(z.object({ status: z.enum(['current', 'superseded', 'unknown']), text_reviewed: z.boolean(), notes: z.string().trim().min(3, 'Say what you checked').max(1000) }), req.body);
    db.prepare('UPDATE handbook_versions SET status=?, text_reviewed=?, notes=?, checked_on=?, check_method=?, reviewed_by=? WHERE id=?').run(b.status, b.text_reviewed ? 1 : 0, b.notes, clock.today(), 'Administrator review in the app', req.user!.id, id);
    audit(db, { actor: actorOf(req.user!), type: 'regulatory.handbook_version_reviewed', entity: 'handbook_version', entityId: cur.code, prev: { status: cur.status, text_reviewed: !!cur.text_reviewed }, next: b, reason: b.notes });
    res.json({ ok: true });
  }));

  // rule activation gate
  r.get('/rules/:id/activation', h((req, res) => { const c = activationCheck(db, intParam(req.params.id)); if (!c) throw notFound('Rule not found'); res.json(c); }));
  r.post('/rules/:id/activation', requireRole('admin'), h((req, res) => {
    const b = parse(z.object({ action: z.enum(['activate', 'suspend']), note: z.string().trim().min(3, 'Say why').max(500) }), req.body);
    res.json({ activation_status: activateRule(db, req.user!, intParam(req.params.id), b.action, b.note) });
  }));
  return r;
}
void ApiError;
