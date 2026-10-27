import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useAuth } from '../lib/auth';
import { Button, ErrorBox, Field, Input } from '../components/ui';
import { ShieldCheck, Clock, GitBranch, ArrowRight } from 'lucide-react';
import { LanguageSwitcher } from '../i18n/LanguageSwitcher';
import { DEMO_ROLES } from './Landing';
import { usePageTitle } from '../lib/hooks';

const schema = z.object({ email: z.string().min(1, 'Enter your email').email('Enter a valid email address'), password: z.string().min(1, 'Enter your password') });
type F = z.infer<typeof schema>;


export default function Login() {
  const { login } = useAuth();
  usePageTitle('Login');
  const [error, setError] = useState<unknown>(null);
  const [sp] = useSearchParams(); const preset = DEMO_ROLES.find(r => r.slug === sp.get('role'));     // arrives from "Try as this role" on the front page
  const [picked, setPicked] = useState<string | null>(preset?.label ?? null);
  const { register, handleSubmit, setValue, formState: { errors, isSubmitting } } = useForm<F>({ resolver: zodResolver(schema), defaultValues: { email: preset?.email ?? '', password: preset ? 'Demo@1234' : '' } });
  const submit = handleSubmit(async v => { setError(null); try { await login(v.email, v.password); } catch (e) { setError(e); } });

  return (
    <div className="grid min-h-screen lg:grid-cols-[1.1fr_1fr] bg-[#0B1B3B]">
      {/* Left Hero Panel (Navy) */}
      <section className="relative hidden lg:flex flex-col justify-between bg-[#0B1B3B] p-12 text-white overflow-hidden border-r border-white/10">
        <div className="absolute inset-0 opacity-5 bg-[radial-gradient(#2F5BEA_1px,transparent_1px)] [background-size:16px_16px]" />

        <div className="relative z-10 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#2F5BEA] text-white font-bold text-lg shadow-sm">AF</div>
          <div>
            <p className="text-lg font-semibold tracking-tight text-white">AICTE ApprovalFlow</p>
            <p className="text-xs text-[#94A3B8]">Government Technology Portal · PS4</p>
          </div>
        </div>

        <div className="relative z-10 my-12 max-w-xl space-y-6">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-[#2F5BEA]/20 px-3 py-1 text-xs font-semibold text-[#60A5FA] border border-[#2F5BEA]/30">
            Civic Clarity Edition
          </span>
          <h1 className="text-3xl sm:text-[44px] font-semibold leading-tight text-white tracking-tight">
            Every application has a stage, an owner and a deadline.
          </h1>
          <p className="text-base text-[#C5D3E6] leading-relaxed">
            Route applications through configurable approval stages, schedule expert verification visits, track compliance undertakings, and automate escalation of overdue work with complete audit transparency.
          </p>

          <div className="grid grid-cols-1 gap-4 pt-4">
            <div className="flex items-start gap-3 rounded-xl bg-white/5 p-4 border border-white/10">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#2F5BEA]/20 text-[#60A5FA]">
                <GitBranch className="h-4 w-4" />
              </div>
              <div>
                <p className="font-medium text-white text-sm">Configurable Workflow Pipeline</p>
                <p className="text-xs text-[#94A3B8]">Standardised scrutiny, expert committee, and competent authority decisions.</p>
              </div>
            </div>
            <div className="flex items-start gap-3 rounded-xl bg-white/5 p-4 border border-white/10">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#F59E0B]/20 text-[#F59E0B]">
                <Clock className="h-4 w-4" />
              </div>
              <div>
                <p className="font-medium text-white text-sm">Automated Deadlines & Escalations</p>
                <p className="text-xs text-[#94A3B8]">Proactive tracking of lease validity, document renewals, and pending queues.</p>
              </div>
            </div>
            <div className="flex items-start gap-3 rounded-xl bg-white/5 p-4 border border-white/10">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#15803D]/20 text-[#4ADE80]">
                <ShieldCheck className="h-4 w-4" />
              </div>
              <div>
                <p className="font-medium text-white text-sm">Tamper-evident Audit Trail</p>
                <p className="text-xs text-[#94A3B8]">Every action, observation, and decision immutably logged and verifiable.</p>
              </div>
            </div>
          </div>
        </div>

        <div className="relative z-10 text-xs text-[#94A3B8] border-t border-white/10 pt-4 flex items-center justify-between">
          <span>All data on this site is synthetic for demonstration.</span>
          <span>SIH 2026 · PS4 Prototype</span>
        </div>
      </section>

      {/* Right Form Panel (White) */}
      <section className="flex items-center justify-center p-6 sm:p-12 bg-[#F5F7FB] lg:bg-white">
        <div className="w-full max-w-md space-y-6 rounded-[20px] bg-white p-8 shadow-xl border border-[#E2E8F0]">
          <div>
            <Link to="/" className="mb-3 inline-flex items-center gap-1 text-sm font-medium text-[#2449C7] hover:underline">← Back to home</Link>
            <div className="flex items-center justify-between gap-2 mb-4">
              <div className="flex lg:hidden items-center gap-2">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#2F5BEA] text-white font-bold text-sm">AF</div>
                <span className="font-semibold text-[#0F172A]">AICTE ApprovalFlow</span>
              </div>
              <div className="ml-auto">
                <LanguageSwitcher />
              </div>
            </div>
            <h2 className="text-2xl font-semibold text-[#0F172A] tracking-tight">Sign in to portal</h2>
            <p className="mt-1 text-sm text-[#475569]">Select a role below or enter credentials to sign in.</p>
          </div>

          <form onSubmit={submit} className="space-y-4" noValidate>
            <Field label="Email address" error={errors.email?.message}>
              {(id, d) => <Input id={id} aria-describedby={d} aria-invalid={!!errors.email} type="email" autoComplete="username" placeholder="name@demo.local" {...register('email')} />}
            </Field>

            <Field label="Password" error={errors.password?.message}>
              {(id, d) => <Input id={id} aria-describedby={d} aria-invalid={!!errors.password} type="password" autoComplete="current-password" placeholder="••••••••" {...register('password')} />}
            </Field>

            {picked && <p role="status" className="rounded-lg bg-[#EEF3FF] px-3 py-2 text-sm text-[#1E3A8A]">Details filled in for <b>{picked}</b>. Press <b>Sign in</b> to continue.</p>}
            {!!error && <ErrorBox error={error} />}

            <Button type="submit" variant="primary" className="w-full h-11 text-base font-medium shadow-sm" busy={isSubmitting}>
              Sign in <ArrowRight className="ml-1.5 h-4 w-4" />
            </Button>
          </form>

          {/* Role selector cards */}
          <div className="rounded-[14px] border border-[#E2E8F0] bg-[#F5F7FB] p-4 space-y-3">
            <div>
              <p className="font-semibold text-xs uppercase tracking-wider text-[#475569]">Quick demo accounts</p>
              <p className="text-[12px] text-[#566579]">Click any role to autofill. Password for all: <code className="rounded bg-white px-1.5 py-0.5 text-[#0F172A] font-semibold border border-[#E2E8F0]">Demo@1234</code></p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {DEMO_ROLES.map(r => (
                <button
                  key={r.email}
                  type="button"
                  onClick={() => { setValue('email', r.email); setValue('password', 'Demo@1234'); setPicked(r.label); }}
                  className="flex flex-col text-left rounded-[10px] border border-[#E2E8F0] bg-white p-2.5 hover:border-[#2F5BEA] hover:bg-[#EEF3FF]/40 transition-all text-xs group shadow-xs">
                  <span className="font-semibold text-[#0F172A] group-hover:text-[#2F5BEA]">{r.label}</span>
                  <span className="text-[11px] leading-snug text-[#566579]">{r.desc}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="text-center text-xs text-[#566579] lg:hidden pt-2 border-t border-[#E2E8F0]">
            Synthetic data only. Not connected to any AICTE system.
          </div>
        </div>
      </section>
    </div>
  );
}
