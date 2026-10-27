import { describe, it, expect, beforeEach } from 'vitest';
import { makeCtx, newApp, count, upload, setNow, type Ctx } from './helpers';
import { docName, docCode } from '../src/docnames';
import { runJobs } from '../src/jobs';

let ctx: Ctx;
beforeEach(() => { ctx = makeCtx(); });

describe('descriptive document names', () => {
  it('maps stored types to readable names, with safe fallbacks, and formats a secondary document ID', () => {
    expect(docName('Lease Deed')).toBe('Lease Agreement');
    expect(docName('Land / Title Documents')).toBe('Land Ownership Document');
    expect(docName('Some Future Type')).toBe('Some Future Type');          // unknown type: shown as stored, not renamed or guessed
    expect(docName('')).toBe('Unnamed Document'); expect(docName(null)).toBe('Unnamed Document');
    expect(docCode(42)).toBe('DOC-0042');
  });

  it('returns display name and document ID alongside the unchanged stored type and ID', async () => {
    const id = await newApp(ctx);
    const inst = await ctx.as('inst1@demo.local');
    const detail = (await inst.get(`/api/applications/${id}`)).body;
    const lease = detail.documents.find((d: any) => d.doc_type === 'Lease Deed');
    expect(lease).toMatchObject({ doc_type: 'Lease Deed', display_name: 'Lease Agreement' }); expect(lease.doc_code).toMatch(/^DOC-\d{4}$/);
    expect(lease.id).toBeTypeOf('number');                                   // real identifier untouched
    expect(detail.required_documents.map((r: any) => r.display_name).sort()).toEqual(['Annual Self-Disclosure Declaration', 'Lease Agreement']);
    const list = (await inst.get('/api/documents')).body.rows; expect(list.every((d: any) => d.display_name && d.doc_code)).toBe(true);
    expect((await inst.get('/api/lookups')).body.doc_type_names['Lease Deed']).toBe('Lease Agreement');
  });

  it('filtering, downloading and storage still use the stored type and ID', async () => {
    await newApp(ctx);
    const inst = await ctx.as('inst1@demo.local');
    expect((await inst.get('/api/documents?doc_type=Lease Deed')).body.total).toBe(1);
    const doc = (await inst.get('/api/documents')).body.rows[0];
    const dl = await inst.get(`/api/documents/${doc.id}/download`); expect(dl.status).toBe(200);
    expect(JSON.stringify(doc)).not.toContain('storage_ref');
  });

  it('uses descriptive names in error messages, notifications, timeline, audit and reports', async () => {
    const id = await newApp(ctx);
    const u = await ctx.as('inst1@demo.local');
    const draft = (await u.post('/api/applications', { category_code: 'EXT', title: 'Draft with no documents' })).body.id;
    expect(JSON.stringify((await u.post(`/api/applications/${draft}/submit`)).body.error.details)).toContain('Lease Agreement');
    const docId = (ctx.db.prepare(`SELECT id FROM documents WHERE application_id=? AND doc_type='Lease Deed'`).get(id) as any).id;
    ctx.db.prepare('UPDATE documents SET expiry_date=? WHERE id=?').run('2026-03-20', docId);
    setNow('2026-03-15T04:30:00Z'); await runJobs(ctx.db, 'test');
    const n = ctx.db.prepare(`SELECT title FROM notifications WHERE event='document.expiry_approaching'`).get() as any;
    expect(n.title).toContain('Lease Agreement'); expect(n.title).not.toContain('Lease Deed');
    const tl = JSON.stringify((await u.get(`/api/applications/${id}/timeline`)).body); expect(tl).toContain(`Lease Agreement (${docCode(docId)})`);
    const dash = (await u.get('/api/dashboard')).body;
    const dl = dash.lists.find((l: any) => l.key === 'deadlines').rows.find((r: any) => /Lease Agreement expiry \(DOC-\d{4}\)/.test(r.what)); expect(dl.what).toContain(docCode(docId));
    const subs = dash.lists.find((l: any) => l.key === 'subs').rows[0]; expect(subs.docs).toContain('Lease Agreement'); expect(subs.kind).toBe('Initial submission');
    const admin = await ctx.as('admin@demo.local');
    const aud = (await admin.get('/api/audit?entity_type=document')).body.rows[0]; expect(aud.entity_label).toContain('(DOC-');
    const rep = (await (await ctx.as('ro.nr@demo.local')).get('/api/reports/documents_validity?window=60')).body;
    expect(rep.rows[0]).toMatchObject({ doc_type: 'Lease Agreement' }); expect(rep.columns.map((c: any) => c.label)).toContain('Document ID');
  });

  it('keeps unnamed or unknown uploads visible with a neutral label, never a wrong type', async () => {
    const u = await ctx.as('inst1@demo.local');
    const r = await upload(ctx, 'inst1@demo.local', { doc_type: 'Board Resolution' });
    expect(r.status).toBe(201);
    const row = (await u.get('/api/documents')).body.rows.find((d: any) => d.id === r.body.id);
    expect(row).toMatchObject({ doc_type: 'Board Resolution', display_name: 'Board Resolution' });
    ctx.db.prepare(`UPDATE documents SET doc_type='' WHERE id=?`).run(r.body.id);
    expect((await u.get('/api/documents')).body.rows.find((d: any) => d.id === r.body.id).display_name).toBe('Unnamed Document');
    expect(count(ctx.db, 'SELECT COUNT(*) c FROM documents')).toBe(1);
  });
});

describe('lookups', () => {
  it('works for every role and only lists the institutions in scope', async () => {
    for (const e of ['inst1@demo.local', 'ro.nr@demo.local', 'evc.nr@demo.local', 'bureau@demo.local', 'authority@demo.local', 'admin@demo.local']) expect((await (await ctx.as(e)).get('/api/lookups')).status, e).toBe(200);
    expect((await (await ctx.as('inst1@demo.local')).get('/api/lookups')).body.institutions.map((i: any) => i.id)).toEqual([1]);
    expect((await (await ctx.as('ro.nr@demo.local')).get('/api/lookups')).body.institutions.map((i: any) => i.id)).toEqual([1, 2]);
  });
});
