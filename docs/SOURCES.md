# Sources and rules

Generated from `server/src/regulatory.ts`. The same content is browsable in the app under **Regulatory rules**.

## How to read this

- The official handbook PDF (`aicte.gov.in`, "APH Final") **refused automated download** while this was written. Nothing here has been checked against it.
- Rules marked *Read in a source excerpt* were read in excerpts of **copies** of the handbook or related documents. Statements are paraphrased. Page numbers are given only where an excerpt displayed one.
- *Unverified* items come from drafts, news or institution pages and must not be treated as rules. *Demonstration assumptions* are configurable values, not AICTE requirements.
- An administrator can record a review in the app. Until then `last_reviewed_on` stays empty.

## Sources

| Code | Title | Trust | Version | Retrieved | Note |
|---|---|---|---|---|---|
| APH-OFFICIAL | AICTE Approval Process Handbook 2024-25 to 2026-27 (official PDF "APH Final") ([link](https://aicte.gov.in/sites/default/files/APH%20Final.pdf)) | primary | APH 2024-25 to 2026-27 | **not retrieved** | Not retrieved: the site blocked automated download. Every rule below should be confirmed against this original. |
| APH-GOVCDN | APH 2024-25 to 2026-27, copy hosted on a government CDN (uploads/2025/03) ([link](https://cdnbbsr.s3waas.gov.in/s35938b4d054136e5d59ada6ec9c295d7a/uploads/2025/03/2025031399.pdf)) | secondary | APH 2024-25 to 2026-27 | 2026-10-23 | Read through search excerpts only; page numbers were not visible in the excerpts. |
| APH-UNIVCOPY | APH copy hosted by a university, file dated 23.12.2025 ([link](https://www.crescent.education/wp-content/uploads/2026/03/APH-Final-downloaded-on-23.12.2025.pdf)) | secondary | APH 2024-25 to 2026-27 (downloaded 23-12-2025) | 2026-10-23 | Excerpts only. |
| APH-FLIPBOOK | APH 2024-27 flipbook (pages labelled P:31 and P:32 by the host) ([link](https://fliphtml5.com/jpimb/zwqi/APH_2024-_27/31/)) | unofficial | APH 2024-27 | 2026-10-23 | Page labels are the flipbook's own and may differ from the printed handbook pages. |
| APH-DRAFT | Draft APH 2024-27 (public consultation draft, 86 pages) ([link](https://www.scribd.com/document/685434943/AICTE-APH-2024-25-Draft)) | unofficial | Draft, superseded by the final handbook | 2026-10-23 | A draft: wording and numbering may differ from the final handbook. |
| AICTE-GUIDELINES | AICTE (Grant of Approvals for the Technical Institutions) Guidelines, 2024-27 ([link](https://indiankanoon.org/doc/173919027/)) | secondary | Guidelines 2024-27 | 2026-10-23 |  |
| PIB-2023 | PIB press release on release of the APH 2024-27 ([link](https://www.pib.gov.in/PressReleaseIframePage.aspx?PRID=1983013)) | secondary | December 2023 | 2026-10-23 |  |
| PUBLIC-NOTICE-2026-27 | AICTE public notice for the 2026-27 approval process (copy hosted by a board website) ([link](https://bteup.ac.in/PDFFILES/NEWS_639005651817728160.pdf)) | secondary | Notice dated 3-12-2025 | 2026-10-23 | The scanned text was partly garbled by OCR. |
| NEWS-C360-2026 | Careers360 report on the 2026-27 handbook update ([link](https://news.careers360.com/aicte-approval-process-handbook-2026-27-update-engineering-college-business-school-management-foreign-student-seats-minor-diploma/amp)) | unofficial | 2026-27 update | 2026-10-23 |  |
| INSTITUTION-CHECKLIST | An institution's own web page reproducing portal document checklists ([link](https://www.theiihs.com/Info-to-aicte.html)) | unofficial | Undated | 2026-10-23 |  |

## Rules, facts and assumptions

| Code | Type | Status | Title | Source | Section | Page / location note |
|---|---|---|---|---|---|---|
| R-PROC-01 | process fact | Read in a source excerpt (confirm against the original) | Evaluation is by Scrutiny/Re-Scrutiny Committee, Expert Visit Committee and, where applicable, SAC/SHC | APH-UNIVCOPY | 1.8 (Scrutiny/Re-Scrutiny), 1.9 (Expert Visit Committee), 2.3.5 (EVC inspection) | Section headings seen in excerpts; page numbers not shown. |
| R-EOA-01 | regulatory rule | Read in a source excerpt (confirm against the original) | Extension of Approval rests on self-disclosure and nil deficiency | APH-GOVCDN | 2.5 Extension of Approval based on Self-Disclosure | Also visible on the flipbook page labelled P:31; printed page number not confirmed. |
| R-EOA-02 | regulatory rule | Needs review | Committees work from documents uploaded on the portal | APH-FLIPBOOK | 2.3 (clause letter and number to be confirmed) | P:31 (flipbook label). Clause number could not be confirmed from the excerpt. |
| R-EOA-03 | regulatory rule | Read in a source excerpt (confirm against the original) | Deficiencies noted by committees must be fulfilled before the next EoA | APH-GOVCDN | 2.5 Extension of Approval based on Self-Disclosure | The draft (page 29 of 86) carries a similar sentence; the final copy excerpt was used for this status. |
| R-EOA-04 | regulatory rule | Read in a source excerpt (confirm against the original) | False information or fraudulent documents attract legal action | APH-FLIPBOOK | 2.5 (clauses on false information and fraudulent documents) | P:31 (flipbook label). Clause letters could not be confirmed. |
| R-EOA-05 | process fact | Read in a source excerpt (confirm against the original) | Extension of Approval for up to three years for well-performing institutions | PIB-2023 | Press release summary of changes in APH 2024-27 | Press release, not the handbook text. |
| R-EVC-01 | regulatory rule | Read in a source excerpt (confirm against the original) | Scrutiny and EVC for any increase in intake or additional course | APH-UNIVCOPY | 2.6 Increase in Intake / Additional Course(s) | Same sentence appears on the flipbook page labelled P:32. Printed page not confirmed. |
| R-EVC-02 | regulatory rule | Read in a source excerpt (confirm against the original) | EVC timing for new courses | APH-UNIVCOPY | 1.9 Process for Evaluation by the Expert Visit Committee (clause j) | Printed page not confirmed. |
| R-EVC-03 | process fact | Unverified | EVC can see the scrutiny report (draft wording) | APH-DRAFT | Not confirmed | Draft pages 7 to 10 of 86. Draft text only. |
| R-EVC-04 | process fact | Unverified | Regulation Bureau certifies completeness of committee reports (draft wording) | APH-DRAFT | Not confirmed | Draft page 29 of 86. Draft text only. |
| R-TIME-01 | process fact | Read in a source excerpt (confirm against the original) | Application windows are set by public notice, or are year-round | APH-GOVCDN | Application timeline table in Chapter II (table number not confirmed) | Table rows seen in an excerpt; the same table appears in the university-hosted copy. |
| R-TIME-02 | process fact | Needs review | 2026-27 applications open on the portal from 28 November 2025 | PUBLIC-NOTICE-2026-27 | Public notice for approval process 2026-27 | OCR text partly garbled; confirm the date and the statement that partial approval is not permitted against the original notice. |
| R-LAND-01 | regulatory rule | Read in a source excerpt (confirm against the original) | Land: clear title or a long-term lease of at least 30 years | AICTE-GUIDELINES | Clause 4, Generic Conditions for Approval (item b) | Legal text on Indian Kanoon; no page numbers. |
| R-LAND-02 | regulatory rule | Needs review | Live lease for the longest course duration (existing institutions) | APH-GOVCDN | Land requirement text (clause not confirmed) | The excerpt was cut off mid-sentence; read the full clause before relying on it. |
| R-BLDG-01 | regulatory rule | Read in a source excerpt (confirm against the original) | Building plan by a registered architect or licensed surveyor | APH-FLIPBOOK | 2.6 Increase in Intake / Additional Course(s) | P:32 (flipbook label). Draft numbering for this clause is 2.14, draft page 11 and 30 of 86. |
| R-CAT-01 | process fact | Read in a source excerpt (confirm against the original) | Application categories listed in the handbook | APH-UNIVCOPY | 2.5 EoA; 2.6 Increase in Intake/Additional Courses; 2.17 Change of Site/Location; 2.18 Change in name of course, merger, reduction in intake, closure of programme; 2.19 Change in name of institution or affiliating body; 2.20 Change in name/address of trust, society or company; 2.21 Closure of institution | Section numbers read from the contents-style excerpt. This is not an exhaustive list of every category in the handbook. |
| R-DOC-01 | process fact | Unverified | Fire safety certificate on portal checklists | INSTITUTION-CHECKLIST | Not confirmed | Seen on an institution's own page listing a portal checklist, not on an AICTE document. |
| R-DOC-02 | process fact | Unverified | Stability certificate for buildings over 30 years old | INSTITUTION-CHECKLIST | Not confirmed | Institution page only. |
| R-DOC-03 | process fact | Unverified | Copy of a private lease and encumbrance certificate | INSTITUTION-CHECKLIST | Not confirmed | Institution page only. The 30-year minimum is separately read in R-LAND-01. |
| R-NEWS-01 | process fact | Unverified | Reported 2026-27 changes (nil deficiency on self-disclosure, new seat slabs) | NEWS-C360-2026 | Not applicable (news article) | News report; confirm against the 2026-27 handbook update before use. |
| A-DL-01 | configurable assumption | Demonstration assumption | Stage deadlines used in the demonstration | none | Workflow stages |  |
| A-REM-01 | configurable assumption | Demonstration assumption | Reminder intervals | none | Settings |  |
| A-ESC-01 | configurable assumption | Demonstration assumption | Escalation delays and recipients | none | Escalation rules |  |
| A-WF-01 | configurable assumption | Demonstration assumption | Which stages each category passes through | none | Application categories |  |
| A-DOC-01 | configurable assumption | Demonstration assumption | Document requirements without a verified source | none | Document requirements |  |


## Public data sources (for the import pipeline)

Seeded by `server/src/publicdata.ts`. "Access" records what was actually done; nothing is marked as imported until a real import runs.

| Code | Name | Access (checked 2026-10-23) | Licence | Note |
|---|---|---|---|---|
| AISHE-DIRECTORY | AISHE Institutional Directory (Universities, Colleges, Standalone Institutions) | requires manual download | **not recorded** | The directory is an interactive web app. aishe.gov.in/documents was reachable on 2026-10-23 but no file was downloaded. Export the directory (or use a published copy) and upload it on the Public data page. |
| AIKOSH-AISHE-COLLEGES | All Colleges as per AISHE Dashboard (republished dataset) | requires manual download | **not recorded** | Dataset page found through search on 2026-10-23. The Excel file was not downloaded. |
| AIKOSH-AISHE-STANDALONE | All Standalone as per AISHE Dashboard (republished dataset) | requires manual download | **not recorded** | Dataset page found through search on 2026-10-23. Not downloaded. |
| AISHE-FINAL-REPORT-XLSX | AISHE Final Report 2021-22, 2022-23 and 2023-24 (Excel) | not attempted | **not recorded** | Listed on aishe.gov.in/documents (latest 2023-24, posted 09/07/2026). The report viewer is a separate web app and was not opened. These are aggregate statistics, not an institution list, so the institution importer does not apply to them. |
| DATAGOV-AICTE-YEARWISE | Year-wise AICTE Approved Government Engineering Institutes (UG & PG), 2019-20 to 2021-22 | reachable not downloaded | **not recorded** | Found in search results on 2026-10-23. Aggregate counts by year only, so it cannot populate an institution directory. No institution-level AICTE list was found on data.gov.in. |
| AICTE-APH-OFFICIAL | AICTE Approval Process Handbook 2024-25 to 2026-27 (official PDF) | blocked | **not recorded** | Automated download was refused (bot detection) on 2026-10-23 for both the www and non-www addresses. The text has not been read from the official file. |

## Handbook versions and amendments

| Code | Kind | Covers | Status | Text reviewed | Notes |
|---|---|---|---|---|---|
| APH-2024-27 | handbook | 2024-25 to 2026-27 | current | no | Released late 2023 (a press release from December 2023 announces it). The AICTE site lists this as the handbook for 2024-25 to 2026-27, so it covers the current 2026-27 cycle. The official file could not be opened, so its text has not been read. |
| APH-2025-26-ADDENDUM | addendum | 2025-26 | superseded | no | AICTE site shows a draft for comments (11 Oct 2024), then the addendum and public notice (about 4-5 Nov 2024) and a revised public notice (11 Mar 2025). Scoped to the 2025-26 cycle by its title. Text not read. |
| APH-2026-27-ADDENDUM | addendum | 2026-27 | current | no | Date not confirmed. A news report and 2026-27 approval letters (which carry a corrigendum section) refer to it; the 2026-27 public notice is dated 3 Dec 2025. Reported to change supernumerary seat limits and to require nil deficiency on self-disclosure. Only a news report was read, not the addendum text. It may amend rules taken from the base handbook. |
| APH-SUCCESSOR | handbook | 2027-28 onwards | unknown | no | No evidence of a successor was found in the searches made on 2026-10-23. The 2024-27 handbook ends with 2026-27. Check the AICTE website before relying on these rules for the 2027-28 cycle. |
## Totals

- Read in a source excerpt (confirm against the original): 11
- Needs review: 3
- Unverified: 6
- Demonstration assumption: 5
