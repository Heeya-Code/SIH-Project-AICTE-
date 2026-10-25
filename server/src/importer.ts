import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import ExcelJS from 'exceljs';
import type { DB } from './db';
import { clock } from './clock';
import { config } from './config';
import { audit, actorOf } from './audit';
import type { User } from './auth';
import { ApiError, isDate, notFound } from './util';

// ================================================================================================ normalisation
const STATES = ['Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chhattisgarh', 'Goa', 'Gujarat', 'Haryana', 'Himachal Pradesh', 'Jharkhand', 'Karnataka', 'Kerala', 'Madhya Pradesh', 'Maharashtra', 'Manipur', 'Meghalaya', 'Mizoram', 'Nagaland', 'Odisha', 'Punjab', 'Rajasthan', 'Sikkim', 'Tamil Nadu', 'Telangana', 'Tripura', 'Uttar Pradesh', 'Uttarakhand', 'West Bengal',
  'Andaman and Nicobar Islands', 'Chandigarh', 'Dadra and Nagar Haveli and Daman and Diu', 'Delhi', 'Jammu and Kashmir', 'Ladakh', 'Lakshadweep', 'Puducherry'];
const STATE_ALIASES: Record<string, string> = {
  orissa: 'Odisha', uttaranchal: 'Uttarakhand', pondicherry: 'Puducherry', 'nct of delhi': 'Delhi', 'new delhi': 'Delhi', 'delhi ncr': 'Delhi', 'jammu & kashmir': 'Jammu and Kashmir', 'jammu kashmir': 'Jammu and Kashmir', 'andaman & nicobar islands': 'Andaman and Nicobar Islands', 'andaman nicobar islands': 'Andaman and Nicobar Islands',
  'dadra & nagar haveli': 'Dadra and Nagar Haveli and Daman and Diu', 'dadra and nagar haveli': 'Dadra and Nagar Haveli and Daman and Diu', 'daman & diu': 'Dadra and Nagar Haveli and Daman and Diu', 'daman and diu': 'Dadra and Nagar Haveli and Daman and Diu', 'dadra & nagar haveli and daman & diu': 'Dadra and Nagar Haveli and Daman and Diu',
  'chattisgarh': 'Chhattisgarh', 'telengana': 'Telangana', 'tamilnadu': 'Tamil Nadu', 'pondichery': 'Puducherry', 'west bengal.': 'West Bengal', 'orrisa': 'Odisha',
};
const STATE_LOOKUP = new Map<string, string>([...STATES.map(s => [s.toLowerCase(), s] as [string, string]), ...Object.entries(STATE_ALIASES)]);
const squash = (s: string) => s.normalize('NFC').replace(/[\u200b-\u200d\ufeff]/g, '').replace(/\s+/g, ' ').trim();

export function normalizeState(raw: unknown): string | null {
  const k = squash(String(raw ?? '')).toLowerCase().replace(/\s*&\s*/g, ' & ').replace(/\./g, '').replace(/\s+/g, ' ');
  if (!k) return null;
  return STATE_LOOKUP.get(k) ?? STATE_LOOKUP.get(k.replace(/ & /g, ' and ')) ?? null;
}

// AISHE codes look like U-0374, C-61982, S-799. The letter says University / College / Standalone. Leading zeros are significant (U-0374), so they are kept.
export function normalizeCode(raw: unknown): { code: string | null; problem?: 'format' } {
  const s = String(raw ?? '').replace(/\s+/g, '').toUpperCase();
  if (!s) return { code: null };
  const m = /^([CUS])-?(\d{1,6})$/.exec(s);
  return m ? { code: `${m[1]}-${m[2]}` } : { code: null, problem: 'format' };
}

const SMALL = new Set(['of', 'and', 'for', 'the', 'in', 'at', 'on', 'to', 'a', 'an', 'cum']);
export function cleanName(raw: unknown): string {
  let s = squash(String(raw ?? '')).replace(/^["'`]+|["'`]+$/g, '').replace(/\s+,/g, ',').replace(/`/g, '\'');
  const letters = s.replace(/[^A-Za-z]/g, '');
  if (letters.length > 5 && letters === letters.toUpperCase()) {                  // ALL CAPS: title-case it, keep short acronyms
    s = s.toLowerCase().split(' ').map((w, i) => (/^[a-z]{1,4}\.?$/.test(w) && !SMALL.has(w) && /^(nit|iit|iiit|iim|iisc|aicte|ugc|mba|mca|bca|bba|nri|ii?t|it|cse|ece|eee|dr|sri|smt|st|ac)\.?$/.test(w) ? w.toUpperCase() : (i > 0 && SMALL.has(w) ? w : w.replace(/(^|[-'(])([a-z])/g, (_m, a, b) => a + b.toUpperCase())))).join(' ');
  }
  return s;
}
const ABBR: Record<string, string> = { inst: 'institute', instt: 'institute', engg: 'engineering', eng: 'engineering', tech: 'technology', technol: 'technology', univ: 'university', govt: 'government', gov: 'government', coll: 'college', poly: 'polytechnic', mgmt: 'management', mgt: 'management', sci: 'science', dept: 'department' };
// A deliberately aggressive key used ONLY to detect that two records may be the same institution. It is never shown as a name.
export function matchKey(name: string): string {
  return squash(name).toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean).map(w => ABBR[w] ?? w).filter(w => w !== 'the').join(' ');
}
export const normalizeDistrict = (raw: unknown) => { const s = squash(String(raw ?? '')); return s ? s.toLowerCase().replace(/(^|[\s-])([a-z])/g, (_m, a, b) => a + b.toUpperCase()) : null; };
export function parseYear(raw: unknown): { year: number | null; bad?: boolean } {
  const s = String(raw ?? '').trim(); if (!s) return { year: null };
  const m = /^(\d{4})(?:\.0+)?$/.exec(s) ?? /(\d{4})/.exec(s);
  const y = m ? Number(m[1]) : NaN;
  return y >= 1800 && y <= new Date().getFullYear() ? { year: y } : { year: null, bad: true };
}
const textOrNull = (v: unknown) => { const s = squash(String(v ?? '')); return s && !/^(na|n\/a|nil|null|none|-|--)$/i.test(s) ? s : null; };

// ================================================================================================ parsing
export type RawRow = Record<string, string>;
export function parseCsv(text: string): RawRow[] {
  text = text.replace(/^\ufeff/, '');
  const first = text.split(/\r?\n/, 1)[0] ?? '';
  const delim = [',', ';', '\t', '|'].map(d => [d, first.split(d).length] as const).sort((a, b) => b[1] - a[1])[0][0];
  const rows: string[][] = []; let cur: string[] = [], f = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
    else if (c === '"') q = true;
    else if (c === delim) { cur.push(f); f = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; cur.push(f); f = ''; if (cur.some(x => x.trim() !== '')) rows.push(cur); cur = []; }
    else f += c;
  }
  cur.push(f); if (cur.some(x => x.trim() !== '')) rows.push(cur);
  if (q) throw new ApiError(400, 'BAD_FILE', 'The CSV has an unterminated quote');
  const head = rows.shift()?.map(h => h.trim()) ?? [];
  return rows.map(r => Object.fromEntries(head.map((h, i) => [h, (r[i] ?? '').trim()])));
}
export function parseJson(text: string): RawRow[] {
  let j: any; try { j = JSON.parse(text.replace(/^\ufeff/, '')); } catch { throw new ApiError(400, 'BAD_FILE', 'The file is not valid JSON'); }
  const arr = Array.isArray(j) ? j : j?.records ?? j?.data ?? j?.rows ?? j?.items ?? j?.result?.records ?? null;     // data.gov.in API responses wrap rows in "records"
  if (!Array.isArray(arr)) throw new ApiError(400, 'BAD_FILE', 'Expected a JSON array, or an object with a "records", "data" or "rows" array');
  return arr.filter(x => x && typeof x === 'object' && !Array.isArray(x)).map((o: any) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, v == null || typeof v === 'object' ? '' : String(v)])));
}
const cellText = (v: ExcelJS.CellValue): string => {
  if (v == null) return ''; if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'object') { const o: any = v; if (o.richText) return o.richText.map((t: any) => t.text).join(''); if ('result' in o) return cellText(o.result); if (o.text) return String(o.text); if (o.hyperlink) return String(o.hyperlink); return ''; }
  return String(v);
};
export async function parseXlsx(buf: Buffer, sheetName?: string): Promise<RawRow[]> {
  const wb = new ExcelJS.Workbook();
  try { await wb.xlsx.load(buf as any); } catch { throw new ApiError(400, 'BAD_FILE', 'The file could not be read as an .xlsx workbook'); }
  const ws = sheetName ? wb.getWorksheet(sheetName) : wb.worksheets.find(w => w.rowCount > 1) ?? wb.worksheets[0];
  if (!ws) throw new ApiError(400, 'BAD_FILE', sheetName ? `Sheet "${sheetName}" was not found` : 'The workbook has no sheets');
  const rows: string[][] = [];
  ws.eachRow({ includeEmpty: false }, row => { rows.push((row.values as ExcelJS.CellValue[]).slice(1).map(cellText).map(s => s.trim())); });
  const hi = rows.findIndex(r => r.filter(Boolean).length >= 3);        // title lines above the header are skipped
  if (hi < 0) return [];
  const head = rows[hi];
  return rows.slice(hi + 1).filter(r => r.some(Boolean)).map(r => Object.fromEntries(head.map((h, i) => [h, r[i] ?? '']).filter(([h]) => h)));
}
export async function parseFile(buf: Buffer, fileName: string, sheet?: string): Promise<{ format: 'csv' | 'xlsx' | 'json'; rows: RawRow[] }> {
  const ext = path.extname(fileName).toLowerCase();
  if (ext === '.xlsx') { if (buf.subarray(0, 2).toString('latin1') !== 'PK') throw new ApiError(400, 'BAD_FILE', 'The file does not look like an .xlsx workbook'); return { format: 'xlsx', rows: await parseXlsx(buf, sheet) }; }
  if (ext === '.xls') throw new ApiError(400, 'BAD_FILE', 'Old .xls files are not supported. Save the sheet as .xlsx or .csv.');
  if (buf.includes(0)) throw new ApiError(400, 'BAD_FILE', 'The file looks binary. Use .csv, .xlsx or .json.');
  const text = buf.toString('utf8');
  if (ext === '.json') return { format: 'json', rows: parseJson(text) };
  if (ext === '.csv' || ext === '.txt') return { format: 'csv', rows: parseCsv(text) };
  throw new ApiError(400, 'BAD_FILE', 'Use a .csv, .xlsx or .json file');
}

// ================================================================================================ field mapping
export const FIELDS = ['aishe_code', 'name', 'state', 'district', 'institution_type', 'management', 'year_of_establishment', 'location', 'university_name', 'university_type'] as const;
export type Field = typeof FIELDS[number];
const ALIASES: Record<Field, string[]> = {
  name: ['name', 'nameoftheinstitution', 'nameofinstitution', 'institutionname', 'institutename', 'collegename', 'nameofuniversity', 'universityname', 'instituteuniversityname'],
  aishe_code: ['aishecode', 'aishe', 'aisheid', 'instcode', 'institutecode', 'institutioncode', 'code'],
  state: ['state', 'statename', 'nameofthestate', 'stateut', 'stateorut'],
  district: ['district', 'districtname'],
  institution_type: ['collegetype', 'standalonetype', 'institutiontype', 'typeofinstitution', 'type'],
  management: ['management', 'managementtype', 'managementofinstitution'],
  year_of_establishment: ['yearofestablishment', 'establishmentyear', 'yearestablished', 'established', 'yearofestablishmentofinstitution'],
  location: ['location', 'ruralurban', 'locationruralurban'],
  university_name: ['affiliateduniversityname', 'affiliatinguniversity', 'universityaffiliation'],
  university_type: ['affiliateduniversitytype'],
};
const hnorm = (h: string) => h.toLowerCase().replace(/[^a-z0-9]/g, '');
export function buildMapping(headers: string[], override: Record<string, string> = {}) {
  const map: Record<string, Field> = {}; const used = new Set<Field>();
  for (const [h, f] of Object.entries(override)) if ((FIELDS as readonly string[]).includes(f) && headers.includes(h)) { map[h] = f as Field; used.add(f as Field); }
  for (const h of headers) { if (map[h]) continue; const n = hnorm(h); const f = FIELDS.find(f => !used.has(f) && ALIASES[f].includes(n)); if (f) { map[h] = f; used.add(f); } }
  return { map, unmapped: headers.filter(h => !map[h]), missing_fields: FIELDS.filter(f => !used.has(f)) };
}

// ================================================================================================ import
export type ImportOptions = { sourceCode: string; buffer: Buffer; fileName: string; academicYear: string; retrievedOn: string; mapping?: Record<string, string>; sheet?: string; dryRun?: boolean; force?: boolean };
type Rec = { aishe_code: string | null; name: string; match_key: string; state: string; district: string | null; institution_type: string | null; management: string | null; year_of_establishment: number | null; location: string | null; university_name: string | null; university_type: string | null };
const COMPARE: (keyof Rec)[] = ['name', 'state', 'district', 'institution_type', 'management', 'year_of_establishment', 'location', 'university_name', 'university_type'];
const same = (f: keyof Rec, a: any, b: any) => (f === 'name' ? matchKey(String(a)) === matchKey(String(b)) : String(a).trim().toLowerCase() === String(b).trim().toLowerCase());

export function assessProvenance(src: any, academicYear: string, retrievedOn: string) {
  const missing: string[] = [];
  if (!src.usable_for_import) missing.push('This source is registered as not usable by the institution importer (for example aggregate statistics).');
  if (!src.publisher?.trim()) missing.push('publisher');
  if (!src.licence?.trim()) missing.push('licence (record it on the source after checking the dataset page)');
  if (!src.field_definitions_ref?.trim()) missing.push('field definitions reference');
  if (!/^\d{4}-\d{2}$/.test(academicYear)) missing.push('academic year in the form 2023-24');
  if (!isDate(retrievedOn) || retrievedOn > clock.today()) missing.push('retrieval date (a past or current date, YYYY-MM-DD)');
  return missing;
}

class Rollback extends Error {}

export async function importFile(db: DB, user: User | null, o: ImportOptions) {
  const src = db.prepare('SELECT * FROM data_sources WHERE code=?').get(o.sourceCode) as any;
  if (!src) throw notFound('Unknown data source');
  const sha = crypto.createHash('sha256').update(o.buffer).digest('hex');
  const started = clock.iso();
  const record = (status: string, extra: Record<string, any>, report: any, format = 'csv') => {
    const id = Number(db.prepare(`INSERT INTO import_batches (source_id,file_name,file_sha256,file_ref,format,academic_year,retrieved_on,mapping,status,rows_read,rows_new,rows_unchanged,rows_filled,rows_rejected,rows_duplicate,conflicts_opened,possible_duplicates,report,imported_by,started_at,finished_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(src.id, o.fileName, sha, extra.file_ref ?? null, format, /^\d{4}-\d{2}$/.test(o.academicYear) ? o.academicYear : 'unknown', isDate(o.retrievedOn) ? o.retrievedOn : clock.today(), JSON.stringify(o.mapping ?? null), status,
      extra.rows_read ?? 0, extra.rows_new ?? 0, extra.rows_unchanged ?? 0, extra.rows_filled ?? 0, extra.rows_rejected ?? 0, extra.rows_duplicate ?? 0, extra.conflicts_opened ?? 0, extra.possible_duplicates ?? 0, JSON.stringify(report), user?.id ?? null, started, clock.iso()).lastInsertRowid);
    return id;
  };

  // 1. provenance: licence, publisher, dates and field definitions must be known before anything is imported
  const missingProv = assessProvenance(src, o.academicYear, o.retrievedOn);
  if (missingProv.length) {
    const report = { status: 'blocked_provenance', message: 'The import was not run because provenance is incomplete.', missing: missingProv };
    const batchId = o.dryRun ? null : record('blocked_provenance', {}, report);
    return { batchId, status: 'blocked_provenance', dry_run: !!o.dryRun, report };
  }
  // 2. the same file for the same source and year is never imported twice
  if (!o.force) {
    const prior = db.prepare(`SELECT id FROM import_batches WHERE source_id=? AND file_sha256=? AND academic_year=? AND status IN ('completed','completed_with_warnings') LIMIT 1`).get(src.id, sha, o.academicYear) as any;
    if (prior) { const report = { status: 'duplicate_file', message: `This exact file was already imported as batch #${prior.id}. Nothing was changed.`, existing_batch: prior.id }; return { batchId: o.dryRun ? null : record('duplicate_file', {}, report), status: 'duplicate_file', dry_run: !!o.dryRun, report }; }
  }
  // 3. parse
  const { format, rows } = await parseFile(o.buffer, o.fileName, o.sheet);
  if (rows.length > 300000) throw new ApiError(400, 'BAD_FILE', 'The file has more than 300,000 rows. Split it first.');
  const headers = rows.length ? Object.keys(rows[0]) : [];
  const { map, unmapped, missing_fields } = buildMapping(headers, o.mapping);
  if (!rows.length || !Object.values(map).includes('name') || !Object.values(map).includes('state')) {
    const report = { status: 'rejected', message: !rows.length ? 'The file has no data rows.' : 'The file has no recognisable institution name and state columns. Provide a column mapping.', headers, mapped: map, unmapped_columns: unmapped };
    return { batchId: o.dryRun ? null : record('rejected', { rows_read: rows.length }, report, format), status: 'rejected', dry_run: !!o.dryRun, report };
  }

  const missingCount: Record<string, number> = Object.fromEntries(FIELDS.map(f => [f, 0]));
  const rejectsBy: Record<string, number> = {}; const warnings: Record<string, number> = {};
  const rejects: { row: number; reason: string; raw: RawRow }[] = [];
  const dups: { kind: string; key: string; rows: number[]; detail: string }[] = [];
  const bump = (m: Record<string, number>, k: string) => { m[k] = (m[k] ?? 0) + 1; };
  const reject = (row: number, reason: string, raw: RawRow) => { rejects.push({ row, reason, raw }); bump(rejectsBy, reason); };

  // 4. normalise and validate each row
  const accepted: { row: number; rec: Rec }[] = [];
  rows.forEach((raw, idx) => {
    const rowNo = idx + 2;                                   // 1 = header
    const g = (f: Field) => { const h = Object.keys(map).find(k => map[k] === f); return h ? raw[h] : ''; };
    const name = cleanName(g('name')); const stateRaw = squash(g('state'));
    if (!name) return reject(rowNo, 'missing_name', raw);
    if (!stateRaw) return reject(rowNo, 'missing_state', raw);
    const state = normalizeState(stateRaw); if (!state) return reject(rowNo, `unrecognised_state: ${stateRaw}`.slice(0, 80), raw);
    const c = normalizeCode(g('aishe_code')); if (c.problem) bump(warnings, 'code_format_unrecognised');
    const y = parseYear(g('year_of_establishment')); if (y.bad) bump(warnings, 'year_out_of_range');
    const rec: Rec = { aishe_code: c.code, name, match_key: matchKey(name), state, district: normalizeDistrict(g('district')), institution_type: textOrNull(g('institution_type')), management: textOrNull(g('management')), year_of_establishment: y.year, location: textOrNull(g('location')), university_name: textOrNull(g('university_name')) ? cleanName(g('university_name')) : null, university_type: textOrNull(g('university_type')) };
    for (const f of FIELDS) if (rec[f] == null || rec[f] === '') missingCount[f]++;
    accepted.push({ row: rowNo, rec });
  });

  // 5. duplicates inside the file: the first occurrence wins, later ones are reported and not imported
  const seenCode = new Map<string, { row: number; rec: Rec }>(); const seenKey = new Map<string, { row: number; rec: Rec }>();
  const unique: { row: number; rec: Rec }[] = [];
  for (const a of accepted) {
    const k3 = `${a.rec.match_key}|${a.rec.state}|${a.rec.district ?? ''}`;
    const prior = (a.rec.aishe_code && seenCode.get(a.rec.aishe_code)) || seenKey.get(k3);
    if (prior) {
      const identical = COMPARE.every(f => prior.rec[f] == null || a.rec[f] == null || same(f, prior.rec[f], a.rec[f]));
      dups.push({ kind: identical ? 'in_file_identical' : 'in_file_conflicting', key: a.rec.aishe_code ?? k3, rows: [prior.row, a.row], detail: identical ? 'Repeated record, second occurrence skipped.' : `Same ${a.rec.aishe_code && seenCode.has(a.rec.aishe_code) ? 'code' : 'name, state and district'} with different values. First occurrence kept, second not imported.` });
      continue;
    }
    if (a.rec.aishe_code) seenCode.set(a.rec.aishe_code, a); seenKey.set(k3, a); unique.push(a);
  }

  // 6. compare with what is already stored, in one transaction. Conflicting values never overwrite: they become open conflicts for a person to resolve.
  const counts = { new: 0, unchanged: 0, filled: 0, conflicts: 0, near: 0 }; const conflictFields: Record<string, number> = {}; const stateCounts: Record<string, number> = {};
  let batchId = 0;
  try {
    db.transaction(() => {
      batchId = record('completed', {}, {}, format);                                   // placeholder, updated below
      const byCode = new Map<string, any>(), byKey = new Map<string, any>(), byName = new Map<string, any[]>();
      for (const e of db.prepare('SELECT * FROM public_institutions').all() as any[]) { if (e.aishe_code) byCode.set(e.aishe_code, e); byKey.set(`${e.match_key}|${e.state}|${e.district ?? ''}`, e); (byName.get(`${e.match_key}|${e.state}`) ?? byName.set(`${e.match_key}|${e.state}`, []).get(`${e.match_key}|${e.state}`)!).push(e); }
      const now = clock.iso();
      for (const { row, rec } of unique) {
        const ex = (rec.aishe_code && byCode.get(rec.aishe_code)) || byKey.get(`${rec.match_key}|${rec.state}|${rec.district ?? ''}`);
        if (ex) {
          let changedThis = false, conflictThis = false;
          for (const f of COMPARE) {
            const inc = rec[f], cur = ex[f];
            if (inc == null || inc === '') continue;
            if (cur == null || cur === '') { db.prepare(`UPDATE public_institutions SET ${f}=?, updated_at=? WHERE id=?`).run(inc, now, ex.id); db.prepare(`INSERT INTO public_institution_changes (institution_id,batch_id,field,old_value,new_value,change_kind,at) VALUES (?,?,?,?,?, 'filled_blank', ?)`).run(ex.id, batchId, f, null, String(inc), now); ex[f] = inc; changedThis = true; }
            else if (!same(f, cur, inc)) { db.prepare(`INSERT INTO import_conflicts (institution_id,batch_id,row_number,field,existing_value,incoming_value,created_at) VALUES (?,?,?,?,?,?,?)`).run(ex.id, batchId, row, f, String(cur), String(inc), now); bump(conflictFields, f); counts.conflicts++; conflictThis = true; }
          }
          if (!ex.aishe_code && rec.aishe_code) { db.prepare('UPDATE public_institutions SET aishe_code=?, updated_at=? WHERE id=?').run(rec.aishe_code, now, ex.id); db.prepare(`INSERT INTO public_institution_changes (institution_id,batch_id,field,old_value,new_value,change_kind,at) VALUES (?,?,?,?,?, 'filled_blank', ?)`).run(ex.id, batchId, 'aishe_code', null, rec.aishe_code, now); byCode.set(rec.aishe_code, ex); changedThis = true; }
          db.prepare('UPDATE public_institutions SET last_batch_id=? WHERE id=?').run(batchId, ex.id);
          if (changedThis) counts.filled++; else if (!conflictThis) counts.unchanged++;
          continue;
        }
        const near = (byName.get(`${rec.match_key}|${rec.state}`) ?? []).filter(e => (e.district ?? '') !== (rec.district ?? ''));
        if (near.length) { counts.near++; dups.push({ kind: 'possible_near_duplicate', key: `${rec.match_key}|${rec.state}`, rows: [row], detail: `Same name and state as an existing record in a different district (${near.map(n => n.district ?? 'unknown').join(', ')}). Imported as a separate record; review whether they are the same institution.` }); }
        const id = Number(db.prepare(`INSERT INTO public_institutions (aishe_code,name,match_key,state,district,institution_type,management,year_of_establishment,location,university_name,university_type,source_id,first_batch_id,last_batch_id,academic_year,created_at,updated_at)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(rec.aishe_code, rec.name, rec.match_key, rec.state, rec.district, rec.institution_type, rec.management, rec.year_of_establishment, rec.location, rec.university_name, rec.university_type, src.id, batchId, batchId, o.academicYear, now, now).lastInsertRowid);
        const fresh = { id, ...rec }; if (rec.aishe_code) byCode.set(rec.aishe_code, fresh); byKey.set(`${rec.match_key}|${rec.state}|${rec.district ?? ''}`, fresh); (byName.get(`${rec.match_key}|${rec.state}`) ?? byName.set(`${rec.match_key}|${rec.state}`, []).get(`${rec.match_key}|${rec.state}`)!).push(fresh);
        counts.new++; bump(stateCounts, rec.state);
      }
      if (o.dryRun) throw new Rollback();
    })();
  } catch (e) { if (!(e instanceof Rollback)) throw e; batchId = 0; }

  const n = accepted.length || 1;
  const missingPct = Object.fromEntries(FIELDS.map(f => [f, { count: missingCount[f], pct: Math.round((missingCount[f] / n) * 1000) / 10 }]));
  const rowsDup = dups.filter(d => d.kind !== 'possible_near_duplicate').length;
  const completeness = Math.round((1 - FIELDS.reduce((s, f) => s + missingCount[f], 0) / (n * FIELDS.length)) * 1000) / 10;
  const status = counts.new + counts.unchanged + counts.filled + counts.conflicts === 0 ? 'rejected' : rejects.length || counts.conflicts || rowsDup || Object.keys(warnings).length || counts.near ? 'completed_with_warnings' : 'completed';
  const report = {
    status, dry_run: !!o.dryRun, source: src.code, academic_year: o.academicYear, retrieved_on: o.retrievedOn, file: o.fileName, sha256: sha, format,
    rows_read: rows.length, accepted: accepted.length,
    imported: { new: counts.new, filled_blank: counts.filled, unchanged: counts.unchanged, with_conflicts: counts.conflicts ? 'see conflicts' : 0 },
    rejected: { count: rejects.length, by_reason: rejectsBy, sample: rejects.slice(0, 10).map(r => ({ row: r.row, reason: r.reason })) },
    duplicates: { in_file_identical: dups.filter(d => d.kind === 'in_file_identical').length, in_file_conflicting: dups.filter(d => d.kind === 'in_file_conflicting').length, possible_near: counts.near, sample: dups.slice(0, 10) },
    conflicts: { opened: counts.conflicts, by_field: conflictFields, note: 'Existing values were kept. Each conflict waits for a person to choose.' },
    missing_fields: missingPct, columns: { mapped: map, unmapped_columns: unmapped, fields_without_a_column: missing_fields }, warnings, completeness_pct: completeness,
    top_states_new: Object.entries(stateCounts).sort((a, b) => b[1] - a[1]).slice(0, 10),
    limits: ['Records come from the file you supplied; the app cannot verify that the file matches the publisher\'s current data.', 'Inclusion in an AISHE list does not mean AICTE approval.', 'Matching is by AISHE code, then by normalised name, state and district. Anything less certain is reported, not merged.'],
  };
  if (o.dryRun) return { batchId: null, status, dry_run: true, report };

  let fileRef: string | null = null;
  fs.mkdirSync(path.join(config.storageDir, 'imports'), { recursive: true });
  fileRef = `imports/${sha}${path.extname(o.fileName).toLowerCase()}`; fs.writeFileSync(path.join(config.storageDir, fileRef), o.buffer, { mode: 0o600 });
  db.transaction(() => {
    db.prepare(`UPDATE import_batches SET status=?, file_ref=?, rows_read=?, rows_new=?, rows_unchanged=?, rows_filled=?, rows_rejected=?, rows_duplicate=?, conflicts_opened=?, possible_duplicates=?, report=?, finished_at=? WHERE id=?`)
      .run(status, fileRef, rows.length, counts.new, counts.unchanged, counts.filled, rejects.length, rowsDup, counts.conflicts, counts.near, JSON.stringify(report), clock.iso(), batchId);
    for (const r of rejects) db.prepare('INSERT INTO import_rejects (batch_id,row_number,reason,raw) VALUES (?,?,?,?)').run(batchId, r.row, r.reason, JSON.stringify(r.raw).slice(0, 2000));
    for (const d of dups) db.prepare('INSERT INTO import_duplicates (batch_id,kind,key,row_numbers,detail) VALUES (?,?,?,?,?)').run(batchId, d.kind, d.key.slice(0, 200), JSON.stringify(d.rows), d.detail);
    if (status !== 'rejected') db.prepare(`UPDATE data_sources SET access_status='downloaded_and_imported', access_checked_on=?, access_note=COALESCE(access_note,'') || ? WHERE id=?`).run(clock.today(), ` Imported batch #${batchId} on ${clock.today()}.`, src.id);
    audit(db, { actor: user ? actorOf(user) : { id: null, label: 'cli' }, type: 'import.batch', entity: 'import_batch', entityId: batchId, next: { source: src.code, year: o.academicYear, status, read: rows.length, new: counts.new, rejected: rejects.length, conflicts: counts.conflicts } });
  })();
  return { batchId, status, dry_run: false, report };
}

export function resolveConflict(db: DB, user: User, id: number, decision: 'keep_existing' | 'use_incoming', note: string) {
  const c = db.prepare('SELECT * FROM import_conflicts WHERE id=?').get(id) as any;
  if (!c) throw notFound('Conflict not found');
  if (c.status !== 'open') throw new ApiError(409, 'CONFLICT', `This conflict was already resolved (${c.status.replace('_', ' ')})`);
  db.transaction(() => {
    const now = clock.iso();
    if (decision === 'use_incoming') {
      const v = c.field === 'year_of_establishment' ? Number(c.incoming_value) : c.incoming_value;
      db.prepare(`UPDATE public_institutions SET ${c.field}=?, ${c.field === 'name' ? 'match_key=?,' : ''} updated_at=? WHERE id=?`).run(...(c.field === 'name' ? [v, matchKey(String(v)), now, c.institution_id] : [v, now, c.institution_id]));
      db.prepare(`INSERT INTO public_institution_changes (institution_id,batch_id,field,old_value,new_value,change_kind,at) VALUES (?,?,?,?,?, 'conflict_resolved_use_incoming', ?)`).run(c.institution_id, c.batch_id, c.field, c.existing_value, c.incoming_value, now);
    }
    db.prepare(`UPDATE import_conflicts SET status=?, resolved_by=?, resolved_at=?, note=? WHERE id=?`).run(decision === 'use_incoming' ? 'used_incoming' : 'kept_existing', user.id, now, note, id);
    audit(db, { actor: actorOf(user), type: 'import.conflict_resolved', entity: 'public_institution', entityId: c.institution_id, prev: { [c.field]: c.existing_value }, next: { [c.field]: decision === 'use_incoming' ? c.incoming_value : c.existing_value, decision }, reason: note });
  })();
}
