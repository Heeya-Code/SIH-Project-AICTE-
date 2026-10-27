import { Link } from 'react-router-dom';
import { ArrowRight, CalendarClock, CheckCircle2, ClipboardCheck, FileSearch, Gavel, GitBranch, Landmark, LogIn, ScrollText, ShieldCheck, Users, Clock, Bell, Building2, Settings, UserCheck } from 'lucide-react';
import { LanguageSwitcher } from '../i18n/LanguageSwitcher';
import { usePageTitle } from '../lib/hooks';

export const DEMO_ROLES = [
  { slug: 'institution', label: 'Institution', email: 'inst1@demo.local', icon: Building2, desc: 'Submit applications and documents', sees: 'A ranked list of what to do next, a readiness checklist, and every deadline.' },
  { slug: 'regional-officer', label: 'Regional officer', email: 'ro.nr@demo.local', icon: ClipboardCheck, desc: 'Review and scrutiny workflow', sees: 'Cases that need attention first, a document verification queue, and overdue work.' },
  { slug: 'evc-coordinator', label: 'EVC coordinator', email: 'evc.nr@demo.local', icon: CalendarClock, desc: 'Expert committee scheduling', sees: 'Visits to schedule, conflict-free date suggestions, and reports still owed.' },
  { slug: 'bureau-officer', label: 'Bureau officer', email: 'bureau@demo.local', icon: Users, desc: 'Pendency and oversight', sees: 'Where work is piling up, who it is waiting on, and escalations.' },
  { slug: 'competent-authority', label: 'Competent authority', email: 'authority@demo.local', icon: Gavel, desc: 'Final decisions and approvals', sees: 'Cases waiting for a decision with the full summary, findings and audit trail.' },
  { slug: 'administrator', label: 'Administrator', email: 'admin@demo.local', icon: Settings, desc: 'System configuration', sees: 'Workflow versions, users and roles, imports and review of regulatory rules.' },
] as const;

const STEPS = [
  { icon: FileSearch, title: 'Apply', who: 'Institution', text: 'Start an application, upload the required documents and review before sending. Nothing leaves until you confirm.' },
  { icon: ClipboardCheck, title: 'Scrutiny', who: 'Regional officer', text: 'Documents are verified and observations recorded. Every case has a named owner and a deadline.' },
  { icon: CalendarClock, title: 'Expert visit', who: 'EVC coordinator', text: 'A committee and date are chosen without clashes. The case waits for the visit report.' },
  { icon: Gavel, title: 'Decision', who: 'Competent authority', text: 'Only the authorised person records the decision, with the whole history in front of them.' },
];

const POINTS = [
  { icon: Clock, title: 'Deadlines you can see', text: 'Each stage has a deadline, and the reason an item is urgent is always shown.' },
  { icon: Bell, title: 'Reminders and escalation', text: 'Reminders go out ahead of deadlines. Overdue work escalates by published rules.' },
  { icon: ShieldCheck, title: 'People decide', text: 'The software routes, reminds and records. Verification and decisions stay with authorised officers.' },
  { icon: ScrollText, title: 'A record nobody can quietly edit', text: 'Every action is written to a tamper-evident audit trail that can be checked at any time.' },
  { icon: GitBranch, title: 'Workflows you can change', text: 'Four ready-made workflows, versioned, so a change never disrupts cases already in progress.' },
  { icon: Landmark, title: 'Grounded in the handbook', text: 'Rules show what they rest on and how well each is verified. Unverified rules are never presented as fact.' },
];

export default function Landing() {
  usePageTitle('Welcome');
  return (
    <div className="min-h-screen bg-white text-[#0F172A]">
      <a href="#content" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-white focus:px-3 focus:py-2">Skip to content</a>

      <header className="relative z-20 bg-[#0B1B3B] text-white">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-3 px-4 sm:px-6">
          <Link to="/" className="flex items-center gap-3">
            <span aria-hidden className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#2F5BEA] text-base font-bold">AF</span>
            <span className="leading-tight"><span className="block text-base font-semibold">ApprovalFlow</span><span className="block text-[11px] text-[#B4C4D9]">Demonstration prototype</span></span>
          </Link>
          <nav aria-label="Page sections" className="hidden items-center gap-6 text-sm text-[#D3DEEC] md:flex">
            <a href="#how" className="hover:text-white">How it works</a><a href="#roles" className="hover:text-white">Try a role</a><a href="#trust" className="hover:text-white">Why it is trustworthy</a>
          </nav>
          <div className="flex items-center gap-2">
            <LanguageSwitcher />
            <Link to="/login" className="inline-flex min-h-[40px] items-center gap-2 rounded-lg bg-white px-4 py-2 text-sm font-semibold text-[#0B1B3B] shadow-sm hover:bg-[#EEF3FF]"><LogIn className="h-4 w-4" aria-hidden />Login</Link>
          </div>
        </div>
      </header>

      <main id="content">
        {/* ---------------------------------------------------------------- hero */}
        <section className="landing-hero relative overflow-hidden bg-[#0B1B3B] text-white">
          <div aria-hidden className="absolute inset-0 opacity-[0.07] [background-image:radial-gradient(#fff_1px,transparent_1px)] [background-size:18px_18px]" />
          <div aria-hidden className="absolute -right-24 -top-24 h-96 w-96 rounded-full bg-[#2F5BEA]/30 blur-3xl" />
          <div className="relative mx-auto grid max-w-6xl items-center gap-10 px-4 py-14 sm:px-6 lg:grid-cols-[1.05fr_1fr] lg:py-20">
            <div>
              <p className="inline-flex items-center gap-2 rounded-full border border-[#2F5BEA]/40 bg-[#2F5BEA]/20 px-3 py-1 text-xs font-semibold text-[#9CC0FF]"><span className="h-1.5 w-1.5 rounded-full bg-[#F59E0B]" aria-hidden />Smart India Hackathon 2026 · Problem statement 4</p>
              <h1 className="landing-title mt-5 text-4xl font-semibold leading-[1.1] tracking-tight sm:text-5xl">Every application has a stage, an owner and a deadline.</h1>
              <p className="mt-5 max-w-xl text-lg leading-relaxed text-[#C5D3E6]">One place to route approvals, schedule expert visits, track compliance and chase what is overdue, with a complete record of who did what.</p>
              <div className="mt-8 flex flex-wrap items-center gap-3">
                <Link to="/login" className="inline-flex min-h-[48px] items-center gap-2 rounded-xl bg-[#2F5BEA] px-6 py-3 text-base font-semibold text-white shadow-lg hover:bg-[#2449C7]">Login<ArrowRight className="h-4 w-4" aria-hidden /></Link>
                <a href="#roles" className="inline-flex min-h-[48px] items-center rounded-xl border border-white/25 px-5 py-3 text-base font-medium text-white hover:bg-white/10">Try it as a role</a>
              </div>
              <ul className="mt-8 flex flex-wrap gap-x-6 gap-y-2 text-sm text-[#C5D3E6]">
                {['6 roles', '4 ready-made workflows', 'Full audit trail', '10 Indian languages'].map(t => <li key={t} className="flex items-center gap-1.5"><CheckCircle2 className="h-4 w-4 text-[#4ADE80]" aria-hidden />{t}</li>)}
              </ul>
            </div>

            {/* An illustration of the product, labelled as such. It contains no real figures. */}
            <figure className="relative" aria-label="Illustration of a case card">
              <div className="rounded-2xl border border-white/15 bg-white p-5 text-[#0F172A] shadow-2xl">
                <div className="flex items-center justify-between gap-3">
                  <div><p className="text-xs font-medium text-[#475569]">Case</p><p className="text-lg font-semibold">AF-2026-00127</p></div>
                  <span className="rounded-full bg-[#EEF3FF] px-3 py-1 text-xs font-semibold text-[#2449C7]">In progress</span>
                </div>
                <ol className="mt-4 flex items-center gap-1.5 text-[11px] font-medium" aria-label="Stages">
                  {[['Scrutiny', 'done'], ['Expert visit', 'now'], ['Decision', 'todo']].map(([n, s], i) => (
                    <li key={n} className="flex flex-1 items-center gap-1.5"><span className={`flex-1 rounded-full px-2 py-1.5 text-center ${s === 'done' ? 'bg-[#E8F7EE] text-[#15803D]' : s === 'now' ? 'bg-[#2F5BEA] text-white' : 'bg-[#EEF2F7] text-[#475569]'}`}>{s === 'done' ? '✓ ' : ''}{n}</span>{i < 2 && <span aria-hidden className="text-[#94A3B8]">›</span>}</li>))}
                </ol>
                <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
                  <div className="rounded-lg bg-[#F5F7FB] p-3"><dt className="text-xs text-[#475569]">Waiting on</dt><dd className="font-semibold">EVC coordinator</dd></div>
                  <div className="rounded-lg bg-[#FFF4E0] p-3"><dt className="text-xs text-[#92400E]">Deadline</dt><dd className="font-semibold text-[#92400E]">3 days left</dd></div>
                </dl>
                <p className="mt-4 flex items-start gap-2 rounded-lg border border-[#E2E8F0] p-3 text-sm"><UserCheck className="mt-0.5 h-4 w-4 shrink-0 text-[#2F5BEA]" aria-hidden /><span><b>Next:</b> schedule the visit, then record the report. The case moves on by itself.</span></p>
              </div>
              <figcaption className="mt-3 text-center text-xs text-[#9FB3CC]">Illustration only. The demo uses synthetic data.</figcaption>
            </figure>
          </div>
        </section>

        {/* ---------------------------------------------------------------- how it works */}
        <section id="how" className="mx-auto max-w-6xl scroll-mt-4 px-4 py-16 sm:px-6">
          <h2 className="text-3xl font-semibold tracking-tight">From application to decision, in four clear steps</h2>
          <p className="mt-2 max-w-2xl text-[#475569]">At every step you can see who has the case, what they need to do, and when it is due.</p>
          <ol className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {STEPS.map((s, i) => (
              <li key={s.title} className="landing-step relative rounded-2xl border border-[#E2E8F0] bg-white p-5 shadow-sm">
                <span className="absolute -top-3 left-5 rounded-full bg-[#0B1B3B] px-2.5 py-0.5 text-xs font-semibold text-white">Step {i + 1}</span>
                <span className="mt-2 flex h-11 w-11 items-center justify-center rounded-xl bg-[#EEF3FF] text-[#2F5BEA]"><s.icon className="h-5 w-5" aria-hidden /></span>
                <h3 className="mt-4 text-lg font-semibold">{s.title}</h3><p className="text-xs font-medium text-[#2449C7]">{s.who}</p>
                <p className="mt-2 text-sm leading-relaxed text-[#475569]">{s.text}</p>
              </li>))}
          </ol>
        </section>

        {/* ---------------------------------------------------------------- roles */}
        <section id="roles" className="scroll-mt-4 bg-[#F5F7FB] py-16">
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
            <h2 className="text-3xl font-semibold tracking-tight">Try it as the person who would use it</h2>
            <p className="mt-2 max-w-2xl text-[#475569]">Each role sees only its own work. Choose one and the login form is filled in for you. No account is needed: every account here is a demo account.</p>
            <ul className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {DEMO_ROLES.map(r => (
                <li key={r.slug}>
                  <Link to={`/login?role=${r.slug}`} className="landing-role group flex h-full flex-col rounded-2xl border border-[#E2E8F0] bg-white p-5 shadow-sm transition hover:border-[#2F5BEA] hover:shadow-md">
                    <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#EEF3FF] text-[#2F5BEA] group-hover:bg-[#2F5BEA] group-hover:text-white"><r.icon className="h-5 w-5" aria-hidden /></span>
                    <h3 className="mt-4 text-lg font-semibold">{r.label}</h3><p className="text-sm text-[#475569]">{r.desc}</p>
                    <p className="mt-3 flex-1 text-sm leading-relaxed text-[#475569]"><span className="font-medium text-[#0F172A]">You will see: </span>{r.sees}</p>
                    <span className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-[#2449C7]">Try as {r.label.toLowerCase()}<ArrowRight className="h-4 w-4 transition group-hover:translate-x-0.5" aria-hidden /></span>
                  </Link>
                </li>))}
            </ul>
          </div>
        </section>

        {/* ---------------------------------------------------------------- trust */}
        <section id="trust" className="mx-auto max-w-6xl scroll-mt-4 px-4 py-16 sm:px-6">
          <h2 className="text-3xl font-semibold tracking-tight">Built so the process can be checked</h2>
          <p className="mt-2 max-w-2xl text-[#475569]">Speed matters less than being able to show what happened and why.</p>
          <ul className="mt-10 grid gap-x-8 gap-y-7 sm:grid-cols-2 lg:grid-cols-3">
            {POINTS.map(p => (
              <li key={p.title} className="flex gap-4"><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[#0B1B3B] text-white"><p.icon className="h-5 w-5" aria-hidden /></span>
                <div><h3 className="font-semibold">{p.title}</h3><p className="mt-1 text-sm leading-relaxed text-[#475569]">{p.text}</p></div></li>))}
          </ul>
          <div className="mt-12 flex flex-col items-start justify-between gap-5 rounded-2xl bg-[#0B1B3B] p-8 text-white sm:flex-row sm:items-center">
            <div><h3 className="text-2xl font-semibold">Ready to look around?</h3><p className="mt-1 text-[#C5D3E6]">Log in with any demo role. It takes one click.</p></div>
            <Link to="/login" className="inline-flex min-h-[48px] items-center gap-2 rounded-xl bg-white px-6 py-3 text-base font-semibold text-[#0B1B3B] hover:bg-[#EEF3FF]">Login<ArrowRight className="h-4 w-4" aria-hidden /></Link>
          </div>
        </section>
      </main>

      <footer className="border-t border-[#E2E8F0] bg-[#F5F7FB] py-6">
        <div className="mx-auto flex max-w-6xl flex-col gap-1 px-4 text-xs text-[#475569] sm:px-6">
          <p><b>Demonstration prototype.</b> All records are synthetic. It is not connected to any AICTE system and is not an official AICTE service.</p>
          <p>Reminders and deadlines shown are sample values for the demo, not AICTE rules.</p>
        </div>
      </footer>
    </div>
  );
}
