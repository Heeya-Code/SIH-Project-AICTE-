import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import ExcelJS from 'exceljs';
import { makeCtx, count, type Ctx } from './helpers';
import { importFile, normalizeState, normalizeCode, cleanName, matchKey, parseYear, parseCsv, parseJson } from '../src/importer';
import { activationCheck } from '../src/publicdata';

// All rows below are FICTIONAL test fixtures ("Testville"), not real institutions or AISHE data.
const HEAD = 'AISHE Code,Name of the Institution,State,District,Year of Establishment,Location,College Type,Management,Affiliated University Name,Affiliated University Type';
const CSV = '\ufeff' + [HEAD,
  'C-10001,"TESTVILLE INSTITUTE OF ENGG. & TECH., TESTVILLE",Orissa,testville,1998,Urban,General,Private Unaided,Testville University,State Public University',
  'C-10002,Northfield College of Science,TAMIL NADU,Northfield,2005,Rural,Science,Government,,',
  'u 0374,Test Central University,Delhi,New Delhi,1990,Urban,University,Central Government,,',
  'C-10004,Missing State College,,Nowhere,2001,,,,,',
  'C-10005,Atlantis Institute,Atlantis,Deep Sea,2001,,,,,',
  'C-10001,"TESTVILLE INSTITUTE OF ENGG. & TECH., TESTVILLE",Orissa,testville,1998,Urban,General,Private Unaided,Testville University,State Public University',
  'C-10001,Totally Different Name College,Odisha,Elsewhere,1998,,,,,',
  'BADCODE,Odd Code College,Kerala,Kochi-test,1850,Urban,,Private,,',
  'C-10009,Year Test College,Kerala,Kochi-test,2090,Urban,,Private,,',
  ',"Quoted, Comma ""Test"" College",Goa,North Goa,2010,Urban,,Private,,',
  ',,Goa,North Goa,2010,Urban,,Private,,'].join('\r\n');

let ctx: Ctx; let seq = 0;
beforeEach(() => { ctx = makeCtx(); ctx.db.prepare(`UPDATE data_sources SET licence='Licence recorded for this test' WHERE code='AIKOSH-AISHE-COLLEGES'`).run(); seq = 0; });
const opts = (buf: string | Buffer, name = 'colleges.csv', extra: any = {}) => ({ sourceCode: 'AIKOSH-AISHE-COLLEGES', buffer: Buffer.isBuffer(buf) ? buf : Buffer.from(buf), fileName: name, academicYear: '2023-24', retrievedOn: '2026-03-02', ...extra });
const pub = (sql: string, ...p: any[]) => ctx.db.prepare(sql).all(...p) as any[];

describe('normalisation', () => {
  it('maps state aliases and spellings to canonical names, and rejects what it cannot place', () => {
    expect(normalizeState('Orissa')).toBe('Odisha'); expect(normalizeState('JAMMU & KASHMIR')).toBe('Jammu and Kashmir'); expect(normalizeState('NCT of Delhi')).toBe('Delhi'); expect(normalizeState(' tamil  nadu ')).toBe('Tamil Nadu');
    expect(normalizeState('Daman & Diu')).toBe('Dadra and Nagar Haveli and Daman and Diu'); expect(normalizeState('Atlantis')).toBeNull(); expect(normalizeState('')).toBeNull();
  });
  it('normalises AISHE codes but keeps leading zeros, and flags unknown formats', () => {
    expect(normalizeCode('u 0374').code).toBe('U-0374'); expect(normalizeCode('S-\n14875').code).toBe('S-14875'); expect(normalizeCode('c33504').code).toBe('C-33504'); expect(normalizeCode('S-799').code).toBe('S-799');
    expect(normalizeCode('BADCODE')).toEqual({ code: null, problem: 'format' }); expect(normalizeCode('')).toEqual({ code: null });
  });
  it('cleans names (case, spacing, quotes) and builds a match key that ignores punctuation and common abbreviations', () => {
    expect(cleanName('  "TESTVILLE  INSTITUTE OF ENGG. & TECH."  ')).toBe('Testville Institute of Engg. & Tech.');
    expect(cleanName('NIT Test Campus of Technology')).toBe('NIT Test Campus of Technology');
    expect(matchKey('Testville Inst. of Engg. & Tech.')).toBe(matchKey('TESTVILLE INSTITUTE OF ENGINEERING AND TECHNOLOGY'));
    expect(matchKey('A College')).not.toBe(matchKey('B College'));
  });
  it('parses years and CSV/JSON shapes', () => {
    expect(parseYear('1998.0').year).toBe(1998); expect(parseYear('2090')).toEqual({ year: null, bad: true }); expect(parseYear('')).toEqual({ year: null });
    expect(parseCsv('a;b\n"x;1";2')[0]).toEqual({ a: 'x;1', b: '2' });
    expect(parseJson(JSON.stringify({ records: [{ a: 1, b: null }] }))).toEqual([{ a: '1', b: '' }]);
    expect(() => parseJson('{"nope":1}')).toThrow(/array/); expect(() => parseCsv('a,b\n"open,1')).toThrow(/quote/);
  });
});

describe('import pipeline', () => {
  it('refuses to import until the source has a licence, and records the blocked attempt', async () => {
    ctx.db.prepare(`UPDATE data_sources SET licence=NULL WHERE code='AIKOSH-AISHE-COLLEGES'`).run();
    const r: any = await importFile(ctx.db, null, opts(CSV));
    expect(r.status).toBe('blocked_provenance'); expect(r.report.missing.join(' ')).toContain('licence'); expect(count(ctx.db, 'SELECT COUNT(*) c FROM public_institutions')).toBe(0);
    expect(ctx.db.prepare(`SELECT status FROM import_batches WHERE id=?`).get(r.batchId)).toEqual({ status: 'blocked_provenance' });
    const bad: any = await importFile(ctx.db, null, { ...opts(CSV), sourceCode: 'DATAGOV-AICTE-YEARWISE' }); expect(bad.status).toBe('blocked_provenance');             // aggregate source is not usable here
    const noDate: any = await importFile(ctx.db, null, { ...opts(CSV), retrievedOn: '2099-01-01', academicYear: '2023' }); expect(noDate.report.missing.join(' ')).toMatch(/academic year/);
  });

  it('imports a CSV, normalises fields, and reports rejected rows, duplicates and missing fields', async () => {
    const r: any = await importFile(ctx.db, null, opts(CSV)); const rep = r.report;
    expect(rep.rows_read).toBe(11); expect(rep.status).toBe('completed_with_warnings');
    expect(rep.rejected.count).toBe(3); expect(rep.rejected.by_reason).toMatchObject({ missing_state: 1, 'unrecognised_state: Atlantis': 1, missing_name: 1 });
    expect(rep.duplicates.in_file_identical).toBe(1); expect(rep.duplicates.in_file_conflicting).toBe(1);
    expect(rep.imported.new).toBe(6);
    expect(rep.warnings).toMatchObject({ code_format_unrecognised: 1, year_out_of_range: 1 });
    const rows = pub(`SELECT aishe_code, name, state, district, year_of_establishment, institution_type, management, origin FROM public_institutions ORDER BY id`);
    expect(rows[0]).toEqual({ aishe_code: 'C-10001', name: 'Testville Institute of Engg. & Tech., Testville', state: 'Odisha', district: 'Testville', year_of_establishment: 1998, institution_type: 'General', management: 'Private Unaided', origin: 'public_import' });
    expect(rows[1]).toMatchObject({ state: 'Tamil Nadu', name: 'Northfield College of Science' }); expect(rows[2]).toMatchObject({ aishe_code: 'U-0374', state: 'Delhi' });
    expect(rows.find(x => x.name === 'Odd Code College')).toMatchObject({ aishe_code: null, year_of_establishment: 1850 }); expect(rows.find(x => x.name === 'Year Test College')).toMatchObject({ year_of_establishment: null }); expect(rows.find(x => x.name.startsWith('Quoted'))!.name).toContain('"Test"');
    expect(rep.missing_fields.aishe_code.count).toBeGreaterThan(0); expect(rep.completeness_pct).toBeGreaterThan(40); expect(rep.completeness_pct).toBeLessThan(100);
    const b = ctx.db.prepare('SELECT * FROM import_batches WHERE id=?').get(r.batchId) as any;
    expect(b).toMatchObject({ academic_year: '2023-24', retrieved_on: '2026-03-02', format: 'csv', rows_rejected: 3, rows_new: 6 }); expect(b.file_sha256).toHaveLength(64);
    expect(pub('SELECT row_number, reason FROM import_rejects WHERE batch_id=? ORDER BY row_number', r.batchId).map(x => x.row_number)).toEqual([5, 6, 12]);
    expect(count(ctx.db, `SELECT COUNT(*) c FROM data_sources WHERE code='AIKOSH-AISHE-COLLEGES' AND access_status='downloaded_and_imported'`)).toBe(1);
    expect(count(ctx.db, `SELECT COUNT(*) c FROM data_sources WHERE access_status='downloaded_and_imported'`)).toBe(1);                       // other sources are not claimed
    expect(count(ctx.db, `SELECT COUNT(*) c FROM audit_log WHERE event_type='import.batch'`)).toBe(1);
  });

  it('gives the same records from CSV, JSON (data.gov.in style) and XLSX with a title line above the header', async () => {
    const records = [{ 'AISHE Code': 'C-20001', 'Name of the Institution': 'ZETA COLLEGE OF ARTS', State: 'Kerala', District: 'kochi-test', 'Year of Establishment': '1980', Management: 'Private' }, { 'AISHE Code': 'C-20002', 'Name of the Institution': 'Eta Institute', State: 'Goa', District: 'South Goa', 'Year of Establishment': 1999, Management: 'Government' }];
    const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet('Colleges'); ws.addRow(['All Colleges (test fixture)']); ws.addRow([]); ws.addRow(Object.keys(records[0])); for (const r of records) ws.addRow(Object.values(r)); const xlsx = Buffer.from(await wb.xlsx.writeBuffer());
    const csv = [Object.keys(records[0]).join(','), ...records.map(r => Object.values(r).join(','))].join('\n');
    const shapes: [string, Buffer][] = [['a.csv', Buffer.from(csv)], ['b.json', Buffer.from(JSON.stringify({ records, total: 2 }))], ['c.xlsx', xlsx]];
    const results: any[] = [];
    for (const [name, buf] of shapes) { const c = makeCtx(); c.db.prepare(`UPDATE data_sources SET licence='x' WHERE code='AIKOSH-AISHE-COLLEGES'`).run(); const r: any = await importFile(c.db, null, opts(buf, name)); expect(r.report.imported.new, name).toBe(2); results.push(c.db.prepare('SELECT aishe_code,name,state,district,year_of_establishment,management FROM public_institutions ORDER BY aishe_code').all()); }
    expect(results[1]).toEqual(results[0]); expect(results[2]).toEqual(results[0]); expect(results[0][0]).toMatchObject({ name: 'Zeta College of Arts', state: 'Kerala', district: 'Kochi-Test' });
  });

  it('never overwrites: conflicting values open conflicts, blanks are filled with a change log, repeats are unchanged', async () => {
    await importFile(ctx.db, null, opts([HEAD, 'C-30001,Alpha Test College,Kerala,Kochi-test,,Urban,General,Private,,', 'C-30002,Beta Test College,Goa,North Goa,1990,Urban,General,Government,,'].join('\n'), 'one.csv'));
    const second: any = await importFile(ctx.db, null, opts([HEAD, 'C-30001,Alpha Test College,Kerala,Kochi-test,1975,Urban,General,PRIVATE,,', 'C-30002,Gamma Renamed College,Karnataka,Mysuru-test,1991,Rural,Science,Private,,'].join('\n'), 'two.csv', { academicYear: '2024-25' }));
    expect(second.report.imported).toMatchObject({ new: 0, filled_blank: 1, unchanged: 0 });                           // Alpha: year filled; management differs only by case so not a conflict
    expect(second.report.conflicts.opened).toBe(7);                                                                    // Beta: name, state, district, type, management, year, location
    const alpha = ctx.db.prepare(`SELECT * FROM public_institutions WHERE aishe_code='C-30001'`).get() as any; expect(alpha).toMatchObject({ year_of_establishment: 1975, management: 'Private', first_batch_id: 1, last_batch_id: 2 });
    const beta = ctx.db.prepare(`SELECT * FROM public_institutions WHERE aishe_code='C-30002'`).get() as any; expect(beta).toMatchObject({ name: 'Beta Test College', state: 'Goa', management: 'Government', year_of_establishment: 1990 });   // untouched
    expect(pub(`SELECT field, existing_value, incoming_value, status FROM import_conflicts ORDER BY id`).map(x => x.field).sort()).toEqual(['district', 'institution_type', 'location', 'management', 'name', 'state', 'year_of_establishment']);
    expect(pub(`SELECT field, old_value, new_value, change_kind FROM public_institution_changes`)).toEqual([{ field: 'year_of_establishment', old_value: null, new_value: '1975', change_kind: 'filled_blank' }]);
    const third: any = await importFile(ctx.db, null, opts([HEAD, 'C-30001,Alpha Test College,Kerala,Kochi-test,1975,Urban,General,Private,,'].join('\n'), 'three.csv', { academicYear: '2025-26' }));
    expect(third.report.imported).toMatchObject({ new: 0, filled_blank: 0, unchanged: 1 });
  });

  it('skips an identical file imported twice, supports force, and a dry run writes nothing', async () => {
    const dry: any = await importFile(ctx.db, null, opts(CSV, 'x.csv', { dryRun: true }));
    expect(dry.dry_run).toBe(true); expect(dry.batchId).toBeNull(); expect(dry.report.imported.new).toBe(6);
    for (const t of ['public_institutions', 'import_batches', 'import_conflicts', 'import_rejects']) expect(count(ctx.db, `SELECT COUNT(*) c FROM ${t}`), t).toBe(0);
    await importFile(ctx.db, null, opts(CSV));
    const again: any = await importFile(ctx.db, null, opts(CSV)); expect(again.status).toBe('duplicate_file'); expect(count(ctx.db, 'SELECT COUNT(*) c FROM public_institutions')).toBe(6);
    const forced: any = await importFile(ctx.db, null, opts(CSV, 'colleges.csv', { force: true })); expect(forced.report.imported).toMatchObject({ new: 0, unchanged: 6 }); expect(forced.report.conflicts.opened).toBe(0);
  });

  it('flags a possible near-duplicate (same name and state, different district) without merging it', async () => {
    await importFile(ctx.db, null, opts([HEAD, ',Sigma Test College,Goa,North Goa,2000,,,,,'].join('\n'), 'a.csv'));
    const r: any = await importFile(ctx.db, null, opts([HEAD, ',SIGMA TEST COLLEGE,Goa,South Goa,2000,,,,,'].join('\n'), 'b.csv', { academicYear: '2024-25' }));
    expect(r.report.duplicates.possible_near).toBe(1); expect(r.report.imported.new).toBe(1); expect(count(ctx.db, 'SELECT COUNT(*) c FROM public_institutions')).toBe(2);
    expect(ctx.db.prepare(`SELECT kind FROM import_duplicates WHERE batch_id=?`).get(r.batchId)).toEqual({ kind: 'possible_near_duplicate' });
  });

  it('rejects files it cannot read or map, and keeps public records apart from the demo institutions', async () => {
    const demo = count(ctx.db, 'SELECT COUNT(*) c FROM institutions');
    await expect(importFile(ctx.db, null, opts(Buffer.from([0, 1, 2, 3]), 'bad.csv'))).rejects.toThrow(/binary/);
    await expect(importFile(ctx.db, null, opts('x', 'old.xls'))).rejects.toThrow(/xls/);
    const noCols: any = await importFile(ctx.db, null, opts('foo,bar\n1,2', 'nocols.csv')); expect(noCols.status).toBe('rejected'); expect(noCols.report.message).toMatch(/column mapping/);
    const mapped: any = await importFile(ctx.db, null, opts('Inst,Where\nMapped Test College,Goa', 'm.csv', { mapping: { Inst: 'name', Where: 'state' } })); expect(mapped.report.imported.new).toBe(1);
    expect(count(ctx.db, 'SELECT COUNT(*) c FROM institutions')).toBe(demo);
    expect(() => ctx.db.prepare(`UPDATE public_institutions SET origin='synthetic'`).run()).toThrow();
  });
});

describe('API access and human conflict resolution', () => {
  const send = async (email: string, buf: string, extra: Record<string, string> = {}, name = 'f.csv') => {
    const t = await ctx.login(email); const f: Record<string, string> = { source_code: 'AIKOSH-AISHE-COLLEGES', academic_year: '2023-24', retrieved_on: '2026-03-02', ...extra };
    let r = request(ctx.app).post('/api/public-data/import').set('Authorization', `Bearer ${t}`); for (const [k, v] of Object.entries(f)) r = r.field(k, v); return r.attach('file', Buffer.from(buf), { filename: name });
  };
  it('only administrators can import or resolve; institutions cannot read; officers can read', async () => {
    expect((await send('bureau@demo.local', CSV)).status).toBe(403); expect((await send('inst1@demo.local', CSV)).status).toBe(403);
    expect((await (await ctx.as('inst1@demo.local')).get('/api/public-data/summary')).status).toBe(403);
    const ok = await send('admin@demo.local', CSV); expect(ok.status).toBe(201); expect(ok.body.report.imported.new).toBe(6);
    const b = await ctx.as('bureau@demo.local'); expect((await b.get('/api/public-data/institutions?state=Odisha')).body.rows[0]).toMatchObject({ aishe_code: 'C-10001', source_code: 'AIKOSH-AISHE-COLLEGES', academic_year: '2023-24' });
    expect((await b.get('/api/public-data/batches')).body.rows[0]).toMatchObject({ status: 'completed_with_warnings', rows_rejected: 3 }); expect((await b.get('/api/public-data/institutions?q=Quoted')).body.total).toBe(1);
    const csv = await b.get(`/api/public-data/batches/${ok.body.batchId}/rejects.csv`); expect(csv.status).toBe(200); expect(csv.text).toContain('missing_state');
    expect((await send('admin@demo.local', 'x', {}, 'evil.exe')).status).toBe(400); expect((await send('admin@demo.local', CSV, { dry_run: '1' }, 'dry.csv')).status).toBe(200);
  });
  it('a conflict is resolved only by an explicit human decision, with a reason, and is audited', async () => {
    await send('admin@demo.local', [HEAD, 'C-40001,Delta Test College,Goa,North Goa,1990,,,Government,,'].join('\n'));
    await send('admin@demo.local', [HEAD, 'C-40001,Delta Test College,Goa,North Goa,1990,,,Private,,'].join('\n'), { academic_year: '2024-25' });
    const admin = await ctx.as('admin@demo.local'), bureau = await ctx.as('bureau@demo.local');
    const list = (await bureau.get('/api/public-data/conflicts?status=open')).body; expect(list.total).toBe(1); expect(list.rows[0]).toMatchObject({ field: 'management', existing_value: 'Government', incoming_value: 'Private' });
    const id = list.rows[0].id;
    expect((await bureau.post(`/api/public-data/conflicts/${id}/resolve`, { decision: 'use_incoming', note: 'because' })).status).toBe(403);
    expect((await admin.post(`/api/public-data/conflicts/${id}/resolve`, { decision: 'use_incoming' })).status).toBe(400);                   // reason required
    expect(ctx.db.prepare(`SELECT management FROM public_institutions WHERE aishe_code='C-40001'`).get()).toEqual({ management: 'Government' });
    expect((await admin.post(`/api/public-data/conflicts/${id}/resolve`, { decision: 'use_incoming', note: 'Confirmed on the AISHE directory page' })).status).toBe(200);
    expect(ctx.db.prepare(`SELECT management FROM public_institutions WHERE aishe_code='C-40001'`).get()).toEqual({ management: 'Private' });
    expect(pub(`SELECT change_kind FROM public_institution_changes`)).toEqual([{ change_kind: 'conflict_resolved_use_incoming' }]);
    expect((await admin.post(`/api/public-data/conflicts/${id}/resolve`, { decision: 'keep_existing', note: 'again' })).status).toBe(409);
    expect(ctx.db.prepare(`SELECT reason, prev_state, new_state FROM audit_log WHERE event_type='import.conflict_resolved'`).get()).toMatchObject({ reason: 'Confirmed on the AISHE directory page' });
  });
  it('lets an administrator record the licence, which unblocks the source', async () => {
    const admin = await ctx.as('admin@demo.local'); const sid = (ctx.db.prepare(`SELECT id FROM data_sources WHERE code='AISHE-DIRECTORY'`).get() as any).id;
    expect((await send('admin@demo.local', CSV, { source_code: 'AISHE-DIRECTORY' })).body.status).toBe('blocked_provenance');
    expect((await admin.put(`/api/public-data/sources/${sid}`, { licence: 'Open Government License, India (confirmed on the dataset page)' })).status).toBe(200);
    expect(count(ctx.db, `SELECT COUNT(*) c FROM audit_log WHERE event_type='config.data_source_updated'`)).toBe(1);
  });
});

describe('handbook versions and rule activation', () => {
  const ruleId = (code: string) => (ctx.db.prepare('SELECT id FROM regulatory_rules WHERE code=?').get(code) as any).id as number;
  it('records what is known about versions and amendments, and says what was not read', () => {
    const v = pub('SELECT code, kind, status, text_reviewed FROM handbook_versions ORDER BY id');
    expect(v.map(x => x.code)).toEqual(['APH-2024-27', 'APH-2025-26-ADDENDUM', 'APH-2026-27-ADDENDUM', 'APH-SUCCESSOR']);
    expect(v.every(x => x.text_reviewed === 0)).toBe(true); expect(v.find(x => x.code === 'APH-SUCCESSOR')!.status).toBe('unknown');
    expect(count(ctx.db, `SELECT COUNT(*) c FROM data_sources WHERE code='AICTE-APH-OFFICIAL' AND access_status='blocked'`)).toBe(1);
  });
  it('blocks activation until the rule is checked against the official text, the version is current and addenda are reviewed', async () => {
    const c = activationCheck(ctx.db, ruleId('R-EVC-01'))!; expect(c.can_activate).toBe(false);
    expect(c.blockers.join(' ')).toMatch(/official handbook text/); expect(c.blockers.join(' ')).toMatch(/Addendum .*2026-27/);
    expect(activationCheck(ctx.db, ruleId('A-DL-01'))!.blockers[0]).toMatch(/assumption/);
    expect(activationCheck(ctx.db, ruleId('R-NEWS-01'))!.can_activate).toBe(false);
    const admin = await ctx.as('admin@demo.local');
    expect((await admin.post(`/api/public-data/rules/${ruleId('R-EVC-01')}/activation`, { action: 'activate', note: 'trying' })).status).toBe(422);
    expect((await admin.put(`/api/regulatory/rules/${ruleId('R-EVC-01')}/review`, { status: 'verified_official', notes: 'Checked clause 2.6 in the official PDF.' })).status).toBe(200);
    expect(activationCheck(ctx.db, ruleId('R-EVC-01'))!.blockers.join(' ')).not.toMatch(/official handbook text/);
    expect((await admin.post(`/api/public-data/rules/${ruleId('R-EVC-01')}/activation`, { action: 'activate', note: 'trying' })).status).toBe(422);          // addendum still unreviewed
    const addendum = (ctx.db.prepare(`SELECT id FROM handbook_versions WHERE code='APH-2026-27-ADDENDUM'`).get() as any).id;
    expect((await admin.put(`/api/public-data/handbook-versions/${addendum}`, { status: 'current', text_reviewed: true, notes: 'Read the 2026-27 addendum; no change to 2.6.' })).status).toBe(200);
    expect(activationCheck(ctx.db, ruleId('R-EVC-01'))!.can_activate).toBe(true);
    const bureau = await ctx.as('bureau@demo.local'); expect((await bureau.post(`/api/public-data/rules/${ruleId('R-EVC-01')}/activation`, { action: 'activate', note: 'try' })).status).toBe(403);
    expect((await admin.post(`/api/public-data/rules/${ruleId('R-EVC-01')}/activation`, { action: 'activate', note: 'All checks done' })).body.activation_status).toBe('active');
    expect(count(ctx.db, `SELECT COUNT(*) c FROM audit_log WHERE event_type IN ('regulatory.rule_activated','regulatory.handbook_version_reviewed')`)).toBe(2);
  });
  it('shows existing demo bindings as demo-active, not as verified', () => {
    expect(pub(`SELECT code, activation_status, verification_status FROM regulatory_rules WHERE workflow_binding IS NOT NULL ORDER BY code`).every(x => x.activation_status === 'demo_active' && x.verification_status !== 'verified_official')).toBe(true);
  });
});
