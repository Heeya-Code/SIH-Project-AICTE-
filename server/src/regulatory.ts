import type { DB } from './db';
import { audit, SYSTEM } from './audit';
import { clock } from './clock';

// ----------------------------------------------------------------------------------------------------------------------
// What is and is not verified here
//
// The official handbook PDF (aicte.gov.in, "APH Final.pdf") refused automated download while this layer was written.
// Rules below were read from excerpts of COPIES of the handbook and related documents (listed as sources, with their trust level).
//   verified_excerpt : the statement was read in an excerpt of the named source. It still has to be confirmed against the original by an administrator.
//   needs_review     : read, but the excerpt was truncated, OCR-garbled, or the clause number could not be confirmed.
//   unverified       : from a draft, a news article or an institution's own page. Not to be treated as a rule.
//   assumption       : a configurable demonstration value. Not an AICTE requirement.
// Statements are paraphrased. Page numbers are given only where an excerpt showed one; otherwise page_ref is empty and page_note says so.
// ----------------------------------------------------------------------------------------------------------------------

const RETRIEVED = '2026-10-23';

type Src = { code: string; title: string; publisher?: string; url?: string; version_label?: string; source_kind: string; trust: string; retrieved_on?: string | null; access_note?: string };
export const SOURCES: Src[] = [
  { code: 'APH-OFFICIAL', title: 'AICTE Approval Process Handbook 2024-25 to 2026-27 (official PDF "APH Final")', publisher: 'AICTE', url: 'https://aicte.gov.in/sites/default/files/APH Final.pdf', version_label: 'APH 2024-25 to 2026-27', source_kind: 'official_final', trust: 'primary', retrieved_on: null,
    access_note: 'Not retrieved: the site blocked automated download. Every rule below should be confirmed against this original.' },
  { code: 'APH-GOVCDN', title: 'APH 2024-25 to 2026-27, copy hosted on a government CDN (uploads/2025/03)', publisher: 'Government-hosted copy', url: 'https://cdnbbsr.s3waas.gov.in/s35938b4d054136e5d59ada6ec9c295d7a/uploads/2025/03/2025031399.pdf', version_label: 'APH 2024-25 to 2026-27', source_kind: 'government_hosted_copy', trust: 'secondary', retrieved_on: RETRIEVED, access_note: 'Read through search excerpts only; page numbers were not visible in the excerpts.' },
  { code: 'APH-UNIVCOPY', title: 'APH copy hosted by a university, file dated 23.12.2025', publisher: 'University-hosted copy', url: 'https://www.crescent.education/wp-content/uploads/2026/03/APH-Final-downloaded-on-23.12.2025.pdf', version_label: 'APH 2024-25 to 2026-27 (downloaded 23-12-2025)', source_kind: 'third_party_copy', trust: 'secondary', retrieved_on: RETRIEVED, access_note: 'Excerpts only.' },
  { code: 'APH-FLIPBOOK', title: 'APH 2024-27 flipbook (pages labelled P:31 and P:32 by the host)', publisher: 'Third-party flipbook', url: 'https://fliphtml5.com/jpimb/zwqi/APH_2024-_27/31/', version_label: 'APH 2024-27', source_kind: 'third_party_copy', trust: 'unofficial', retrieved_on: RETRIEVED, access_note: 'Page labels are the flipbook\'s own and may differ from the printed handbook pages.' },
  { code: 'APH-DRAFT', title: 'Draft APH 2024-27 (public consultation draft, 86 pages)', publisher: 'Third-party copy of the draft', url: 'https://www.scribd.com/document/685434943/AICTE-APH-2024-25-Draft', version_label: 'Draft, superseded by the final handbook', source_kind: 'official_draft', trust: 'unofficial', retrieved_on: RETRIEVED, access_note: 'A draft: wording and numbering may differ from the final handbook.' },
  { code: 'AICTE-GUIDELINES', title: 'AICTE (Grant of Approvals for the Technical Institutions) Guidelines, 2024-27', publisher: 'Legal text as published on Indian Kanoon', url: 'https://indiankanoon.org/doc/173919027/', version_label: 'Guidelines 2024-27', source_kind: 'legal_text', trust: 'secondary', retrieved_on: RETRIEVED },
  { code: 'PIB-2023', title: 'PIB press release on release of the APH 2024-27', publisher: 'Press Information Bureau', url: 'https://www.pib.gov.in/PressReleaseIframePage.aspx?PRID=1983013', version_label: 'December 2023', source_kind: 'press_release', trust: 'secondary', retrieved_on: RETRIEVED },
  { code: 'PUBLIC-NOTICE-2026-27', title: 'AICTE public notice for the 2026-27 approval process (copy hosted by a board website)', publisher: 'Copy of an AICTE notice', url: 'https://bteup.ac.in/PDFFILES/NEWS_639005651817728160.pdf', version_label: 'Notice dated 3-12-2025', source_kind: 'official_notice', trust: 'secondary', retrieved_on: RETRIEVED, access_note: 'The scanned text was partly garbled by OCR.' },
  { code: 'NEWS-C360-2026', title: 'Careers360 report on the 2026-27 handbook update', publisher: 'Careers360', url: 'https://news.careers360.com/aicte-approval-process-handbook-2026-27-update-engineering-college-business-school-management-foreign-student-seats-minor-diploma/amp', version_label: '2026-27 update', source_kind: 'news', trust: 'unofficial', retrieved_on: RETRIEVED },
  { code: 'INSTITUTION-CHECKLIST', title: 'An institution\'s own web page reproducing portal document checklists', publisher: 'Institution website', url: 'https://www.theiihs.com/Info-to-aicte.html', version_label: 'Undated', source_kind: 'institution_page', trust: 'unofficial', retrieved_on: RETRIEVED },
];

type Rule = { code: string; kind: 'regulatory_rule' | 'process_fact' | 'configurable_assumption'; title: string; statement: string; category?: string; source?: string; section?: string; page?: string; page_note?: string; effective_note?: string; status: 'verified_excerpt' | 'needs_review' | 'unverified' | 'assumption' | 'outdated'; notes?: string };
const V = 'verified_excerpt' as const;
export const RULES: Rule[] = [
  // ---- process facts and rules read in excerpts
  { code: 'R-PROC-01', kind: 'process_fact', title: 'Evaluation is by Scrutiny/Re-Scrutiny Committee, Expert Visit Committee and, where applicable, SAC/SHC', status: V, source: 'APH-UNIVCOPY', section: '1.8 (Scrutiny/Re-Scrutiny), 1.9 (Expert Visit Committee), 2.3.5 (EVC inspection)', page_note: 'Section headings seen in excerpts; page numbers not shown.',
    statement: 'Applications are evaluated by a Scrutiny or Re-Scrutiny Committee and, where applicable, by an Expert Visit Committee that inspects the institution. The handbook\'s process tables also show SAC/SHC as a further stage.', effective_note: 'APH 2024-25 to 2026-27' },
  { code: 'R-EOA-01', kind: 'regulatory_rule', title: 'Extension of Approval rests on self-disclosure and nil deficiency', status: V, category: 'EXT', source: 'APH-GOVCDN', section: '2.5 Extension of Approval based on Self-Disclosure', page_note: 'Also visible on the flipbook page labelled P:31; printed page number not confirmed.',
    statement: 'Extension of Approval is granted on the institution\'s online self-disclosure of its facilities and infrastructure, and only where the portal\'s deficiency report shows nil deficiency.', effective_note: 'APH 2024-25 to 2026-27' },
  { code: 'R-EOA-02', kind: 'regulatory_rule', title: 'Committees work from documents uploaded on the portal', status: 'needs_review', category: 'EXT', source: 'APH-FLIPBOOK', section: '2.3 (clause letter and number to be confirmed)', page: 'P:31 (flipbook label)', page_note: 'Clause number could not be confirmed from the excerpt.',
    statement: 'Applications are processed by the Scrutiny or Re-Scrutiny Committee, and by the Expert Visit Committee where applicable, strictly on the basis of the documents uploaded on the AICTE portal.' },
  { code: 'R-EOA-03', kind: 'regulatory_rule', title: 'Deficiencies noted by committees must be fulfilled before the next EoA', status: V, category: 'EXT', source: 'APH-GOVCDN', section: '2.5 Extension of Approval based on Self-Disclosure', page_note: 'The draft (page 29 of 86) carries a similar sentence; the final copy excerpt was used for this status.',
    statement: 'Deficiencies noted by the Scrutiny, Re-Scrutiny or Expert Visit Committee have to be fulfilled and submitted before the Extension of Approval for the following academic year is issued.' },
  { code: 'R-EOA-04', kind: 'regulatory_rule', title: 'False information or fraudulent documents attract legal action', status: V, category: 'EXT', source: 'APH-FLIPBOOK', section: '2.5 (clauses on false information and fraudulent documents)', page: 'P:31 (flipbook label)', page_note: 'Clause letters could not be confirmed.',
    statement: 'AICTE may invoke civil or criminal provisions for false information, and a fraudulent document can lead to a criminal case against the institution\'s head and the trust, society or company officers. This is why document verification here is always a human decision.' },
  { code: 'R-EOA-05', kind: 'process_fact', title: 'Extension of Approval for up to three years for well-performing institutions', status: V, source: 'PIB-2023', section: 'Press release summary of changes in APH 2024-27', page_note: 'Press release, not the handbook text.',
    statement: 'The handbook for 2024-27 introduced a provision for extending approval for up to three years for well-performing institutions.', effective_note: 'APH 2024-25 to 2026-27' },
  { code: 'R-EVC-01', kind: 'regulatory_rule', title: 'Scrutiny and EVC for any increase in intake or additional course', status: V, category: 'INT', source: 'APH-UNIVCOPY', section: '2.6 Increase in Intake / Additional Course(s)', page_note: 'Same sentence appears on the flipbook page labelled P:32. Printed page not confirmed.',
    statement: 'A scrutiny and an Expert Visit Committee inspection are carried out for any increase in intake in existing courses and for new courses.', effective_note: 'APH 2024-25 to 2026-27' },
  { code: 'R-EVC-02', kind: 'regulatory_rule', title: 'EVC timing for new courses', status: V, source: 'APH-UNIVCOPY', section: '1.9 Process for Evaluation by the Expert Visit Committee (clause j)', page_note: 'Printed page not confirmed.',
    statement: 'An Expert Visit Committee visit can take place at any time before the first batch of students passes out, or during the course duration for newly approved courses, to verify that the handbook\'s norms are met.' },
  { code: 'R-EVC-03', kind: 'process_fact', title: 'EVC can see the scrutiny report (draft wording)', status: 'unverified', source: 'APH-DRAFT', section: 'Not confirmed', page: 'Draft pages 7 to 10 of 86', page_note: 'Draft text only.',
    statement: 'In the draft handbook the Expert Visit Committee has access to the report of the Scrutiny or Re-Scrutiny Committee.' },
  { code: 'R-EVC-04', kind: 'process_fact', title: 'Regulation Bureau certifies completeness of committee reports (draft wording)', status: 'unverified', source: 'APH-DRAFT', section: 'Not confirmed', page: 'Draft page 29 of 86', page_note: 'Draft text only.',
    statement: 'In the draft handbook the Regulation Bureau is to ensure and certify that every field of the scrutiny, re-scrutiny or EVC report is completed.' },
  { code: 'R-TIME-01', kind: 'process_fact', title: 'Application windows are set by public notice, or are year-round', status: V, source: 'APH-GOVCDN', section: 'Application timeline table in Chapter II (table number not confirmed)', page_note: 'Table rows seen in an excerpt; the same table appears in the university-hosted copy.',
    statement: 'For Extension of Approval based on self-disclosure and for increase in intake or additional courses, the application period is the one in the public notice. Change of site or location, closure of the institution and closure of a programme or course can be applied for year-round. The handbook text read here does not set fixed processing deadlines for committees.' },
  { code: 'R-TIME-02', kind: 'process_fact', title: '2026-27 applications open on the portal from 28 November 2025', status: 'needs_review', source: 'PUBLIC-NOTICE-2026-27', section: 'Public notice for approval process 2026-27', page_note: 'OCR text partly garbled; confirm the date and the statement that partial approval is not permitted against the original notice.',
    statement: 'The public notice for 2026-27 says online applications go live on the AICTE web portal from 28 November 2025, and that partial approval will not be permitted.' },
  { code: 'R-LAND-01', kind: 'regulatory_rule', title: 'Land: clear title or a long-term lease of at least 30 years', status: V, category: 'NEW', source: 'AICTE-GUIDELINES', section: 'Clause 4, Generic Conditions for Approval (item b)', page_note: 'Legal text on Indian Kanoon; no page numbers.',
    statement: 'The land has to be in the name of the trust, society or company with a clear title, or held on a long-term lease for a minimum of 30 years.', effective_note: 'Guidelines 2024-27' },
  { code: 'R-LAND-02', kind: 'regulatory_rule', title: 'Live lease for the longest course duration (existing institutions)', status: 'needs_review', source: 'APH-GOVCDN', section: 'Land requirement text (clause not confirmed)', page_note: 'The excerpt was cut off mid-sentence; read the full clause before relying on it.',
    statement: 'For existing institutions the live lease has to cover at least the duration of the longest course, and an extension of the lease for a further 30 years is mentioned in the same passage. The exact condition could not be read from the truncated excerpt.' },
  { code: 'R-BLDG-01', kind: 'regulatory_rule', title: 'Building plan by a registered architect or licensed surveyor', status: V, category: 'INT', source: 'APH-FLIPBOOK', section: '2.6 Increase in Intake / Additional Course(s)', page: 'P:32 (flipbook label)', page_note: 'Draft numbering for this clause is 2.14, draft page 11 and 30 of 86.',
    statement: 'The building plan for the whole duration of an increase in intake or additional course has to be prepared by an architect registered with the Council of Architecture, or by a licensed surveyor.' },
  { code: 'R-CAT-01', kind: 'process_fact', title: 'Application categories listed in the handbook', status: V, source: 'APH-UNIVCOPY', section: '2.5 EoA; 2.6 Increase in Intake/Additional Courses; 2.17 Change of Site/Location; 2.18 Change in name of course, merger, reduction in intake, closure of programme; 2.19 Change in name of institution or affiliating body; 2.20 Change in name/address of trust, society or company; 2.21 Closure of institution',
    page_note: 'Section numbers read from the contents-style excerpt. This is not an exhaustive list of every category in the handbook.',
    statement: 'The handbook sets out separate processes for, among others: Extension of Approval, increase in intake or additional courses, change of site or location, change in a course name or merger or reduction of intake or closure of a programme, change in the name of the institution or its affiliating body, change in the name or address of the trust, society or company, and closure of the institution.' },
  // ---- document checklist items: not confirmed against the handbook
  { code: 'R-DOC-01', kind: 'process_fact', title: 'Fire safety certificate on portal checklists', status: 'unverified', source: 'INSTITUTION-CHECKLIST', section: 'Not confirmed', page_note: 'Seen on an institution\'s own page listing a portal checklist, not on an AICTE document.',
    statement: 'An institution\'s page lists a fire and safety certificate issued by the competent authority (or proof of application) among documents it attached to its AICTE application.' },
  { code: 'R-DOC-02', kind: 'process_fact', title: 'Stability certificate for buildings over 30 years old', status: 'unverified', source: 'INSTITUTION-CHECKLIST', section: 'Not confirmed', page_note: 'Institution page only.',
    statement: 'The same institution page lists a stability certificate from the competent authority for buildings more than 30 years old.' },
  { code: 'R-DOC-03', kind: 'process_fact', title: 'Copy of a private lease and encumbrance certificate', status: 'unverified', source: 'INSTITUTION-CHECKLIST', section: 'Not confirmed', page_note: 'Institution page only. The 30-year minimum is separately read in R-LAND-01.',
    statement: 'The institution page lists a copy of a private lease of at least 30 years and an encumbrance certificate for the property as checklist items where a private lease applies.' },
  { code: 'R-NEWS-01', kind: 'process_fact', title: 'Reported 2026-27 changes (nil deficiency on self-disclosure, new seat slabs)', status: 'unverified', source: 'NEWS-C360-2026', section: 'Not applicable (news article)', page_note: 'News report; confirm against the 2026-27 handbook update before use.',
    statement: 'A news report says the 2026-27 update requires approved institutions to have nil deficiency on self-disclosure and changes the supernumerary seat limits by discipline and level.' },
  // ---- configurable demonstration assumptions
  { code: 'A-DL-01', kind: 'configurable_assumption', title: 'Stage deadlines used in the demonstration', status: 'assumption', section: 'Workflow stages', statement: 'Scrutiny 10 working days, clarification 7 days, EVC 30 days (scheduling within 10), SAC/SHC 15 days, decision 10 days. These are sample values for the demonstration. The handbook text read here sets no such deadlines; administrators must replace them from the applicable handbook or office orders.' },
  { code: 'A-REM-01', kind: 'configurable_assumption', title: 'Reminder intervals', status: 'assumption', section: 'Settings', statement: 'Reminders 7 and 1 days before deadlines, and 30, 7 and 1 days before document expiry, are sample values.' },
  { code: 'A-ESC-01', kind: 'configurable_assumption', title: 'Escalation delays and recipients', status: 'assumption', section: 'Escalation rules', statement: 'The delays and the escalation chain are demonstration policies, not AICTE procedure.' },
  { code: 'A-WF-01', kind: 'configurable_assumption', title: 'Which stages each category passes through', status: 'assumption', section: 'Application categories', statement: 'Except where a verified rule says otherwise (increase in intake needs scrutiny and EVC), the stage route for each category is an illustrative configuration taken from the problem statement\'s examples.' },
  { code: 'A-DOC-01', kind: 'configurable_assumption', title: 'Document requirements without a verified source', status: 'assumption', section: 'Document requirements', statement: 'Requirements not linked to a verified rule (for example trust or society registration, faculty list, infrastructure statement, closure declaration) are placeholders for the demonstration.' },
];

const NEW_CATEGORIES: { code: string; name: string; workflow: string; apph: string; rule?: string; route_basis: string; route_rule?: string }[] = [
  { code: 'SITE', name: 'Change of site or location (demo route)', workflow: 'evc_sac', apph: '2.17 Change of Site/Location', rule: 'R-CAT-01', route_basis: 'assumption' },
  { code: 'CLOSE', name: 'Closure of institution (demo route)', workflow: 'scrutiny_only', apph: '2.21 Closure of Institution', rule: 'R-CAT-01', route_basis: 'assumption' },
  { code: 'NAME', name: 'Change in name of institution (demo route)', workflow: 'scrutiny_only', apph: '2.19 Change in Name of the Institution', rule: 'R-CAT-01', route_basis: 'assumption' },
];
const CATEGORY_LINKS: Record<string, { apph: string; rule?: string; route_basis: string; route_rule?: string }> = {
  NEW: { apph: 'New institution (chapter I; clause not confirmed)', route_basis: 'assumption' },
  EXT: { apph: '2.5 Extension of Approval based on Self-Disclosure', rule: 'R-EOA-01', route_basis: 'assumption' },
  INT: { apph: '2.6 Increase in Intake / Additional Course(s)', rule: 'R-EVC-01', route_basis: 'verified_excerpt', route_rule: 'R-EVC-01' },
  ADD: { apph: '2.6 (demo-only EVC-only variant of an additional course)', rule: 'R-CAT-01', route_basis: 'assumption' },
};
// [category, doc_type, required, has_expiry, basis, rule]
const REQUIREMENTS: [string, string, number, number, string, string | null][] = [
  ['NEW', 'Land / Title Documents', 1, 0, 'verified_excerpt', 'R-LAND-01'], ['NEW', 'Lease Deed', 1, 1, 'verified_excerpt', 'R-LAND-01'], ['NEW', 'Fire Safety Certificate', 1, 1, 'unverified', 'R-DOC-01'], ['NEW', 'Trust / Society Registration', 1, 0, 'assumption', 'A-DOC-01'],
  ['EXT', 'Lease Deed', 1, 1, 'needs_review', 'R-LAND-02'], ['EXT', 'Annual Self-Disclosure', 1, 0, 'verified_excerpt', 'R-EOA-01'],
  ['INT', 'Infrastructure Statement', 1, 0, 'assumption', 'A-DOC-01'], ['INT', 'Lease Deed', 1, 1, 'needs_review', 'R-LAND-02'], ['INT', 'Building Plan', 1, 0, 'verified_excerpt', 'R-BLDG-01'],
  ['ADD', 'Infrastructure Statement', 1, 0, 'assumption', 'A-DOC-01'], ['ADD', 'Faculty List', 1, 0, 'assumption', 'A-DOC-01'],
  ['SITE', 'Land / Title Documents', 1, 0, 'verified_excerpt', 'R-LAND-01'], ['SITE', 'Lease Deed', 1, 1, 'verified_excerpt', 'R-LAND-01'], ['SITE', 'Building Plan', 1, 0, 'assumption', 'A-DOC-01'],
  ['CLOSE', 'Closure Declaration', 1, 0, 'assumption', 'A-DOC-01'], ['NAME', 'Trust / Society Registration', 1, 0, 'assumption', 'A-DOC-01'],
];

// Idempotent: safe to call on every start. Inserts what is missing and links what is still unlinked; it never overwrites an administrator's review.
export function ensureRegulatoryData(db: DB) {
  let changed = 0;
  db.transaction(() => {
    const id = (sql: string, ...p: any[]) => (db.prepare(sql).get(...p) as any)?.id as number | undefined;
    for (const s of SOURCES) {
      const r = db.prepare(`INSERT OR IGNORE INTO regulatory_sources (code,title,publisher,url,version_label,source_kind,trust,retrieved_on,access_note) VALUES (?,?,?,?,?,?,?,?,?)`)
        .run(s.code, s.title, s.publisher ?? null, s.url ?? null, s.version_label ?? null, s.source_kind, s.trust, s.retrieved_on ?? null, s.access_note ?? null); changed += r.changes;
    }
    for (const c of NEW_CATEGORIES) {
      const wf = id('SELECT id FROM workflows WHERE code=?', c.workflow); if (!wf) continue;
      changed += db.prepare('INSERT OR IGNORE INTO application_categories (code,name,workflow_id) VALUES (?,?,?)').run(c.code, c.name, wf).changes;
    }
    for (const rule of RULES) {
      const srcId = rule.source ? id('SELECT id FROM regulatory_sources WHERE code=?', rule.source) : null;
      const flagged = ['needs_review', 'unverified', 'outdated'].includes(rule.status) ? 1 : 0;
      const r = db.prepare(`INSERT OR IGNORE INTO regulatory_rules (code,kind,title,statement,category_code,source_id,section_ref,page_ref,page_note,effective_note,verification_status,flagged_for_review)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(rule.code, rule.kind, rule.title, rule.statement, rule.category ?? null, srcId ?? null, rule.section ?? null, rule.page ?? null, rule.page_note ?? null, rule.effective_note ?? null, rule.status, flagged);
      changed += r.changes;
      if (r.changes) {
        const rid = Number(r.lastInsertRowid);
        const cid = Number(db.prepare('INSERT INTO reference_chunks (rule_id,text) VALUES (?,?)').run(rid, `${rule.title}. ${rule.statement}`).lastInsertRowid);
        db.prepare('INSERT INTO reference_fts (chunk_id,text,title) VALUES (?,?,?)').run(cid, rule.statement, rule.title);
      }
    }
    const rid = (code?: string) => (code ? id('SELECT id FROM regulatory_rules WHERE code=?', code) ?? null : null);
    const links = { ...CATEGORY_LINKS, ...Object.fromEntries(NEW_CATEGORIES.map(c => [c.code, { apph: c.apph, rule: c.rule, route_basis: c.route_basis }])) } as typeof CATEGORY_LINKS;
    for (const [code, l] of Object.entries(links)) {
      changed += db.prepare('UPDATE application_categories SET apph_ref=?, rule_id=?, route_basis=?, route_rule_id=? WHERE code=? AND apph_ref IS NULL').run(l.apph, rid(l.rule), l.route_basis, rid(l.route_rule), code).changes;
    }
    // Increase in intake needs scrutiny AND EVC (R-EVC-01). Older databases routed it EVC then SAC/SHC; new submissions move to the supported route.
    const wfScrEvc = id('SELECT id FROM workflows WHERE code=?', 'scrutiny_evc'), wfEvcSac = id('SELECT id FROM workflows WHERE code=?', 'evc_sac');
    if (wfScrEvc && wfEvcSac) {
      const r = db.prepare(`UPDATE application_categories SET workflow_id=? WHERE code='INT' AND workflow_id=?`).run(wfScrEvc, wfEvcSac);
      if (r.changes) { changed++; audit(db, { actor: SYSTEM, type: 'config.category_route_changed', entity: 'category', entityId: 'INT', prev: { workflow: 'evc_sac' }, next: { workflow: 'scrutiny_evc' }, reason: 'Aligned with R-EVC-01 (scrutiny and EVC for increase in intake). Existing applications keep their workflow version.' }); }
    }
    for (const [cat, type, req, exp, basis, rule] of REQUIREMENTS) {
      changed += db.prepare('INSERT OR IGNORE INTO document_requirements (category_code,doc_type,required,has_expiry) VALUES (?,?,?,?)').run(cat, type, req, exp).changes;
      db.prepare(`UPDATE document_requirements SET basis=?, rule_id=? WHERE category_code=? AND doc_type=? AND rule_id IS NULL`).run(basis, rid(rule ?? undefined), cat, type);
    }
    for (const [k, v, d] of [['stall_days', '21', 'An in-progress case is flagged as stalled after this many days without leaving its stage (sample value)']]) changed += db.prepare('INSERT OR IGNORE INTO settings (key,value,description) VALUES (?,?,?)').run(k, v, d).changes;
    if (changed) audit(db, { actor: SYSTEM, type: 'config.regulatory_data_loaded', entity: 'regulatory', entityId: 'sources', next: { changes: changed, sources: SOURCES.length, rules: RULES.length } });
  })();
  return changed;
}

export function regulatorySummary(db: DB) {
  const c = (sql: string) => (db.prepare(sql).get() as any).c as number;
  return {
    sources: c('SELECT COUNT(*) c FROM regulatory_sources'), rules: c('SELECT COUNT(*) c FROM regulatory_rules'),
    verified_excerpt: c(`SELECT COUNT(*) c FROM regulatory_rules WHERE verification_status='verified_excerpt'`), needs_review: c(`SELECT COUNT(*) c FROM regulatory_rules WHERE flagged_for_review=1`),
    assumptions: c(`SELECT COUNT(*) c FROM regulatory_rules WHERE verification_status='assumption'`), reviewed_by_admin: c('SELECT COUNT(*) c FROM regulatory_rules WHERE last_reviewed_on IS NOT NULL'),
  };
}
void clock;
