import bcrypt from 'bcryptjs';
import type { DB } from './db';
import { clock, atIstMorning, istDate } from './clock';
import { config } from './config';
import { addCalendarDays } from './util';
import { insertDefinition, createApplication, submitApplication, performTransition, addObservation, type Definition, type Stage, type Transition } from './workflow';
import { addDocument, verifyDocument } from './documents';
import { createUndertaking, submitEvidence, reviewUndertaking } from './compliance';
import { scheduleEvc, completeEvc } from './evc';
import { saveUpload, placeholderPdf } from './files';
import { runJobs } from './jobs';
import { audit, SYSTEM } from './audit';
import { docName } from './docnames';
import { setSynthetic } from './origin';
import { ensureRegulatoryData } from './regulatory';
import { ensurePublicDataRegistry } from './publicdata';
import { generateApplications } from './generate';
import type { User } from './auth';

// ------------------------------------------------------------------------------------------------ base configuration
// All deadlines, reminder intervals and escalation delays below are SYNTHETIC DEMONSTRATION VALUES.
// They are not AICTE rules; administrators are expected to configure them according to the applicable APH.

const REGIONS = [['NR', 'Northern Region'], ['SR', 'Southern Region'], ['WR', 'Western Region'], ['ER', 'Eastern Region'], ['CR', 'Central Region']];

const SETTINGS: [string, string, string][] = [
  ['reminder_days_task', '[7,1]', 'Days before a stage deadline when reminders are sent (sample value)'],
  ['reminder_days_evc', '[7,1]', 'Days before an EVC scheduling/completion deadline when reminders are sent (sample value)'],
  ['reminder_days_undertaking', '[7,1]', 'Days before an undertaking due date when reminders are sent (sample value)'],
  ['reminder_days_document', '[30,7,1]', 'Days before a document expiry when reminders are sent (sample value)'],
  ['due_soon_days', '3', 'An application stage is "due soon" when this many days (or fewer) remain'],
  ['undertaking_due_soon_days', '14', 'An obligation is "due soon" when this many days (or fewer) remain'],
  ['email_max_attempts', '3', 'Delivery attempts before an email is marked abandoned'],
];

const TEMPLATES: [string, string, string, string?][] = [
  ['application.submitted', 'Application {ref} submitted', 'Your application "{title}" has been received and routed for processing.'],
  ['application.assigned', 'New application assigned: {ref}', '{title} is now at "{stage}". Due by {due}.'],
  ['application.stage_changed', '{ref} moved to {stage}', 'Your application "{title}" is now at "{stage}".'],
  ['application.returned', 'Action needed: {ref} returned for clarification', '"{title}" was returned. Reason: {reason}. Respond by {due}.'],
  ['application.resubmitted', 'Resubmission received: {ref}', 'The institution responded to the clarification request on "{title}".'],
  ['application.decided', 'Decision recorded: {ref} is {outcome}', 'The application "{title}" now has the outcome "{outcome}". Details: {reason}'],
  ['evc.queued', 'EVC to schedule: {ref}', 'An application has reached an EVC stage and is waiting to be scheduled.'],
  ['evc.scheduled', 'EVC visit scheduled for {ref}', 'The EVC visit for {ref} is scheduled for {date}.'],
  ['evc.deadline_approaching', 'EVC {what} deadline approaching: {ref}', 'The {what} deadline for {ref} is {due} ({days} day(s) left).'],
  ['evc.overdue', 'EVC {what} overdue: {ref}', 'The {what} deadline for {ref} was {due} ({days} day(s) ago).'],
  ['undertaking.created', 'New obligation {code}', '{condition}. Due {due}.'],
  ['undertaking.deadline_approaching', 'Obligation {code} due in {days} day(s)', '{condition} is due on {due}.'],
  ['compliance.submitted', 'Evidence submitted for {code}', 'Evidence for {code} is waiting for verification.'],
  ['compliance.returned', 'Evidence for {code} returned for correction', '{note}'],
  ['compliance.verified', 'Evidence for {code} verified', 'Your submission for {code} has been verified.'],
  ['compliance.overdue', 'Obligation {code} is overdue', 'Due {due} ({days} day(s) ago). Submit evidence as soon as possible.'],
  ['document.expiry_approaching', '{doc_type} expires in {days} day(s)', 'Renew the {doc_type} before {due} and upload the new version.'],
  ['document.expired', '{doc_type} has expired', 'The {doc_type} expired on {due}. Upload a renewed document.'],
  ['document.renewed', 'Renewed {doc_type} received', '{institution} uploaded a renewed {doc_type} for verification.'],
  ['document.verified', '{doc_type} verified', 'Your {doc_type} was verified.'],
  ['document.returned', '{doc_type} returned', '{note}'],
  ['task.deadline_approaching', 'Deadline in {days} day(s): {title}', '{ref}: due {due}.'],
  ['task.overdue', 'Overdue: {title}', '{ref}: was due {due} ({days} day(s) ago).'],
  ['escalation.triggered', 'Escalation (level {level})', '{reason} ({days} day(s) overdue).'],
  ['escalation.acknowledged', 'Escalation acknowledged', 'An escalated item has been acknowledged and is being handled.'],
];

const stage = (key: string, name: string, role: Stage['responsible_role'], deadline: number | null, mode: 'calendar' | 'working', x: number, y: number, extra: Partial<Stage> = {}): Stage =>
  ({ key, name, responsible_role: role, deadline_days: deadline, day_mode: mode, is_initial: 0, is_terminal: 0, terminal_status: null, is_evc: 0, evc_schedule_days: null, pos_x: x, pos_y: y, ...extra });
const term = (key: string, name: string, outcome: string, x: number, y: number) => stage(key, name, 'competent_authority', null, 'calendar', x, y, { is_terminal: 1, terminal_status: outcome });
const tr = (from: string, to: string, action: string, label: string, extra: Partial<Transition> = {}): Transition =>
  ({ from_key: from, to_key: to, action, label, requires_reason: 0, auto: 0, allowed_role: null, prerequisites: [], ...extra });

const decisionTransitions = (clarifyKey = 'clarification'): Transition[] => [
  tr('decision', 'approved', 'approve', 'Record approval'),
  tr('decision', 'rejected', 'reject', 'Record rejection', { requires_reason: 1 }),
  tr('decision', clarifyKey, 'return', 'Return for clarification', { requires_reason: 1 }),
  tr('rejected', 'ROOT', 'reopen', 'Reopen application', { requires_reason: 1, allowed_role: 'bureau_officer' }),
];
const withRoot = (ts: Transition[], root: string) => ts.map(t => (t.to_key === 'ROOT' ? { ...t, to_key: root } : t));

function workflows(): { code: string; name: string; description: string; def: Definition }[] {
  const scrut = (x = 40, y = 140) => stage('scrutiny', 'Scrutiny', 'regional_officer', 10, 'working', x, y, { is_initial: 1 });
  const clar = (x: number, y: number) => stage('clarification', 'Clarification by institution', 'institution', 7, 'calendar', x, y);
  const dec = (x: number, y: number) => stage('decision', 'Authorised decision', 'competent_authority', 10, 'calendar', x, y);
  const ends = (x: number) => [term('approved', 'Approved', 'approved', x, 40), term('rejected', 'Rejected', 'rejected', x, 160), term('withdrawn', 'Withdrawn', 'withdrawn', x, 280)];
  const clarOut = (to: string) => [tr('clarification', to, 'resubmit', 'Resubmit with response', { requires_reason: 1, prerequisites: ['required_docs_present'] }),
    tr('clarification', 'withdrawn', 'withdraw', 'Withdraw application', { requires_reason: 1 })];
  const evcStage = (init: boolean, x: number, y: number) => stage('evc', 'Expert Visit Committee', 'evc_coordinator', 30, 'calendar', x, y, { is_evc: 1, evc_schedule_days: 10, is_initial: init ? 1 : 0 });
  const evcDone = (to: string) => tr('evc', to, 'evc_completed', 'EVC visit completed', { auto: 1, prerequisites: ['evc_completed'] });
  return [
    { code: 'scrutiny_only', name: 'Scrutiny only', description: 'Illustrative route: scrutiny, then an authorised decision.',
      def: { stages: [scrut(), clar(300, 300), dec(300, 140), ...ends(560)],
        transitions: withRoot([tr('scrutiny', 'decision', 'complete_scrutiny', 'Complete scrutiny', { prerequisites: ['observation_recorded', 'required_docs_present'] }),
          tr('scrutiny', 'clarification', 'return', 'Return for clarification', { requires_reason: 1 }), ...clarOut('scrutiny'), ...decisionTransitions()], 'scrutiny') } },
    { code: 'scrutiny_evc', name: 'Scrutiny + EVC', description: 'Illustrative route: scrutiny, expert visit, then an authorised decision.',
      def: { stages: [scrut(0, 140), evcStage(false, 260, 140), clar(260, 320), dec(520, 140), ...ends(780)],
        transitions: withRoot([tr('scrutiny', 'evc', 'complete_scrutiny', 'Complete scrutiny and send for EVC', { prerequisites: ['observation_recorded', 'required_docs_present'] }),
          tr('scrutiny', 'clarification', 'return', 'Return for clarification', { requires_reason: 1 }), evcDone('decision'), ...clarOut('scrutiny'), ...decisionTransitions()], 'scrutiny') } },
    { code: 'evc_sac', name: 'EVC + SAC/SHC', description: 'Illustrative route: expert visit, SAC/SHC stage, then an authorised decision.',
      def: { stages: [evcStage(true, 0, 140), stage('sac_shc', 'SAC / SHC review', 'bureau_officer', 15, 'calendar', 260, 140), clar(260, 320), dec(520, 140), ...ends(780)],
        transitions: withRoot([evcDone('sac_shc'), tr('sac_shc', 'decision', 'recommend', 'Send for decision', { prerequisites: ['observation_recorded'] }),
          tr('sac_shc', 'clarification', 'return', 'Return for clarification', { requires_reason: 1 }), ...clarOut('sac_shc'), ...decisionTransitions()], 'evc') } },
    { code: 'only_evc', name: 'Only EVC', description: 'Illustrative route: expert visit, then an authorised decision.',
      def: { stages: [evcStage(true, 0, 140), clar(260, 320), dec(260, 140), ...ends(520)],
        transitions: withRoot([evcDone('decision'), ...clarOut('decision'), ...decisionTransitions()], 'evc') } },
  ];
}

const CATEGORIES: [string, string, string][] = [
  ['NEW', 'New institution (demo)', 'scrutiny_evc'], ['EXT', 'Extension of approval (demo)', 'scrutiny_only'],
  ['INT', 'Increase in intake (demo)', 'evc_sac'], ['ADD', 'Addition of course (demo)', 'only_evc'],
];
const REQUIRED_DOCS: [string, string, number, string?, number?][] = [
  ['NEW', 'Land / Title Documents', 0], ['NEW', 'Lease Deed', 1, '[180,90,30]', 1], ['NEW', 'Fire Safety Certificate', 1], ['NEW', 'Trust / Society Registration', 0],
  ['EXT', 'Lease Deed', 1, '[180,90,30]', 1], ['EXT', 'Annual Self-Disclosure', 0],
  ['INT', 'Infrastructure Statement', 0], ['INT', 'Lease Deed', 1, '[180,90,30]', 1],
  ['ADD', 'Infrastructure Statement', 0], ['ADD', 'Faculty List', 0],
];
const UT_TEMPLATES: [string, string, string, string, number][] = [
  ['NEW', 'Annual compliance undertaking', 'Submit the annual compliance statement for the first year of operation.', 'Signed compliance statement (PDF)', 90],
  ['NEW', 'Lease renewal undertaking', 'Submit the renewed lease deed before the existing lease expires.', 'Renewed lease deed (PDF)', 150],
  ['EXT', 'Annual compliance undertaking', 'Submit the annual compliance statement.', 'Signed compliance statement (PDF)', 120],
];
const RULES: [string, string, string | null, number, number, string, number | null, number][] = [
  // name, trigger, applies_to_role, level, after_days, recipient_role, repeat_every, max_repeats
  ['Stage overdue: notify Bureau', 'task_overdue', 'regional_officer', 1, 1, 'bureau_officer', null, 0],
  ['Stage overdue: notify competent authority', 'task_overdue', 'regional_officer', 2, 7, 'competent_authority', 7, 2],
  ['Institution response overdue: notify regional officer', 'task_overdue', 'institution', 1, 3, 'regional_officer', null, 0],
  ['Institution response overdue: notify Bureau', 'task_overdue', 'institution', 2, 14, 'bureau_officer', null, 0],
  ['Decision overdue: notify Bureau', 'task_overdue', 'competent_authority', 1, 3, 'bureau_officer', null, 0],
  ['SAC/SHC overdue: notify competent authority', 'task_overdue', 'bureau_officer', 1, 3, 'competent_authority', null, 0],
  ['EVC delay: notify regional officer', 'evc_overdue', null, 1, 1, 'regional_officer', null, 0],
  ['EVC delay: notify Bureau', 'evc_overdue', null, 2, 5, 'bureau_officer', 7, 2],
  ['Obligation overdue: notify regional officer', 'undertaking_overdue', null, 1, 1, 'regional_officer', null, 0],
  ['Obligation overdue: notify Bureau', 'undertaking_overdue', null, 2, 15, 'bureau_officer', null, 0],
  ['Document expired: notify regional officer', 'document_expired', null, 1, 1, 'regional_officer', null, 0],
  ['Document expired: notify Bureau', 'document_expired', null, 2, 30, 'bureau_officer', null, 0],
];
const INSTITUTIONS: [string, string, string][] = [
  ['Aravalli Institute of Engineering (Demo)', 'Jaipur', 'NR'], ['Himalaya College of Technology (Demo)', 'Dehradun', 'NR'],
  ['Kaveri School of Engineering (Demo)', 'Coimbatore', 'SR'], ['Sahyadri Technical Campus (Demo)', 'Mangaluru', 'SR'],
  ['Konkan Institute of Technology (Demo)', 'Pune', 'WR'], ['Narmada Polytechnic Institute (Demo)', 'Surat', 'WR'],
  ['Ganga Delta Engineering College (Demo)', 'Kolkata', 'ER'], ['Mahanadi Institute of Technology (Demo)', 'Bhubaneswar', 'ER'],
  ['Vindhya College of Engineering (Demo)', 'Bhopal', 'CR'], ['Chambal Technical Institute (Demo)', 'Gwalior', 'CR'],
];

export function seedBase(db: DB) {
  const now = clock.iso();
  db.transaction(() => {
    for (const [code, name] of REGIONS) db.prepare('INSERT INTO regions (code,name) VALUES (?,?)').run(code, name);
    for (const [k, v, d] of SETTINGS) db.prepare('INSERT INTO settings (key,value,description) VALUES (?,?,?)').run(k, v, d);
    for (const [e, t, b] of TEMPLATES) db.prepare('INSERT INTO notification_templates (event,title_tpl,body_tpl) VALUES (?,?,?)').run(e, t, b);
    for (const w of workflows()) {
      const wid = Number(db.prepare('INSERT INTO workflows (code,name,description) VALUES (?,?,?)').run(w.code, w.name, w.description).lastInsertRowid);
      const vid = Number(db.prepare('INSERT INTO workflow_versions (workflow_id,version,active,note,created_at) VALUES (?,1,1,?,?)').run(wid, 'Initial synthetic configuration', now).lastInsertRowid);
      insertDefinition(db, vid, w.def);
    }
    for (const [code, name, wf] of CATEGORIES)
      db.prepare('INSERT INTO application_categories (code,name,workflow_id) VALUES (?,?,(SELECT id FROM workflows WHERE code=?))').run(code, name, wf);
    for (const [c, t, e, rd, ar] of REQUIRED_DOCS) db.prepare('INSERT INTO document_requirements (category_code,doc_type,required,has_expiry,reminder_days,auto_renewal) VALUES (?,?,1,?,?,?)').run(c, t, e, rd ?? null, ar ?? 0);
    for (const [c, ct, d, ev, days] of UT_TEMPLATES) db.prepare('INSERT INTO undertaking_templates (category_code,condition_text,description,required_evidence,due_after_days) VALUES (?,?,?,?,?)').run(c, ct, d, ev, days);
    for (const r of RULES) db.prepare('INSERT INTO escalation_rules (name,trigger_type,applies_to_role,level,after_days,recipient_role,repeat_every_days,max_repeats) VALUES (?,?,?,?,?,?,?,?)').run(...r);
    for (const [code] of REGIONS) {
      const rid = (db.prepare('SELECT id FROM regions WHERE code=?').get(code) as any).id;
      for (const s of ['A', 'B']) db.prepare('INSERT INTO evc_committees (name,region_id) VALUES (?,?)').run(`Synthetic EVC panel ${code}-${s}`, rid);
    }
    audit(db, { actor: SYSTEM, type: 'system.seed_base', entity: 'system', entityId: 'config', next: { workflows: 4, categories: CATEGORIES.length } });
  })();
  ensureRegulatoryData(db);
  ensurePublicDataRegistry(db);
}

export function seedUsers(db: DB, password = config.demoPassword) {
  const hash = bcrypt.hashSync(password, 10);
  const now = clock.iso();
  const region = (code: string) => (db.prepare('SELECT id FROM regions WHERE code=?').get(code) as any).id as number;
  const add = (email: string, name: string, role: string, regionId: number | null, instId: number | null) =>
    db.prepare('INSERT INTO users (email,name,password_hash,role,region_id,institution_id,active,created_at,synthetic) VALUES (?,?,?,?,?,?,1,?,1)').run(email, name, hash, role, regionId, instId, now);
  db.transaction(() => {
    add('admin@demo.local', 'Anita Admin', 'admin', null, null);
    add('bureau@demo.local', 'Bhavesh Bureau', 'bureau_officer', null, null);
    add('authority@demo.local', 'Chitra Authority', 'competent_authority', null, null);
    const names: Record<string, string[]> = { NR: ['Neha Rawat', 'Nikhil Rana'], SR: ['Suresh Rao', 'Sowmya Iyer'], WR: ['Wasim Khan'], ER: ['Esha Roy'], CR: ['Chetan Rathore'] };
    for (const [code] of REGIONS) {
      const c = code.toLowerCase();
      (names[code] ?? []).forEach((n, i) => add(`ro${i ? i + 1 : ''}.${c}@demo.local`, n, 'regional_officer', region(code), null));
      add(`evc.${c}@demo.local`, `${code} EVC Coordinator`, 'evc_coordinator', region(code), null);
    }
    INSTITUTIONS.forEach(([name, city, rc], i) => {
      const id = Number(db.prepare('INSERT INTO institutions (name,city,region_id) VALUES (?,?,?)').run(name, city, region(rc)).lastInsertRowid);
      add(`inst${i + 1}@demo.local`, `Representative, ${name.replace(' (Demo)', '')}`, 'institution', region(rc), id);
      if (i === 9) add('inst10+bounce@demo.local', 'Second contact (simulated bouncing mailbox)', 'institution', region(rc), id);
    });
  })();
}

// ------------------------------------------------------------------------------------------------ engine-driven demo history
function rng(seed: number) { return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

export async function seedDemo(db: DB, opts: { quiet?: boolean } = {}) {
  setSynthetic(true);
  try { await seedDemoInner(db, opts); } finally { setSynthetic(false); }
}

async function seedDemoInner(db: DB, opts: { quiet?: boolean } = {}) {
  const realToday = istDate(new Date());
  const day = (ago: number) => addCalendarDays(realToday, -ago);
  const fut = (n: number) => addCalendarDays(realToday, n);
  const user = (where: string, ...p: any[]) => db.prepare(`SELECT id,email,name,role,region_id,institution_id,active FROM users WHERE ${where} ORDER BY id LIMIT 1`).get(...p) as User;
  const ro = (region: number) => user(`role='regional_officer' AND region_id=?`, region);
  const evcU = (region: number) => user(`role='evc_coordinator' AND region_id=?`, region);
  const authority = () => user(`role='competent_authority'`);
  const bureau = () => user(`role='bureau_officer'`);
  const instU = (instId: number) => user(`role='institution' AND institution_id=? AND email NOT LIKE '%+bounce%'`, instId);
  const instRow = (idx: number) => db.prepare('SELECT * FROM institutions ORDER BY id LIMIT 1 OFFSET ?').get(idx) as any;
  const ids: Record<string, number> = {};
  const events: { ago: number; order: number; run: () => void }[] = [];
  let order = 0;
  const on = (ago: number, run: () => void) => events.push({ ago, order: order++, run });
  const appRow = (k: string) => db.prepare('SELECT * FROM applications WHERE id=?').get(ids[k]) as any;
  const file = (label: string) => saveUpload({ originalname: `${label.replace(/\W+/g, ' ').trim()}.pdf`, buffer: placeholderPdf(label), size: placeholderPdf(label).length });

  // --- building blocks (all go through the same functions the API uses)
  const create = (key: string, instIdx: number, cat: string, title: string, ago: number, o: { lease?: number; fire?: number; submit?: boolean; verifyDocs?: boolean } = {}) => on(ago, () => {
    const inst = instRow(instIdx), u = instU(inst.id);
    const id = createApplication(db, u, { category_code: cat, title, summary: `Synthetic application for demonstration. ${title}` });
    ids[key] = id;
    for (const r of db.prepare('SELECT * FROM document_requirements WHERE category_code=? AND required=1').all(cat) as any[]) {
      const expiry = r.doc_type === 'Lease Deed' ? fut(o.lease ?? 400) : r.has_expiry ? fut(o.fire ?? 300) : null;
      addDocument(db, u, { application_id: id, doc_type: r.doc_type, reference_no: `SYN-${id}-${r.id}`, issue_date: day(ago + 365), expiry_date: expiry }, file(docName(r.doc_type)));
    }
    if (o.submit !== false) submitApplication(db, u, id);
  });
  const act = (key: string, ago: number, who: 'ro' | 'evc' | 'authority' | 'bureau' | 'inst', action: string, reason?: string) => on(ago, () => {
    const a = appRow(key);
    const u = who === 'ro' ? ro(a.region_id) : who === 'evc' ? evcU(a.region_id) : who === 'authority' ? authority() : who === 'bureau' ? bureau() : instU(a.institution_id);
    performTransition(db, u, a.id, action, { reason });
  });
  const scrutinise = (key: string, ago: number, next = 'complete_scrutiny', verify = true) => on(ago, () => {
    const a = appRow(key), u = ro(a.region_id);
    addObservation(db, u, a.id, 'Documents reviewed against the checklist. Observations recorded for the file (synthetic).');
    if (verify) for (const d of db.prepare('SELECT id FROM documents WHERE application_id=? AND is_current=1').all(a.id) as any[]) verifyDocument(db, u, d.id, 'verified', 'Checked (synthetic)');
    performTransition(db, u, a.id, next);
  });
  const schedule = (key: string, ago: number, visitInDays: number) => on(ago, () => {
    const a = appRow(key), e = db.prepare('SELECT * FROM evc_schedules WHERE application_id=? ORDER BY id DESC LIMIT 1').get(a.id) as any;
    const c = db.prepare('SELECT id FROM evc_committees WHERE region_id=? ORDER BY id LIMIT 1 OFFSET ?').get(a.region_id, a.id % 2) as any;
    scheduleEvc(db, evcU(a.region_id), e.id, { confirmed_date: addCalendarDays(clock.today(), visitInDays), committee_id: c.id });
  });
  const completeVisit = (key: string, ago: number) => on(ago, () => {
    const a = appRow(key), e = db.prepare('SELECT * FROM evc_schedules WHERE application_id=? ORDER BY id DESC LIMIT 1').get(a.id) as any;
    completeEvc(db, evcU(a.region_id), e.id, { visit_date: e.confirmed_date <= clock.today() ? e.confirmed_date : clock.today(), notes: 'Visit completed. Infrastructure and faculty verified against submissions (synthetic observations).' });
  });

  // --- 1. completed histories
  create('done_new', 0, 'NEW', 'Establishment of new engineering institute', 100, { lease: 6 });
  scrutinise('done_new', 95); schedule('done_new', 90, 5); completeVisit('done_new', 84); act('done_new', 80, 'authority', 'approve', 'Conditions of approval recorded (synthetic).');
  create('done_ext', 2, 'EXT', 'Extension of approval for academic year', 70, { lease: -12 });
  scrutinise('done_ext', 64); act('done_ext', 50, 'authority', 'approve');
  create('rej_int', 4, 'INT', 'Increase in intake: computer engineering', 60);
  scrutinise('rej_int', 57); schedule('rej_int', 55, 3); completeVisit('rej_int', 50);
  act('rej_int', 30, 'authority', 'reject', 'Infrastructure norms not met per synthetic review.');
  create('wd_ext', 6, 'EXT', 'Extension of approval (withdrawn)', 40);
  act('wd_ext', 35, 'ro', 'return', 'Lease deed page missing.'); act('wd_ext', 33, 'inst', 'withdraw', 'Institution withdrew the application.');

  // --- 2. open applications in different conditions
  create('scr_new1', 1, 'EXT', 'Extension of approval: ongoing', 3);
  create('scr_soon', 3, 'NEW', 'New institution: scrutiny due soon', 11);
  create('scr_over', 5, 'EXT', 'Extension of approval: scrutiny overdue', 30);
  create('scr_over2', 8, 'NEW', 'New institution: scrutiny slightly overdue', 17);
  create('clar_late', 7, 'NEW', 'New institution: awaiting institution response (late)', 22); act('clar_late', 13, 'ro', 'return', 'Fire safety certificate not legible. Upload a clear copy.');
  create('clar_ok', 9, 'EXT', 'Extension of approval: awaiting response', 10); act('clar_ok', 3, 'ro', 'return', 'Please clarify the self-disclosure figures.');
  create('resub', 0, 'EXT', 'Extension of approval: resubmitted', 25); act('resub', 18, 'ro', 'return', 'Annual self-disclosure incomplete.');
  act('resub', 15, 'inst', 'resubmit', 'Completed self-disclosure attached.');
  create('evc_soon', 2, 'NEW', 'New institution: EVC to be scheduled soon', 20); scrutinise('evc_soon', 8);
  create('evc_late', 4, 'NEW', 'New institution: EVC scheduling overdue', 30); scrutinise('evc_late', 20);
  create('evc_sched', 6, 'NEW', 'New institution: EVC scheduled', 25); scrutinise('evc_sched', 12); schedule('evc_sched', 5, 9);
  create('evc_missed', 8, 'INT', 'Increase in intake: visit not yet recorded', 25); scrutinise('evc_missed', 24); schedule('evc_missed', 22, 5);
  create('dec_wait', 1, 'NEW', 'New institution: awaiting decision', 20, { lease: 25 }); scrutinise('dec_wait', 17); schedule('dec_wait', 14, 2); completeVisit('dec_wait', 10);
  create('sac', 3, 'SITE', 'Change of site: at SAC/SHC', 40); schedule('sac', 36, 3); completeVisit('sac', 30);
  create('dec_late', 5, 'ADD', 'Addition of course: decision overdue', 35); schedule('dec_late', 31, 3); completeVisit('dec_late', 22);
  create('draft1', 7, 'EXT', 'Extension of approval: draft in preparation', 4, { submit: false });
  on(2, () => { createApplication(db, instU(instRow(9).id), { category_code: 'NEW', title: 'New institution: empty draft' }); });

  // --- 3. extra volume with a deterministic pattern, so charts have something to show
  const rand = rng(2026);
  const cats = ['NEW', 'EXT', 'INT', 'ADD'];
  for (let i = 0; i < 18; i++) {
    const cat = cats[i % 4], start = 2 + Math.floor(rand() * 26), inst = Math.floor(rand() * 10), k = `x${i}`;
    create(k, inst, cat, `${['Expansion', 'Renewal', 'Extension', 'New course', 'Intake change'][i % 5]} request ${i + 1}`, start);
    const r = rand();
    if (r < 0.35 && ['NEW', 'EXT', 'INT'].includes(cat) && start > 9) scrutinise(k, start - 8 - Math.floor(rand() * 3));
    else if (r < 0.5 && cat === 'ADD' && start > 8) schedule(k, start - 4, 6);
  }

  // --- 4. compliance obligations in every state
  const und = (key: string, instIdx: number, ago: number, cond: string, dueIn: number) => on(ago, () => {
    const inst = instRow(instIdx);
    ids[key] = createUndertaking(db, ro(inst.region_id), { institution_id: inst.id, condition_text: cond, description: `${cond} (synthetic obligation).`, required_evidence: 'Signed statement with supporting document (PDF)', due_date: addCalendarDays(realToday, dueIn) });
  });
  const evidence = (key: string, ago: number) => on(ago, () => {
    const u = db.prepare('SELECT * FROM undertakings WHERE id=?').get(ids[key]) as any;
    submitEvidence(db, instU(u.institution_id), u.id, 'Evidence enclosed for verification (synthetic).', file('Compliance Submission Report'));
  });
  const review = (key: string, ago: number, d: 'begin_review' | 'verify' | 'return', note?: string) => on(ago, () => {
    const u = db.prepare('SELECT * FROM undertakings WHERE id=?').get(ids[key]) as any;
    reviewUndertaking(db, ro(u.region_id), u.id, d, note);
  });
  und('u_up', 0, 20, 'Submit audited accounts', 20);
  und('u_soon', 3, 25, 'Submit faculty qualification statement', 3);
  und('u_over', 5, 40, 'Submit fire-safety inspection report', -6);
  und('u_sub', 2, 15, 'Submit library resources statement', 10); evidence('u_sub', 4);
  und('u_rev', 4, 18, 'Submit laboratory commissioning report', 12); evidence('u_rev', 6); review('u_rev', 3, 'begin_review');
  und('u_ret', 6, 30, 'Submit student grievance policy', 9); evidence('u_ret', 10); review('u_ret', 7, 'return', 'The policy copy is not signed. Upload the signed version.');
  und('u_ok', 7, 35, 'Submit anti-ragging undertaking', 5); evidence('u_ok', 15); review('u_ok', 12, 'verify', 'Evidence is complete (synthetic).');

  // --- 5. a renewed lease: the old version stays traceable
  on(10, () => {
    const d = db.prepare(`SELECT * FROM documents WHERE application_id=? AND doc_type='Lease Deed' AND is_current=1`).get(ids['dec_wait']) as any;
    addDocument(db, instU(d.institution_id), { renew_of: d.id, reference_no: `${d.reference_no}-R1`, issue_date: day(10), expiry_date: fut(900) }, file('Renewed Lease Agreement'));
  });

  // --- replay the history on a simulated clock
  const oldest = Math.max(...events.map(e => e.ago));
  const log = opts.quiet ? () => {} : console.log;
  for (let ago = oldest; ago >= 0; ago--) {
    clock.set(atIstMorning(day(ago)));
    for (const e of events.filter(x => x.ago === ago).sort((a, b) => a.order - b.order)) {
      try { e.run(); } catch (err: any) { log(`seed step failed (${ago}d ago): ${err.message}`); throw err; }
    }
    await runJobs(db, 'seed');
  }
  clock.set(null);
  // Today (real clock): one more pass so reminders and escalations reflect the current date.
  await runJobs(db, 'seed');
  audit(db, { actor: SYSTEM, type: 'system.seed_demo', entity: 'system', entityId: 'demo', next: { applications: Object.keys(ids).length } });
}

// Wipes and re-seeds. Audit triggers are dropped and recreated because the table is otherwise append-only.
export async function resetDemo(db: DB) {
  const triggers = db.prepare(`SELECT sql FROM sqlite_master WHERE type='trigger' AND tbl_name='audit_log'`).all() as any[];
  db.pragma('foreign_keys = OFF');
  const tables = (db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name NOT IN ('schema_migrations') AND name NOT LIKE 'sqlite_%' AND name NOT LIKE 'reference_fts_%'`).all() as any[]).map(r => r.name);
  db.transaction(() => {
    db.exec('DROP TRIGGER IF EXISTS audit_log_no_update; DROP TRIGGER IF EXISTS audit_log_no_delete;');
    for (const t of tables) db.exec(`DELETE FROM ${t}`);
    for (const t of triggers) db.exec(t.sql);
  })();
  db.pragma('foreign_keys = ON');
  clock.set(null);
  seedBase(db); seedUsers(db); await seedDemo(db, { quiet: true });
  if (config.seedApplications > 0) await generateApplications(db, { seed: config.seed, count: config.seedApplications, quiet: true });
}
