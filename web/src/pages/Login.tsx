import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useAuth } from '../lib/auth';
import { Button, ErrorBox, Field, Input } from '../components/ui';

const schema = z.object({ email: z.string().min(1, 'Enter your email').email('Enter a valid email address'), password: z.string().min(1, 'Enter your password') });
type F = z.infer<typeof schema>;

const DEMO = [
  ['Institution', 'inst1@demo.local'], ['Regional officer', 'ro.nr@demo.local'], ['Bureau officer', 'bureau@demo.local'],
  ['EVC coordinator', 'evc.nr@demo.local'], ['Competent authority', 'authority@demo.local'], ['Administrator', 'admin@demo.local'],
];

export default function Login() {
  const { login } = useAuth();
  const [error, setError] = useState<unknown>(null);
  const { register, handleSubmit, setValue, formState: { errors, isSubmitting } } = useForm<F>({ resolver: zodResolver(schema), defaultValues: { email: '', password: '' } });
  const submit = handleSubmit(async v => { setError(null); try { await login(v.email, v.password); } catch (e) { setError(e); } });
  return (
    <div className="grid min-h-full lg:grid-cols-[1.1fr_1fr]">
      <section className="flex flex-col justify-between bg-ink p-8 text-white sm:p-12">
        <div><p className="text-xl font-semibold">AICTE ApprovalFlow</p><p className="text-sm text-[#9fb3cc]">Demonstration prototype for SIH 2026, problem statement PS4</p></div>
        <div className="my-10 max-w-xl">
          <h1 className="text-[32px] font-semibold leading-tight sm:text-[40px]">Every application has a stage, an owner and a deadline.</h1>
          <p className="mt-4 text-[#c5d3e6]">Route applications through configurable approval stages, schedule expert visits, track undertakings and document validity, and escalate overdue work. Every action leaves an audit record.</p>
        </div>
        <p className="text-[13px] text-[#9fb3cc]">All data on this site is synthetic. This is not an official AICTE system and is not connected to one.</p>
      </section>
      <section className="flex items-center justify-center p-6 sm:p-12">
        <div className="w-full max-w-sm space-y-5">
          <div><h2 className="text-xl font-semibold">Sign in</h2><p className="text-muted">Use an account for your role.</p></div>
          <form onSubmit={submit} className="space-y-4" noValidate>
            <Field label="Email" error={errors.email?.message}>{(id, d) => <Input id={id} aria-describedby={d} aria-invalid={!!errors.email} type="email" autoComplete="username" {...register('email')} />}</Field>
            <Field label="Password" error={errors.password?.message}>{(id, d) => <Input id={id} aria-describedby={d} aria-invalid={!!errors.password} type="password" autoComplete="current-password" {...register('password')} />}</Field>
            {!!error && <ErrorBox error={error} />}
            <Button type="submit" variant="primary" className="w-full" busy={isSubmitting}>Sign in</Button>
          </form>
          <div className="rounded-lg border border-line bg-white p-4">
            <p className="font-medium">Local demo accounts</p>
            <p className="mb-2 text-[13px] text-muted">Synthetic users for a local environment. Password for all: <code className="rounded bg-paper px-1">Demo@1234</code></p>
            <div className="flex flex-wrap gap-1.5">
              {DEMO.map(([label, email]) => <button key={email} type="button" onClick={() => { setValue('email', email); setValue('password', 'Demo@1234'); }} className="rounded-full border border-line px-2.5 py-1 text-[13px] hover:bg-paper">{label}</button>)}
            </div>
          </div>
        </div>
      </section>
    </div>);
}
