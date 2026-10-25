import type { DB } from './db';
import { audit, actorOf, SYSTEM } from './audit';
import { clock } from './clock';
import type { User } from './auth';
import { ApiError } from './util';

// ----------------------------------------------------------------------------------------------------------------------
// Registry of public data sources and handbook versions. "access_status" records what was ACTUALLY done when this was written
// (checked 2026-10-23). Nothing here claims a dataset was imported: that status is only set by a real import run.
// ----------------------------------------------------------------------------------------------------------------------
const CHECKED = '2026-10-23';

type Source = { code: string; name: string; publisher: string; url: string; kind: string; licence: string | null; licence_note: string; dataset_date: string | null; field_definitions_ref: string | null; access_status: string; access_note: string; usable_for_import: number };
export const DATA_SOURCES: Source[] = [
  { code: 'AISHE-DIRECTORY', name: 'AISHE Institutional Directory (Universities, Colleges, Standalone Institutions)', publisher: 'Department of Higher Education, Ministry of Education (AISHE)', url: 'https://dashboard.aishe.gov.in/hedirectory/#/hedirectory', kind: 'institution_directory',
    licence: null, licence_note: 'No licence statement was visible on the AISHE pages that were read. Record the licence here after confirming it with the publisher or on the dataset page; imports are blocked until then.', dataset_date: null,
    field_definitions_ref: 'https://aishe.gov.in/document/aishe-meta-data-2/ (AISHE Meta Data PDF dated 05/01/2026; the PDF itself could not be opened from here)',
    access_status: 'requires_manual_download', access_note: 'The directory is an interactive web app. aishe.gov.in/documents was reachable on ' + CHECKED + ' but no file was downloaded. Export the directory (or use a published copy) and upload it on the Public data page.', usable_for_import: 1 },
  { code: 'AIKOSH-AISHE-COLLEGES', name: 'All Colleges as per AISHE Dashboard (republished dataset)', publisher: 'AIKosh (IndiaAI), republishing the AISHE Institutional Directory', url: 'https://aikosh.indiaai.gov.in/home/datasets/details/all_colleges_as_per_aishe_dashboard_3.html', kind: 'institution_directory',
    licence: null, licence_note: 'The licence field was empty in the page text that was read. A sibling AISHE-derived dataset on the same platform states "Open Government License, India", but that is not proof for this dataset. Confirm on the dataset page before recording it.', dataset_date: null,
    field_definitions_ref: 'Dataset page lists: AISHE Code, Name of the Institution, State, District, Year of Establishment, Location, College Type, Management, Affiliated University Name, Affiliated University Type.',
    access_status: 'requires_manual_download', access_note: 'Dataset page found through search on ' + CHECKED + '. The Excel file was not downloaded.', usable_for_import: 1 },
  { code: 'AIKOSH-AISHE-STANDALONE', name: 'All Standalone as per AISHE Dashboard (republished dataset)', publisher: 'AIKosh (IndiaAI), republishing the AISHE Institutional Directory', url: 'https://aikosh.indiaai.gov.in/home/datasets/details/all_standalone_as_per_aishe_dashboard.html', kind: 'institution_directory',
    licence: null, licence_note: 'Licence not visible in the text that was read. Confirm on the dataset page.', dataset_date: null,
    field_definitions_ref: 'Dataset page lists: AISHE Code, Name of the Institution, State, District, Year of Establishment, Location, Standalone Type, Management.',
    access_status: 'requires_manual_download', access_note: 'Dataset page found through search on ' + CHECKED + '. Not downloaded.', usable_for_import: 1 },
  { code: 'AISHE-FINAL-REPORT-XLSX', name: 'AISHE Final Report 2021-22, 2022-23 and 2023-24 (Excel)', publisher: 'Department of Higher Education, Ministry of Education', url: 'https://he.nic.in/aishereport/#/report/2023-24', kind: 'report_excel',
    licence: null, licence_note: 'Not checked.', dataset_date: '2026-07-09', field_definitions_ref: 'AISHE Meta Data PDF (see AISHE-DIRECTORY).',
    access_status: 'not_attempted', access_note: 'Listed on aishe.gov.in/documents (latest 2023-24, posted 09/07/2026). The report viewer is a separate web app and was not opened. These are aggregate statistics, not an institution list, so the institution importer does not apply to them.', usable_for_import: 0 },
  { code: 'DATAGOV-AICTE-YEARWISE', name: 'Year-wise AICTE Approved Government Engineering Institutes (UG & PG), 2019-20 to 2021-22', publisher: 'Open Government Data Platform India (data.gov.in)', url: 'https://data.gov.in/resource/year-wise-aicte-approved-government-engineering-institutes-ug-pg-2019-20-2021-22', kind: 'open_data_catalogue',
    licence: null, licence_note: 'Not verified on the dataset page.', dataset_date: null, field_definitions_ref: 'Fields seen in the catalogue text: Sl. No., Academic Year, Number of Government Engineering Institutes, Approved Seats in Government Engineering Institutes.',
    access_status: 'reachable_not_downloaded', access_note: 'Found in search results on ' + CHECKED + '. Aggregate counts by year only, so it cannot populate an institution directory. No institution-level AICTE list was found on data.gov.in.', usable_for_import: 0 },
  { code: 'AICTE-APH-OFFICIAL', name: 'AICTE Approval Process Handbook 2024-25 to 2026-27 (official PDF)', publisher: 'AICTE', url: 'https://www.aicte.gov.in/sites/default/files/APH%20Final.pdf', kind: 'regulatory_document',
    licence: null, licence_note: 'Not applicable to the importer.', dataset_date: null, field_definitions_ref: null,
    access_status: 'blocked', access_note: 'Automated download was refused (bot detection) on ' + CHECKED + ' for both the www and non-www addresses. The text has not been read from the official file.', usable_for_import: 0 },
];

type HB = { code: string; title: string; kind: 'handbook' | 'addendum'; academic_years: string; issued_on: string | null; issued_note: string; url: string | null; status: 'current' | 'superseded' | 'unknown'; notes: string };
export const HANDBOOK_VERSIONS: HB[] = [
  { code: 'APH-2024-27', title: 'Approval Process Handbook 2024-25 to 2026-27', kind: 'handbook', academic_years: '2024-25 to 2026-27', issued_on: null, issued_note: 'Released late 2023 (a press release from December 2023 announces it).', url: 'https://www.aicte.gov.in/sites/default/files/APH%20Final.pdf', status: 'current',
    notes: 'The AICTE site lists this as the handbook for 2024-25 to 2026-27, so it covers the current 2026-27 cycle. The official file could not be opened, so its text has not been read.' },
  { code: 'APH-2025-26-ADDENDUM', title: 'Addendum/Corrigendum 2025-26 of APH 2024-27', kind: 'addendum', academic_years: '2025-26', issued_on: '2024-11-05', issued_note: 'AICTE site shows a draft for comments (11 Oct 2024), then the addendum and public notice (about 4-5 Nov 2024) and a revised public notice (11 Mar 2025).', url: null, status: 'superseded',
    notes: 'Scoped to the 2025-26 cycle by its title. Text not read.' },
  { code: 'APH-2026-27-ADDENDUM', title: 'Addendum/Corrigendum 2026-27 of APH 2024-27', kind: 'addendum', academic_years: '2026-27', issued_on: null, issued_note: 'Date not confirmed. A news report and 2026-27 approval letters (which carry a corrigendum section) refer to it; the 2026-27 public notice is dated 3 Dec 2025.', url: null, status: 'current',
    notes: 'Reported to change supernumerary seat limits and to require nil deficiency on self-disclosure. Only a news report was read, not the addendum text. It may amend rules taken from the base handbook.' },
  { code: 'APH-SUCCESSOR', title: 'Handbook for 2027-28 onwards', kind: 'handbook', academic_years: '2027-28 onwards', issued_on: null, issued_note: 'No evidence of a successor was found in the searches made on ' + CHECKED + '.', url: null, status: 'unknown',
    notes: 'The 2024-27 handbook ends with 2026-27. Check the AICTE website before relying on these rules for the 2027-28 cycle.' },
];

const BINDINGS: Record<string, string> = {
  'R-EVC-01': 'Category INT routes through scrutiny and EVC (workflow scrutiny_evc)', 'R-BLDG-01': 'Requirement INT: Building Plan', 'R-LAND-01': 'Requirements NEW and SITE: Land / Title Documents and Lease Deed',
  'R-EOA-01': 'Requirement EXT: Annual Self-Disclosure', 'R-LAND-02': 'Requirements EXT and INT: Lease Deed', 'R-DOC-01': 'Requirement NEW: Fire Safety Certificate',
};

export function ensurePublicDataRegistry(db: DB) {
  let changed = 0;
  db.transaction(() => {
    for (const s of DATA_SOURCES) changed += db.prepare(`INSERT OR IGNORE INTO data_sources (code,name,publisher,url,kind,licence,licence_note,dataset_date,field_definitions_ref,access_status,access_checked_on,access_note,usable_for_import,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(s.code, s.name, s.publisher, s.url, s.kind, s.licence, s.licence_note, s.dataset_date, s.field_definitions_ref, s.access_status, CHECKED, s.access_note, s.usable_for_import, clock.iso()).changes;
    for (const h of HANDBOOK_VERSIONS) changed += db.prepare(`INSERT OR IGNORE INTO handbook_versions (code,title,kind,academic_years,issued_on,issued_note,url,status,text_reviewed,checked_on,check_method,notes) VALUES (?,?,?,?,?,?,?,?,0,?,?,?)`)
      .run(h.code, h.title, h.kind, h.academic_years, h.issued_on, h.issued_note, h.url, h.status, CHECKED, 'Web search results and AICTE site listings. The official handbook PDF was not accessible.', h.notes).changes;
    const hb = (c: string) => (db.prepare('SELECT id FROM handbook_versions WHERE code=?').get(c) as any)?.id as number;
    // link rules to the version they were read from; bindings describe where a rule is used in the workflow configuration
    db.prepare(`UPDATE regulatory_rules SET handbook_version_id=? WHERE handbook_version_id IS NULL AND kind<>'configurable_assumption' AND code<>'R-NEWS-01' AND code<>'R-TIME-02'`).run(hb('APH-2024-27'));
    db.prepare(`UPDATE regulatory_rules SET handbook_version_id=? WHERE handbook_version_id IS NULL AND code IN ('R-NEWS-01')`).run(hb('APH-2026-27-ADDENDUM'));
    for (const [code, text] of Object.entries(BINDINGS)) changed += db.prepare(`UPDATE regulatory_rules SET workflow_binding=?, activation_status='demo_active' WHERE code=? AND workflow_binding IS NULL`).run(text, code).changes;
    if (changed) audit(db, { actor: SYSTEM, type: 'config.public_data_registry_loaded', entity: 'public_data', entityId: 'registry', next: { changes: changed } });
  })();
  return changed;
}

// ---------------------------------------------------------------------------------------------------------------- activation gate
export function activationCheck(db: DB, ruleId: number) {
  const r = db.prepare(`SELECT r.*, h.code AS hb_code, h.status AS hb_status, h.title AS hb_title FROM regulatory_rules r LEFT JOIN handbook_versions h ON h.id=r.handbook_version_id WHERE r.id=?`).get(ruleId) as any;
  if (!r) return null;
  const blockers: string[] = [];
  if (r.kind === 'configurable_assumption') blockers.push('This is a configurable demonstration assumption. It is set in configuration, not activated from regulatory text.');
  else {
    if (r.verification_status !== 'verified_official') blockers.push('The rule has not been checked against the official handbook text by an administrator.');
    if (!r.handbook_version_id) blockers.push('The rule is not linked to a handbook version.');
    else if (r.hb_status !== 'current') blockers.push(`The linked version (${r.hb_code}) is not marked current (${r.hb_status}).`);
    for (const a of db.prepare(`SELECT code, title FROM handbook_versions WHERE kind='addendum' AND status='current' AND text_reviewed=0`).all() as any[]) blockers.push(`Addendum "${a.title}" is current but its text has not been reviewed, so it may amend this rule.`);
    if (!r.workflow_binding) blockers.push('No workflow binding is defined: nothing in the workflow configuration would use this rule.');
  }
  return { rule: { id: r.id, code: r.code, title: r.title, verification_status: r.verification_status, activation_status: r.activation_status, workflow_binding: r.workflow_binding, handbook_version: r.hb_code }, can_activate: blockers.length === 0, blockers };
}

export function activateRule(db: DB, user: User, ruleId: number, action: 'activate' | 'suspend', note: string) {
  const check = activationCheck(db, ruleId);
  if (!check) throw new ApiError(404, 'NOT_FOUND', 'Rule not found');
  if (action === 'activate' && !check.can_activate) throw new ApiError(422, 'PRECONDITION_FAILED', 'This rule cannot be activated yet', check.blockers);
  const next = action === 'activate' ? 'active' : 'suspended';
  db.transaction(() => {
    db.prepare('UPDATE regulatory_rules SET activation_status=? WHERE id=?').run(next, ruleId);
    audit(db, { actor: actorOf(user), type: `regulatory.rule_${action === 'activate' ? 'activated' : 'suspended'}`, entity: 'regulatory_rule', entityId: check.rule.code, prev: { activation: check.rule.activation_status }, next: { activation: next }, reason: note });
  })();
  return next;
}
