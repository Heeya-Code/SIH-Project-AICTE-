import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import type { DB } from './db';
import { clock, atIstMorning, istDate } from './clock';
import { config } from './config';
import { addCalendarDays, ApiError } from './util';
import { setSynthetic } from './origin';
import { createApplication, submitApplication, performTransition, addObservation, requiredDocs } from './workflow';
import { addDocument, verifyDocument } from './documents';
import { createUndertaking, submitEvidence, reviewUndertaking } from './compliance';
import { scheduleEvc, rescheduleEvc, completeEvc } from './evc';
import { saveUpload, placeholderPdf } from './files';
import { runJobs } from './jobs';
import { docName } from './docnames';
import { audit, SYSTEM } from './audit';
import type { User } from './auth';

export const GENERATOR_VERSION = '1.0';
export type GenOptions = { seed?: number; count?: number; days?: number; today?: string; quiet?: boolean };

// Mulberry32: small, fast, deterministic PRNG. Every random choice below comes from it, in a fixed order.
function rng(seed: number) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

const PREFIX = ['Aravalli', 'Himalaya', 'Kaveri', 'Sahyadri', 'Konkan', 'Narmada', 'Ganga', 'Mahanadi', 'Vindhya', 'Chambal', 'Godavari', 'Krishna', 'Brahmaputra', 'Sutlej', 'Tapti', 'Deccan', 'Malwa', 'Satpura', 'Nilgiri', 'Western Ghats', 'Eastern Ghats', 'Thar', 'Sundarbans', 'Garo Hills', 'Khasi', 'Lohit', 'Bundelkhand', 'Kathiawar', 'Malabar', 'Coromandel', 'Utkal', 'Awadh', 'Doaba', 'Marwar', 'Telangana', 'Rayalaseema', 'Konkan Coast', 'Saurashtra', 'Chota Nagpur', 'Magadh'];
const KIND = ['Institute of Technology', 'College of Engineering', 'Polytechnic', 'Technical Campus', 'School of Engineering', 'Institute of Management and Technology'];
const CITIES: Record<string, string[]> = { NR: ['Jaipur', 'Dehradun', 'Ludhiana', 'Jammu', 'Lucknow', 'Chandigarh'], SR: ['Coimbatore', 'Mangaluru', 'Hyderabad', 'Kochi', 'Madurai', 'Vijayawada'], WR: ['Pune', 'Surat', 'Nagpur', 'Vadodara', 'Nashik', 'Rajkot'], ER: ['Kolkata', 'Bhubaneswar', 'Patna', 'Ranchi', 'Siliguri'], CR: ['Bhopal', 'Gwalior', 'Indore', 'Raipur', 'Jabalpur'], NER: ['Guwahati', 'Shillong', 'Imphal', 'Agartala'] };
const REGION_W: [string, number][] = [['NR', 0.17], ['SR', 0.25], ['WR', 0.22], ['ER', 0.13], ['CR', 0.17], ['NER', 0.025]];
const CATEGORY_W: [string, number][] = [['EXT', 0.38], ['NEW', 0.22], ['INT', 0.2], ['ADD', 0.06], ['SITE', 0.06], ['CLOSE', 0.04], ['NAME', 0.04]];
const ROUTE: Record<string, string[]> = { NEW: ['scrutiny', 'evc', 'decision'], EXT: ['scrutiny', 'decision'], INT: ['scrutiny', 'evc', 'decision'], ADD: ['evc', 'decision'], SITE: ['evc', 'sac', 'decision'], CLOSE: ['scrutiny', 'decision'], NAME: ['scrutiny', 'decision'] };
const TITLES: Record<string, string[]> = {
  NEW: ['Establishment of a new engineering institute', 'New diploma institution proposal', 'New technical campus application'],
  EXT: ['Extension of Approval for 2026-27', 'Extension of Approval: all programmes', 'Extension of Approval with self-disclosure'],
  INT: ['Increase in intake: Computer Science', 'Increase in intake: Mechanical Engineering', 'Additional course: Electronics and Communication', 'Additional course: Artificial Intelligence'],
  ADD: ['Addition of a postgraduate course'], SITE: ['Change of site to a new campus', 'Change of location within the district'], CLOSE: ['Progressive closure of a programme'], NAME: ['Change in name of the institution'],
};
const RETURN_REASONS: [string, string][] = [
  ['Lease agreement is missing the schedule of property.', 'document'], ['Fire safety certificate is not legible. Upload a clear copy.', 'document'], ['Faculty list does not match the intake applied for.', 'faculty'],
  ['Laboratory area in the self-disclosure is lower than the norm.', 'infrastructure'], ['Land document does not name the trust.', 'document'], ['Undertaking on previous compliance not attached.', 'compliance'], ['Building plan lacks the architect\'s certificate.', 'document'],
];
const RESCHEDULE_REASONS = ['Committee member unavailable on the proposed date.', 'Scheduling conflict with another visit for the same committee.', 'Institution requested a different date.', 'Local holiday in the visit week.'];
const REJECT_REASONS = ['Infrastructure norms not met per the review.', 'Deficiencies were not fulfilled within the allowed period.', 'Required land documents not established.'];

export type GenReport = { skipped: boolean; generated: number; institutions: number; steps: number; stepFailures: number; edgeCases: Record<string, number> };

export async function generateApplications(db: DB, opts: GenOptions = {}): Promise<GenReport> {
  const seed = opts.seed ?? 2026, count = opts.count ?? 500, days = opts.days ?? 240;
  if (!Number.isInteger(count) || count < 1 || count > 5000) throw new Error('count must be a whole number between 1 and 5000 (500 to 2000 is the intended range)');
  if (!Number.isInteger(days) || days < 30 || days > 730) throw new Error('days must be between 30 and 730');
  if (!Number.isInteger(seed)) throw new Error('seed must be a whole number');
  const anchor = opts.today ?? istDate(new Date());
  const done = db.prepare(`SELECT status FROM seed_runs WHERE kind='applications' AND seed=? AND requested=? AND generator_version=?`).get(seed, count, GENERATOR_VERSION) as any;
  if (done?.status === 'completed') return { skipped: true, generated: 0, institutions: 0, steps: 0, stepFailures: 0, edgeCases: {} };
  if (done) throw new Error('A previous generation run with these settings did not finish. Run "npm run reset" to start again.');
  const runId = Number(db.prepare(`INSERT INTO seed_runs (kind,seed,requested,generator_version,params,status,started_at) VALUES ('applications',?,?,?,?, 'running', ?)`)
    .run(seed, count, GENERATOR_VERSION, JSON.stringify({ days, anchor }), clock.iso()).lastInsertRowid);
  setSynthetic(true);
  try {
    const rep = await run(db, seed, count, days, anchor, !!opts.quiet);
    db.prepare(`UPDATE seed_runs SET status='completed', generated=?, finished_at=? WHERE id=?`).run(rep.generated, clock.iso(), runId);
    audit(db, { actor: SYSTEM, type: 'system.seed_generated', entity: 'system', entityId: 'generator', next: { seed, count, version: GENERATOR_VERSION, generated: rep.generated, edge_cases: rep.edgeCases } });
    return rep;
  } catch (e) { db.prepare(`UPDATE seed_runs SET status='failed', finished_at=? WHERE id=?`).run(clock.iso(), runId); throw e; }
  finally { setSynthetic(false); clock.set(opts.today ? atIstMorning(opts.today) : null); }
}

async function run(db: DB, seed: number, count: number, days: number, anchor: string, quiet: boolean): Promise<GenReport> {
  const rand = rng(seed);
  const int = (a: number, b: number) => a + Math.floor(rand() * (b - a + 1));
  const pick = <T,>(xs: T[]) => xs[Math.floor(rand() * xs.length)];
  const weighted = <T,>(xs: [T, number][]) => { let r = rand() * xs.reduce((s, x) => s + x[1], 0); for (const [v, w] of xs) { if ((r -= w) < 0) return v; } return xs[xs.length - 1][0]; };
  const day = (ago: number) => addCalendarDays(anchor, -ago);
  const fut = (n: number) => addCalendarDays(anchor, n);
  const edge: Record<string, number> = {};
  const mark = (k: string) => { edge[k] = (edge[k] ?? 0) + 1; };

  // ---- regions, institutions and their (synthetic) users
  const hash = bcrypt.hashSync(config.demoPassword, 10);
  const regionId = (code: string) => (db.prepare('SELECT id FROM regions WHERE code=?').get(code) as any)?.id as number | undefined;
  if (!regionId('NER')) {
    const rid = Number(db.prepare(`INSERT INTO regions (code,name) VALUES ('NER','North-Eastern Region')`).run().lastInsertRowid);
    for (const s of ['A', 'B']) db.prepare('INSERT INTO evc_committees (name,region_id) VALUES (?,?)').run(`Synthetic EVC panel NER-${s}`, rid);   // no officers and no coordinator: cases here stay unassigned
  }
  const nInst = Math.max(6, Math.round(count / 9));
  const insts: { id: number; region: number; code: string; user: User }[] = [];
  const usedNames = new Set((db.prepare('SELECT name FROM institutions').all() as any[]).map(r => r.name));
  const baseInst = (db.prepare('SELECT COUNT(*) c FROM institutions').get() as any).c as number;
  db.transaction(() => {
    for (let i = 0; i < nInst; i++) {
      const code = weighted(REGION_W), city = pick(CITIES[code]);
      let name = '', tries = 0;
      do { name = `${pick(PREFIX)} ${pick(KIND)}, ${city} (Demo)`; if (++tries > 40) name = `${pick(PREFIX)} ${pick(KIND)} ${i + 1}, ${city} (Demo)`; } while (usedNames.has(name));
      usedNames.add(name);
      const rid = regionId(code)!;
      const id = Number(db.prepare('INSERT INTO institutions (name,city,region_id,synthetic) VALUES (?,?,?,1)').run(name, city, rid).lastInsertRowid);
      const email = `g.inst${baseInst + i + 1}@demo.local`;
      const uid = Number(db.prepare(`INSERT INTO users (email,name,password_hash,role,region_id,institution_id,active,created_at,synthetic) VALUES (?,?,?, 'institution', ?,?,1,?,1)`)
        .run(email, `Representative, ${name.replace(' (Demo)', '')}`, hash, rid, id, clock.iso()).lastInsertRowid);
      insts.push({ id, region: rid, code, user: db.prepare('SELECT id,email,name,role,region_id,institution_id,active FROM users WHERE id=?').get(uid) as User });
    }
  })();
  // Guarantee at least one institution in the Region that has no officers, so unassigned and stalled cases always exist.
  if (!insts.some(x => x.code === 'NER')) {
    const last = insts[insts.length - 1], ner = regionId('NER')!;
    db.prepare('UPDATE institutions SET region_id=? WHERE id=?').run(ner, last.id); db.prepare('UPDATE users SET region_id=? WHERE institution_id=?').run(ner, last.id);
    last.region = ner; last.code = 'NER'; last.user = db.prepare('SELECT id,email,name,role,region_id,institution_id,active FROM users WHERE id=?').get(last.user.id) as User;
  }
  const nerIdx = insts.findIndex(x => x.code === 'NER'), minNer = Math.max(2, Math.round(count * 0.02));
  const instWeight = insts.map((x, i) => (x.code === 'NER' ? 0.25 : 1) * (0.4 + ((i * 7919) % 100) / 60));          // some institutions file far more than others

  // ---- staff lookup (works from the application's assignee where possible)
  const staffCache = new Map<string, User | null>();
  const staff = (role: string, app: any): User | null => {
    if (app?.assigned_user_id) { const u = db.prepare('SELECT id,email,name,role,region_id,institution_id,active FROM users WHERE id=? AND role=? AND active=1').get(app.assigned_user_id, role) as User | undefined; if (u) return u; }
    const regional = role === 'regional_officer' || role === 'evc_coordinator';
    const key = `${role}:${regional ? app.region_id : '*'}`;
    if (!staffCache.has(key)) staffCache.set(key, (db.prepare(`SELECT id,email,name,role,region_id,institution_id,active FROM users WHERE role=? AND active=1 ${regional ? 'AND region_id=?' : ''} ORDER BY id LIMIT 1`).get(...(regional ? [role, app.region_id] : [role])) as User | undefined) ?? null);
    return staffCache.get(key)!;
  };

  // ---- planning: build a time-ordered event list; events dated after "today" are never created, so in-flight cases arise naturally
  type Ev = { ago: number; seq: number; k: number; name: string; fn: () => void };
  const events: Ev[] = []; let seq = 0;
  const ids: number[] = [];                      // application id by index
  const dead = new Set<number>();                 // an application whose step failed stops generating further steps (it becomes a stalled case)
  const info: { inst: number; cat: string }[] = [];
  const ev = (k: number, ago: number, name: string, fn: () => void) => { if (ago >= 0) events.push({ ago, seq: seq++, k, name, fn }); };
  const appRow = (k: number) => db.prepare('SELECT * FROM applications WHERE id=?').get(ids[k]) as any;
  const file = (label: string) => { const b = placeholderPdf(label); return saveUpload({ originalname: `${label.replace(/\W+/g, ' ').trim()}.pdf`, buffer: b, size: b.length }); };

  const leaseOffset = () => { const r = rand(); return r < 0.08 ? -int(3, 120) : r < 0.22 ? int(0, 45) : int(60, 900); };

  function create(k: number, instIdx: number, cat: string, ago: number, o: { complete: boolean; submit: boolean; docs?: boolean }) {
    ev(k, ago, 'create', () => {
      const inst = insts[instIdx];
      const id = createApplication(db, inst.user, { category_code: cat, title: `${pick(TITLES[cat])}`, summary: 'Synthetic application generated for demonstration. Not a genuine AICTE record.' });
      ids[k] = id;
      const reqs = db.prepare('SELECT * FROM document_requirements WHERE category_code=? AND required=1 ORDER BY id').all(cat) as any[];
      reqs.forEach((r, i) => {
        if (!o.complete && i === reqs.length - 1) return;                                // incomplete application: last required document never uploaded
        const exp = r.doc_type === 'Lease Deed' ? addCalendarDays(anchor, leaseOffset()) : r.has_expiry ? addCalendarDays(anchor, leaseOffset()) : null;
        const issue = exp ? addCalendarDays(exp, -int(400, 3000)) : day(ago + int(30, 700));
        addDocument(db, inst.user, { application_id: id, doc_type: r.doc_type, reference_no: `SYN-${id}-${r.id}`, issue_date: issue, expiry_date: exp }, file(docName(r.doc_type)));
      });
      if (o.submit) submitApplication(db, inst.user, id);
    });
  }
  const step = (k: number, ago: number, name: string, who: string, fn: (u: User, a: any) => void) => ev(k, ago, name, () => {
    if (dead.has(k)) return;
    const a = appRow(k);
    const u = who === 'inst' ? insts[info[k].inst].user : staff(who, a);
    if (!u) { dead.add(k); mark('no_staff_for_region'); return; }
    try { fn(u, a); } catch (e: any) { dead.add(k); if (!quiet) console.log(`[generate] step "${name}" failed for #${k}: ${e.message}`); mark(`failed_${name}`); }
  });

  const observe = (k: number, ago: number, who: string, text = 'Documents reviewed against the checklist; observations recorded (synthetic).') =>
    step(k, ago, 'observe', who, (u, a) => { addObservation(db, u, a.id, text); });
  const scrutinise = (k: number, ago: number) => step(k, ago, 'scrutinise', 'regional_officer', (u, a) => {
    addObservation(db, u, a.id, 'Documents reviewed against the checklist; observations recorded (synthetic).');
    for (const d of db.prepare('SELECT id FROM documents WHERE application_id=? AND is_current=1').all(a.id) as any[]) {
      const r = rand();
      if (r < 0.72) verifyDocument(db, u, d.id, 'verified', 'Checked against the submission (synthetic).');
      else if (r < 0.76) { verifyDocument(db, u, d.id, 'returned', 'Scan quality too low to verify (synthetic).'); mark('document_returned'); }
    }
    performTransition(db, u, a.id, 'complete_scrutiny');
  });
  const doReturn = (k: number, ago: number, who: string) => { const [reason, cat] = pick(RETURN_REASONS); step(k, ago, 'return', who, (u, a) => { performTransition(db, u, a.id, 'return', { reason, deficiencyCategory: cat }); mark('returned_for_correction'); }); };
  const resubmit = (k: number, ago: number) => step(k, ago, 'resubmit', 'inst', (u, a) => { performTransition(db, u, a.id, 'resubmit', { reason: 'Corrected documents uploaded and the points raised have been addressed (synthetic response).' }); mark('resubmitted'); });
  const schedule = (k: number, ago: number, visitIn: number) => step(k, ago, 'schedule', 'evc_coordinator', (u, a) => {
    const e = db.prepare('SELECT * FROM evc_schedules WHERE application_id=? ORDER BY id DESC LIMIT 1').get(a.id) as any;
    const comms = db.prepare('SELECT id FROM evc_committees WHERE region_id=? ORDER BY id').all(a.region_id) as any[];
    let date = addCalendarDays(clock.today(), visitIn), ci = k % comms.length, conflicts = 0;
    for (let t = 0; t < 8; t++) {
      try { scheduleEvc(db, u, e.id, { confirmed_date: date, committee_id: comms[ci].id, reason: conflicts ? 'The first choice clashed with an existing booking, so the visit was moved.' : undefined }); if (conflicts) mark('evc_conflict_resolved'); return; }
      catch (err) { if (err instanceof ApiError && err.status === 409) { conflicts++; if (conflicts % 2) ci = (ci + 1) % comms.length; else date = addCalendarDays(date, 1); continue; } throw err; }
    }
    throw new Error('no free committee slot');
  });
  const reschedule = (k: number, ago: number, newVisitIn: number) => step(k, ago, 'reschedule', 'evc_coordinator', (u, a) => {
    const e = db.prepare('SELECT * FROM evc_schedules WHERE application_id=? ORDER BY id DESC LIMIT 1').get(a.id) as any;
    const comms = db.prepare('SELECT id FROM evc_committees WHERE region_id=? ORDER BY id').all(a.region_id) as any[];
    let date = addCalendarDays(clock.today(), newVisitIn);
    for (let t = 0; t < 8; t++) { try { rescheduleEvc(db, u, e.id, { confirmed_date: date, committee_id: comms[(k + t) % comms.length].id, reason: pick(RESCHEDULE_REASONS) }); mark('evc_rescheduled'); return; } catch (err) { if (err instanceof ApiError && err.status === 409) { date = addCalendarDays(date, 1); continue; } throw err; } }
    throw new Error('no free slot to reschedule');
  });
  const completeVisit = (k: number, ago: number, outcome: 'satisfactory' | 'deficiencies_noted') => step(k, ago, 'complete_visit', 'evc_coordinator', (u, a) => {
    const e = db.prepare('SELECT * FROM evc_schedules WHERE application_id=? ORDER BY id DESC LIMIT 1').get(a.id) as any;
    completeEvc(db, u, e.id, { visit_date: e.confirmed_date <= clock.today() ? e.confirmed_date : clock.today(), notes: outcome === 'satisfactory' ? 'Infrastructure, laboratories and faculty verified against the submission (synthetic report).' : 'Shortfall noted in laboratory area and library resources (synthetic report).', outcome });
  });
  const sac = (k: number, ago: number) => step(k, ago, 'sac_review', 'bureau_officer', (u, a) => { addObservation(db, u, a.id, 'SAC/SHC review recorded (synthetic).'); performTransition(db, u, a.id, 'recommend'); });
  const decide = (k: number, ago: number, outcome: 'approve' | 'reject') => step(k, ago, 'decide', 'competent_authority', (u, a) => { performTransition(db, u, a.id, outcome, { reason: outcome === 'approve' ? 'Approved on the basis of the committee reports (synthetic decision).' : pick(REJECT_REASONS) }); });
  const withdraw = (k: number, ago: number) => step(k, ago, 'withdraw', 'inst', (u, a) => { performTransition(db, u, a.id, 'withdraw', { reason: 'Application withdrawn by the institution (synthetic).' }); mark('withdrawn'); });

  type Arch = 'approved' | 'rejected' | 'in_flight' | 'withdrawn' | 'returned_resubmitted' | 'returned_waiting' | 'stalled' | 'evc_rescheduled' | 'evc_visit_missed' | 'draft_incomplete' | 'unassigned';
  const ARCH: [Arch, number][] = [['approved', 0.3], ['rejected', 0.06], ['in_flight', 0.26], ['withdrawn', 0.03], ['returned_resubmitted', 0.1], ['returned_waiting', 0.035], ['stalled', 0.03], ['evc_rescheduled', 0.05], ['evc_visit_missed', 0.03], ['draft_incomplete', 0.05]];

  // Walks the category's stage route. `day` counts "days ago" and shrinks as time passes; once it would go below zero the case simply stops there.
  function plan(k: number, cat: string, arch: Arch, start: number) {
    const route = ROUTE[cat]; let t = start; const pace = arch === 'stalled' ? 1 : 0.7 + rand() * 1.2;
    const adv = (a: number, b: number, mult = 1) => { t -= Math.max(1, Math.round((a + rand() * (b - a)) * pace * mult)); return t; };
    create(k, info[k].inst, cat, start, { complete: arch !== 'draft_incomplete', submit: arch !== 'draft_incomplete' });
    if (arch === 'draft_incomplete' || arch === 'unassigned') { if (arch === 'draft_incomplete') mark('incomplete_draft'); else mark('unassigned_region_case'); return; }
    let returned = false;
    for (const s of route) {
      if (t < 0) return;
      if (s === 'scrutiny') {
        if (arch === 'stalled') { adv(25, 60); if (t >= 0) mark('stalled_at_scrutiny'); return; }
        if ((arch === 'returned_resubmitted' || arch === 'returned_waiting' || arch === 'withdrawn') && !returned) {
          returned = true; doReturn(k, adv(2, 8), 'regional_officer');
          if (arch === 'returned_waiting') return;
          if (arch === 'withdrawn') { withdraw(k, adv(3, 12)); return; }
          resubmit(k, adv(3, 14));
        }
        scrutinise(k, adv(2, 9));
      } else if (s === 'evc') {
        if (arch === 'stalled') { adv(20, 45); if (t >= 0) mark('stalled_at_evc_queue'); return; }
        const visitIn = int(3, 14); schedule(k, adv(1, 8), visitIn);
        if (arch === 'evc_visit_missed') { mark('evc_visit_not_recorded'); return; }
        let wait = visitIn;
        if (arch === 'evc_rescheduled') { const again = int(3, 10); reschedule(k, adv(1, 3), again); wait = again; if (rand() < 0.3) { const third = int(3, 9); reschedule(k, adv(1, 3), third); wait = third; } }
        const outcome = rand() < 0.12 ? 'deficiencies_noted' : 'satisfactory';
        completeVisit(k, (t -= wait + int(0, 2)), outcome);
        if (t < 0) return;
      } else if (s === 'sac') {
        if (arch === 'stalled') { adv(20, 40); mark('stalled_at_sac'); return; }
        sac(k, adv(2, 10));
      } else if (s === 'decision') {
        if (arch === 'stalled') { adv(15, 35); mark('stalled_at_decision'); return; }
        if (arch === 'returned_resubmitted' && !returned && cat === 'ADD') { returned = true; doReturn(k, adv(1, 5), 'competent_authority'); resubmit(k, adv(3, 12)); }
        decide(k, adv(1, 9), arch === 'rejected' ? 'reject' : 'approve');
        if (arch === 'approved' || arch === 'in_flight' || arch === 'returned_resubmitted' || arch === 'evc_rescheduled') planAfterApproval(k, t);
      }
    }
  }

  // Obligations created from the approval template get evidence and reviews at random later dates; a few are left late.
  function planAfterApproval(k: number, approvedAgo: number) {
    if (approvedAgo < 3) return;
    const r = rand();
    if (r < 0.55) {
      const sub = approvedAgo - int(5, 60); const u = () => db.prepare('SELECT id FROM undertakings WHERE application_id=? ORDER BY id').all(ids[k]) as any[];
      ev(k, sub, 'evidence', () => { const x = u()[0]; if (!x) return; const row = db.prepare('SELECT * FROM undertakings WHERE id=?').get(x.id) as any; if (!['pending', 'returned'].includes(row.status)) return; try { submitEvidence(db, insts[info[k].inst].user, x.id, 'Evidence enclosed for verification (synthetic).', file('Compliance Submission Report')); } catch { mark('failed_evidence'); } });
      if (r < 0.4) ev(k, sub - int(2, 12), 'review', () => { const x = u()[0]; if (!x) return; const row = db.prepare('SELECT * FROM undertakings WHERE id=?').get(x.id) as any; if (row.status !== 'submitted') return; const reviewer = staff('regional_officer', appRow(k)); if (!reviewer) return; try { if (rand() < 0.75) reviewUndertaking(db, reviewer, x.id, 'verify', 'Evidence complete (synthetic).'); else { reviewUndertaking(db, reviewer, x.id, 'return', 'Signature missing on the statement (synthetic).'); mark('evidence_returned'); } } catch { mark('failed_review'); } });
    }
    // some institutions renew the lease after it expires (or before)
    if (rand() < 0.12) ev(k, approvedAgo - int(2, 40), 'renew_lease', () => {
      const d = db.prepare(`SELECT * FROM documents WHERE application_id=? AND doc_type='Lease Deed' AND is_current=1`).get(ids[k]) as any; if (!d?.expiry_date) return;
      try { addDocument(db, insts[info[k].inst].user, { renew_of: d.id, reference_no: `${d.reference_no}-R`, issue_date: clock.today(), expiry_date: addCalendarDays(clock.today(), int(900, 1800)) }, file('Renewed Lease Agreement')); mark('lease_renewed'); } catch { mark('failed_renewal'); }
    });
  }

  // ---- choose what each application will be
  for (let k = 0; k < count; k++) {
    let wsum = instWeight.reduce((a, b) => a + b, 0), r = rand() * wsum, instIdx = 0;
    for (let i = 0; i < instWeight.length; i++) { if ((r -= instWeight[i]) < 0) { instIdx = i; break; } }
    if (k < minNer) instIdx = nerIdx;
    const cat = weighted(CATEGORY_W);
    info[k] = { inst: instIdx, cat };
    const noStaff = insts[instIdx].code === 'NER';
    const arch: Arch = noStaff ? 'unassigned' : weighted(ARCH);
    const need = { approved: 45, rejected: 45, in_flight: 2, withdrawn: 25, returned_resubmitted: 30, returned_waiting: 10, stalled: 50, evc_rescheduled: 40, evc_visit_missed: 25, draft_incomplete: 2, unassigned: 3 }[arch];
    const start = arch === 'in_flight' ? int(2, 70) : int(Math.min(need, days - 1), days - 2);
    plan(k, cat, arch, start);
  }
  // a few manual obligations recorded by regional officers, some already overdue
  for (let i = 0; i < Math.round(count / 12); i++) {
    const k = int(0, count - 1), off = int(-45, 90), made = int(2, 120);
    ev(k, made, 'manual_obligation', () => {
      const inst = insts[info[k].inst]; const officer = (db.prepare(`SELECT id,email,name,role,region_id,institution_id,active FROM users WHERE role='regional_officer' AND region_id=? AND active=1 LIMIT 1`).get(inst.region) as User | undefined);
      if (!officer) { mark('no_officer_for_obligation'); return; }
      const due = addCalendarDays(anchor, off); if (due < clock.today()) { mark('skipped_obligation_in_past'); return; }
      try { createUndertaking(db, officer, { institution_id: inst.id, condition_text: pick(['Submit audited accounts', 'Submit faculty qualification statement', 'Submit library resources statement', 'Submit laboratory commissioning report', 'Submit anti-ragging undertaking']), description: 'Synthetic obligation recorded by an officer.', required_evidence: 'Signed statement with supporting document (PDF)', due_date: due }); } catch { mark('failed_obligation'); }
    });
  }

  // ---- replay the history, day by day, on a simulated clock
  events.sort((a, b) => b.ago - a.ago || a.seq - b.seq);
  let steps = 0, i = 0;
  for (let ago = days; ago >= 0; ago--) {
    clock.set(atIstMorning(day(ago)));
    while (i < events.length && events[i].ago === ago) {
      const e = events[i++];
      if (e.name !== 'create' && ids[e.k] === undefined) continue;        // creation did not happen
      try { e.fn(); steps++; } catch (err: any) { dead.add(e.k); mark(`failed_${e.name}`); if (!quiet) console.log(`[generate] ${e.name} failed for #${e.k}: ${err.message}`); }
    }
    await runJobs(db, 'seed');
  }
  const generated = ids.filter(x => x !== undefined).length;
  mark('open_obligations_overdue'); delete edge.open_obligations_overdue;
  const od = (db.prepare(`SELECT COUNT(*) c FROM undertakings WHERE synthetic=1 AND status IN ('pending','returned') AND due_date < ?`).get(addCalendarDays(anchor, 0)) as any).c; if (od) edge.overdue_obligations = od;
  const expired = (db.prepare(`SELECT COUNT(*) c FROM documents WHERE synthetic=1 AND is_current=1 AND expiry_date < ?`).get(anchor) as any).c; if (expired) edge.expired_documents = expired;
  const soon = (db.prepare(`SELECT COUNT(*) c FROM documents WHERE synthetic=1 AND is_current=1 AND expiry_date BETWEEN ? AND ?`).get(anchor, addCalendarDays(anchor, 30)) as any).c; if (soon) edge.documents_expiring_within_30_days = soon;
  const unassigned = (db.prepare(`SELECT COUNT(*) c FROM applications WHERE synthetic=1 AND status='in_progress' AND assigned_user_id IS NULL`).get() as any).c; if (unassigned) edge.unassigned_in_progress = unassigned;
  void crypto;
  return { skipped: false, generated, institutions: insts.length, steps, stepFailures: Object.entries(edge).filter(([k]) => k.startsWith('failed_')).reduce((s, [, v]) => s + v, 0), edgeCases: edge };
}

// A stable digest of the logical content of the generated data, used to prove a seed reproduces the same dataset.
export function datasetFingerprint(db: DB): string {
  const rows = db.prepare(`SELECT a.ref, a.category_code, a.status, a.current_stage, i.name AS inst, substr(a.submitted_at,1,10) AS sub, substr(a.completed_at,1,10) AS done, a.stage_due_date,
      (SELECT COUNT(*) FROM stage_history h WHERE h.application_id=a.id) AS hist, (SELECT COUNT(*) FROM documents d WHERE d.application_id=a.id) AS docs
    FROM applications a JOIN institutions i ON i.id=a.institution_id WHERE a.synthetic=1 ORDER BY a.id`).all();
  return crypto.createHash('sha256').update(JSON.stringify(rows)).digest('hex');
}
void requiredDocs;
