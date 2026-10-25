# AICTE ApprovalFlow (demonstration prototype)

SIH 2026, PS4: approval workflow automation, compliance monitoring and alert management.
**All data is synthetic. This is not an AICTE system and is not connected to one.** Every deadline, reminder interval and
escalation delay is a sample value an administrator would replace from the applicable Approval Process Handbook.

## Run it

Requires Node 20+ (tested on 22).

```bash
npm run setup      # install server + web dependencies
npm run build      # build the React app into web/dist
npm start          # http://localhost:4000 (seeds synthetic data on first start)
```

Development with hot reload: `npm run dev:server` and `npm run dev:web` (web on http://localhost:5173, proxied to the API).

Reset the demo: **Administration, Jobs and demo tools, Reset demo data**, or `npm run reset`.

### Demo accounts (local synthetic environment only)

Password for every account: `Demo@1234`

| Role | Email |
|---|---|
| Institution representative | inst1@demo.local (inst2 ... inst10) |
| Regional officer | ro.nr@demo.local (also ro2.nr, ro.sr, ro2.sr, ro.wr, ro.er, ro.cr) |
| EVC coordinator | evc.nr@demo.local (evc.sr, evc.wr, evc.er, evc.cr) |
| Bureau officer | bureau@demo.local |
| Competent authority | authority@demo.local |
| Administrator | admin@demo.local |
| Institution user with a bouncing mailbox | inst10+bounce@demo.local (shows failed email delivery and retry) |

Change `DEMO_PASSWORD` or disable demo seeding for anything that is not a local demo.

## Tests

```bash
npm test           # server (vitest + supertest) and web (vitest + Testing Library)
npm run typecheck
```

Server tests: workflow engine, deadlines and reminders, EVC, compliance and documents, security, notifications.
Web tests: form validation, server-driven filtering/sorting/paging, loading and error states, dashboard values from the API.
Layout changes (fixed sidebar, hidden scrollbars, no horizontal overflow at 390px) were checked in headless Chrome by script, but there is no committed Playwright suite. Not covered: load testing.

## How the six PS4 workflows are demonstrated

1. **Application routing.** Sign in as `inst1`, create an application (Extension of approval), upload the two documents, submit.
   Sign in as `ro.nr`: it is assigned. Add an observation, then *Complete scrutiny*. Sign in as `authority`: approve with a reason.
   Approval creates the configured obligations. Try *Return for clarification* instead: a reason is mandatory, the institution responds, history keeps both submissions.
2. **EVC scheduling.** Create a *New institution* application, pass scrutiny. It joins the EVC queue (`evc.nr`). Use *Suggest slots*, schedule, try to double-book a committee (blocked),
   reschedule (reason required), then *Record visit*: the application advances to the decision stage automatically.
3. **Undertakings.** `ro.nr` records an obligation. `inst1` submits evidence. Upload alone does not verify it: `ro.nr` verifies or returns it with a note. Earlier submissions stay visible.
4. **Document expiry.** Documents page, filter *Within 30 days*. Renew a lease as the institution: a new version is created, the old one is kept, and the escalation (if any) closes.
5. **Reminders and escalation.** As `admin`: Administration, Jobs and demo tools. Set the simulated date a few days ahead, press *Run now*. Reminders, overdue notices and escalations appear;
   run it again and nothing is duplicated. Complete the task and its escalation is cancelled. Everything is in the Audit trail.
6. **Configurable workflows.** As `admin`: Workflow designer. Change a stage deadline or add a stage, *Validate*, *Simulate a path*, save as a new version.
   New applications use it; existing applications stay on their version.

## Data quality, regulatory grounding and intelligence

- **Synthetic data.** On an empty database the app seeds a small curated set plus **500 generated applications** (`SEED=2026`, `SEED_APPLICATIONS=500`; set the count to `0` to skip). The generator drives applications through the real workflow engine on a simulated clock, so histories, deadlines, notifications and audit entries are consistent. The same seed reproduces the same dataset; a run is recorded in `seed_runs` and is never repeated. Everything generated is flagged `synthetic=1` and institutions carry "(Demo)" in their names.
  `npm run generate -- --seed 7 --count 300` adds another dataset; `npm run validate` runs the integrity checks (foreign keys, statuses, dates, workflow transitions, document versions, obligations, EVC reports); admins can also call `/api/integrity`.
- **Regulatory sources and rules** (page *Regulatory rules*, `docs/SOURCES.md`). Rules carry source, section, page note, verification status and review history, and are kept apart from configurable demonstration assumptions. **The official handbook PDF could not be downloaded automatically**; rules were read in excerpts of copies and are paraphrased, so none is marked as checked against the original until an administrator records that.
- **Analytics** (page *Analytics*): status, category, region and stage counts, time per stage, bottleneck indicators with the data behind each score, officer workload and unassigned cases, expiring documents, EVC status, processing-time history, filters and drill-down into the underlying cases. Figures are labelled *Calculated*; the only estimate is labelled as an illustrative forecast.
- **Alerts** (page *Alerts*): published rules for deadlines, expiry, missing or returned documents, stalled cases, unassigned cases and escalation eligibility. Each alert lists the rule and the facts. Alerts never change a case.
- **Handbook assistant** (assistant panel, *AICTE handbook* tab): keyword retrieval over the indexed, paraphrased excerpts; returns source, section, page note and verification status, and says so when evidence is insufficient. It refuses to decide or predict approvals. It is not a language model.
- **Deficiencies** are raised when an application is returned; the institution's response is the corrective action; the reviewing officer's next action closes it. EVC visits now store a report with an outcome.
- Not implemented: automatic downloading of public datasets, a state-to-AICTE-region mapping for the demo regions, document parsing or extraction (no such feature existed to improve), a larger handbook index, and any live AICTE integration.

## Public data import (real published data)

The importer loads **files you download** from a public source; the app never fetches data itself. Supported: CSV, Excel (`.xlsx`) and JSON (including the `{"records": [...]}` shape that data.gov.in uses). `.xls` is rejected.

```bash
npm run import -- --file colleges.xlsx --source AIKOSH-AISHE-COLLEGES --year 2023-24 --retrieved 2026-10-23 --dry-run
npm run import -- --file colleges.xlsx --source AIKOSH-AISHE-COLLEGES --year 2023-24 --retrieved 2026-10-23
```
or use **Public data → Import** in the app (administrators). What it does:
- **Provenance first.** A source must have a publisher, a licence, a field-definitions reference, an academic year and a retrieval date, or the import is blocked and the attempt is recorded. The licence of the pre-registered sources is deliberately blank: record it after confirming it on the dataset page.
- **Normalises** state (aliases such as Orissa to Odisha), AISHE code (`U-0374`, `C-61982`; leading zeros kept), district and name casing/spacing. Headers are matched by alias, or by a mapping you supply.
- **Reports** rejected rows (with reasons and a CSV download), duplicates inside the file, possible near-duplicates, missing fields, completeness and warnings. Dry runs save nothing.
- **Never overwrites.** A blank stored field can be filled (logged). A different value becomes an open *conflict*; the stored value stays until an administrator decides, with a written reason. The same file is not imported twice unless forced.
- **Keeps origins apart.** Imported rows live in `public_institutions` (`origin = public_import`), separate from the fictional demo institutions and the synthetic applications.

**What has and has not been done.** On 2026-10-23 aishe.gov.in/documents was reachable and listed the AISHE final reports (Excel), a metadata PDF and the institution directory; data.gov.in had only aggregate AICTE counts, not an institution list; the official AICTE handbook PDF refused automated download. **No real dataset has been downloaded or imported by this project.** The tests use clearly fictional fixture files. To load real data, download the AISHE directory export (or its AIKosh republication), confirm its licence, record it on the source, and run the import.

**Handbook versions and rule activation.** `handbook_versions` records the 2024-27 handbook and the 2025-26 and 2026-27 addenda (text not read) and that no successor was found. A rule can only become *active* in the workflow when an administrator has checked it against the official text, its handbook version is current and every current addendum is reviewed. Rules used by the demo workflow today are shown as *Used in the demo workflow, not verified*.

**Scale.** `npm run generate -- --count 2000 --seed 7` produced 2,038 applications with 6,317 stage changes, 29,240 notifications, 2,450 escalations and 5,429 documents in 65 seconds on the development machine (single run, not a benchmark). The integrity checks passed. Five EVC cases stayed unscheduled because the two committees in the busiest regions ran out of free dates, which is intended behaviour. Allowed range: 1 to 5000 applications.

## Document names

People see descriptive names (for example *Lease Agreement*, *Land Ownership Document*), with the document ID (`DOC-0042`), reference number and file name as secondary text.
The mapping lives in one place, `server/src/docnames.ts`; the stored `doc_type` value, document IDs and file names on disk are never changed, so existing records, filters and downloads keep working.
Unknown types are shown as stored; a missing type is shown as *Unnamed Document*. To rename a label, edit the map. Notification and audit text already stored in an existing database keeps its old wording;
run `npm run reset` to regenerate the demo data with the new wording.

## Architecture

```
React + TypeScript + Vite + Tailwind   (TanStack Query, React Hook Form + Zod, Recharts, React Flow)
        |  REST /api, Bearer JWT
Express (Node 22, TypeScript)  ──  modules: workflow, evc, compliance, documents, notify, escalation, jobs, reports, insights, audit
        |
SQLite (better-sqlite3, WAL)   ──  versioned SQL migrations, FK constraints, indexes, append-only audit table
Private file storage on disk   ──  server-generated names, content sniffing, authenticated downloads only
```

A modular monolith. The deadline scheduler runs inside the server process on a timer and is independent of any browser. See `docs/ARCHITECTURE.md` for the data model,
engine rules and the mapping to the Spring Boot / PostgreSQL stack in the original brief.

## Limitations and mock integrations (read before demoing)

- **Stack.** The brief preferred Java/Spring Boot and PostgreSQL. This prototype uses Node/Express and SQLite to be runnable anywhere. `docs/PORTING.md` maps each module to its Spring equivalent.
- **Email/SMS are simulated.** Messages are recorded as `simulated_sent` (or fail for `+bounce` addresses). No mail leaves the machine. Swap `setEmailAdapter` for a real adapter. No SMS adapter exists.
- **No AICTE integration.** There is no connector to any real AICTE system; none is claimed.
- **The assistant is rule-based**, not an LLM. It answers a fixed set of questions from permission-scoped queries and never performs actions. There is no Python AI service.
- **Forecast** uses median historical stage durations from synthetic data; it is labelled as a forecast, not a status.
- **Working-day calendar.** Weekends are skipped; the `holidays` table is empty because no official calendar is bundled.
- **Single instance.** The scheduler assumes one server process. For several instances use a database lock or a single scheduler node.
- **Auth.** Bearer JWT kept in `sessionStorage` (XSS would expose it; httpOnly cookies + CSRF protection would be the hardening step). No MFA, no password reset flow, login rate limit is per-IP in memory.
- **Audit chain** is tamper-evident, not immutable: someone with database access can rewrite the whole chain.
- **Not implemented:** SMS, multilingual guidance, real committee availability, SQL/LLM tooling, Docker Compose, Playwright tests.
- Not load-tested; no performance figures are claimed. Generating 500 applications took about 10 seconds on the machine used for development; that is a one-off observation, not a benchmark.
- The `synthetic` column on audit events is provenance only and is not covered by the hash chain.
