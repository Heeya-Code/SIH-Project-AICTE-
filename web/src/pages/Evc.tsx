import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { CalendarDays, List, Sparkles } from 'lucide-react';
import { api, errMsg, qstr } from '../lib/api';
import { useAuth } from '../lib/auth';
import { fmtDate, plural, pretty, toneFor } from '../lib/format';
import { Badge, Button, Card, Empty, ErrorBox, Field, Input, Modal, PageHeader, Pager, Query, Select, Table, Td, Textarea, Th, useToast } from '../components/ui';
import { MonthGrid, monthRange, type CalEvent } from '../components/MonthGrid';

const slot = z.object({ confirmed_date: z.string().min(1, 'Choose a date'), committee_id: z.string().min(1, 'Choose a committee'), reason: z.string().optional() });
type SF = z.infer<typeof slot>;

function SlotDialog({ evc, mode, onClose }: { evc: any; mode: 'schedule' | 'reschedule'; onClose: () => void }) {
  const qc = useQueryClient(); const toast = useToast(); const [err, setErr] = useState<unknown>(null); const [busy, setBusy] = useState(false);
  const committees = useQuery({ queryKey: ['committees'], queryFn: () => api<any[]>('/evc/committees') });
  const sugg = useQuery({ queryKey: ['evc-sugg', evc.id], queryFn: () => api<any>(`/evc/${evc.id}/suggestions`) });
  const schema = mode === 'reschedule' ? slot.extend({ reason: z.string().trim().min(3, 'A reason is required to reschedule') }) : slot;
  const { register, handleSubmit, setValue, formState: { errors } } = useForm<SF>({ resolver: zodResolver(schema), defaultValues: { confirmed_date: evc.confirmed_date ?? '', committee_id: evc.committee_id ? String(evc.committee_id) : '', reason: '' } });
  const go = handleSubmit(async v => {
    setBusy(true); setErr(null);
    try { await api(`/evc/${evc.id}/${mode}`, { body: { confirmed_date: v.confirmed_date, committee_id: Number(v.committee_id), reason: v.reason || undefined } }); toast.ok(mode === 'schedule' ? 'Visit scheduled' : 'Visit rescheduled'); qc.invalidateQueries(); onClose(); }
    catch (e) { setErr(e); } finally { setBusy(false); }
  });
  return (
    <Modal title={`${mode === 'schedule' ? 'Schedule' : 'Reschedule'} EVC visit for ${evc.ref}`} onClose={onClose} wide footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" busy={busy} onClick={go}>{mode === 'schedule' ? 'Schedule visit' : 'Reschedule visit'}</Button></>}>
      <p className="text-muted">{evc.institution_name}. Schedule by <b>{fmtDate(evc.schedule_deadline)}</b>; complete by <b>{fmtDate(evc.completion_deadline)}</b>.</p>
      <div className="rounded-md bg-teal-soft p-3">
        <p className="mb-1.5 flex items-center gap-1.5 font-medium text-[#0b6769]"><Sparkles className="h-4 w-4" aria-hidden />Suggested slots (synthetic committee calendar)</p>
        <Query q={sugg}>{(d: any) => d.suggestions.length === 0 ? <p>No free slots before the completion deadline.</p> : (
          <ul className="space-y-1.5">{d.suggestions.slice(0, 4).map((s: any, i: number) => (
            <li key={i} className="flex flex-wrap items-center justify-between gap-2 rounded bg-white p-2"><div><p className="font-medium">{fmtDate(s.date)}, {s.committee}</p><p className="text-[13px] text-muted">{s.reasoning.slice(0, 3).join('. ')}.</p></div>
              <Button size="sm" onClick={() => { setValue('confirmed_date', s.date); setValue('committee_id', String(s.committee_id)); }}>Use this slot</Button></li>))}</ul>)}</Query>
      </div>
      <form onSubmit={go} className="grid gap-4 sm:grid-cols-2" noValidate>
        <Field label="Visit date" required error={errors.confirmed_date?.message}>{(id, d) => <Input id={id} aria-describedby={d} aria-invalid={!!errors.confirmed_date} type="date" {...register('confirmed_date')} />}</Field>
        <Field label="Committee" required error={errors.committee_id?.message}>{(id, d) => <Select id={id} aria-describedby={d} aria-invalid={!!errors.committee_id} {...register('committee_id')}><option value="">Choose…</option>{(committees.data ?? []).filter((c: any) => c.region_id === evc.region_id).map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select>}</Field>
        <div className="sm:col-span-2"><Field label={mode === 'reschedule' ? 'Reason for rescheduling' : 'Note (optional)'} required={mode === 'reschedule'} error={errors.reason?.message}>{(id, d) => <Textarea id={id} aria-describedby={d} rows={2} {...register('reason')} />}</Field></div>
      </form>
      {!!err && <ErrorBox error={err} />}
    </Modal>);
}

function CompleteDialog({ evc, onClose }: { evc: any; onClose: () => void }) {
  const qc = useQueryClient(); const toast = useToast(); const [err, setErr] = useState<unknown>(null); const [busy, setBusy] = useState(false);
  const { register, handleSubmit, formState: { errors } } = useForm<{ visit_date: string; notes: string }>({ resolver: zodResolver(z.object({ visit_date: z.string().min(1, 'Enter the visit date'), notes: z.string().trim().min(3, 'Add the visit observations') })), defaultValues: { visit_date: evc.confirmed_date ?? '', notes: '' } });
  const go = handleSubmit(async v => { setBusy(true); setErr(null); try { const r = await api(`/evc/${evc.id}/complete`, { body: v }); toast.ok(r.advanced ? 'Visit recorded. The application moved to its next stage.' : 'Visit recorded'); qc.invalidateQueries(); onClose(); } catch (e) { setErr(e); } finally { setBusy(false); } });
  return (
    <Modal title={`Record completed visit for ${evc.ref}`} onClose={onClose} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" busy={busy} onClick={go}>Record completion</Button></>}>
      <form onSubmit={go} className="space-y-4" noValidate>
        <Field label="Visit date" required error={errors.visit_date?.message}>{(id, d) => <Input id={id} aria-describedby={d} type="date" {...register('visit_date')} />}</Field>
        <Field label="Visit observations" required error={errors.notes?.message}>{(id, d) => <Textarea id={id} aria-describedby={d} rows={4} {...register('notes')} />}</Field>
      </form>
      <p className="text-[13px] text-muted">Recording completion satisfies the workflow requirement. The application then moves on automatically if the workflow is configured that way.</p>
      {!!err && <ErrorBox error={err} />}
    </Modal>);
}

export default function Evc() {
  const { user } = useAuth(); const [sp, setSp] = useSearchParams(); const toast = useToast();
  const status = sp.get('status') ?? '', page = Number(sp.get('page') ?? 1), view = sp.get('view') ?? 'list';
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const [dlg, setDlg] = useState<{ kind: string; evc: any } | null>(null);
  const set = (p: Record<string, string>) => { const n = new URLSearchParams(sp); for (const [k, v] of Object.entries(p)) v ? n.set(k, v) : n.delete(k); if (!('page' in p)) n.delete('page'); setSp(n); };
  const q = useQuery({ queryKey: ['evc', status, page, view], queryFn: () => api<any>(`/evc${qstr({ status, page, pageSize: view === 'calendar' ? 100 : 15 })}`) });
  const cal = useQuery({ queryKey: ['evc-cal', month], enabled: view === 'calendar', queryFn: () => api<any[]>(`/calendar${qstr({ ...monthRange(month), types: 'evc' })}`) });
  const lookups = useQuery({ queryKey: ['lookups'], queryFn: () => api<any>('/lookups') });
  const coordinator = user!.role === 'evc_coordinator';
  const events: CalEvent[] = (cal.data ?? []).map(e => ({ date: e.date, title: e.title, tone: e.status === 'overdue' ? 'bad' : e.status === 'queued' ? 'warn' : e.status === 'completed' ? 'good' : 'brand', link: '/evc' }));
  return (
    <>
      <PageHeader title="EVC scheduling" subtitle="Applications that reach an Expert Visit Committee stage join this queue automatically. Deadlines and delays are tracked server-side."
        actions={<div className="flex rounded-md border border-line bg-white p-0.5" role="group" aria-label="View">
          <Button size="sm" variant={view === 'list' ? 'primary' : 'ghost'} aria-pressed={view === 'list'} onClick={() => set({ view: '' })}><List className="h-4 w-4" aria-hidden />List</Button>
          <Button size="sm" variant={view === 'calendar' ? 'primary' : 'ghost'} aria-pressed={view === 'calendar'} onClick={() => set({ view: 'calendar' })}><CalendarDays className="h-4 w-4" aria-hidden />Calendar</Button></div>} />
      {view === 'calendar' ? (
        <Card><Query q={cal}>{() => <MonthGrid month={month} onMonth={setMonth} events={events} today={lookups.data?.clock.today ?? new Date().toISOString().slice(0, 10)} />}</Query></Card>
      ) : (
        <Card pad={false}>
          <div className="flex flex-wrap items-end gap-3 border-b border-line p-4"><div className="w-52"><Field label="State">{id => <Select id={id} value={status} onChange={e => set({ status: e.target.value })}><option value="">All</option><option value="queued">Waiting to be scheduled</option><option value="scheduled">Scheduled</option><option value="rescheduled">Rescheduled</option><option value="overdue">Overdue</option><option value="completed">Completed</option></Select>}</Field></div></div>
          <Query q={q}>{(d: any) => d.rows.length === 0 ? <Empty title="No EVC records" hint={status ? 'Try another state.' : 'Applications appear here when they reach an EVC stage in their workflow.'} /> : (
            <><Table><thead><tr><Th>Application</Th><Th>State</Th><Th>Schedule by</Th><Th>Visit</Th><Th>Complete by</Th>{coordinator && <Th><span className="sr-only">Actions</span></Th>}</tr></thead>
              <tbody>{d.rows.map((e: any) => (
                <tr key={e.id} className="hover:bg-paper">
                  <Td><Link className="font-medium text-brand hover:underline" to={`/applications/${e.application_id}`}>{e.ref}</Link><p className="text-[13px] text-muted">{e.institution_name}, {e.region_name}</p></Td>
                  <Td><Badge tone={toneFor(e.state)}>{pretty(e.state)}</Badge>{e.reason && <p className="mt-0.5 max-w-[200px] text-[13px] text-bad">{e.reason}</p>}{e.reschedule_count > 0 && <p className="text-[13px] text-muted">Rescheduled {plural(e.reschedule_count, 'time')}</p>}</Td>
                  <Td>{fmtDate(e.schedule_deadline)}{e.status === 'queued' && <p className={`text-[13px] ${e.days_to_schedule_deadline < 0 ? 'text-bad' : 'text-muted'}`}>{e.days_to_schedule_deadline < 0 ? `${-e.days_to_schedule_deadline}d late` : `${e.days_to_schedule_deadline}d left`}</p>}</Td>
                  <Td>{e.status === 'completed' ? `Done ${fmtDate(e.visit_date)}` : e.confirmed_date ? <>{fmtDate(e.confirmed_date)}<p className="text-[13px] text-muted">{e.committee_name}</p></> : '–'}</Td>
                  <Td>{fmtDate(e.completion_deadline)}</Td>
                  {coordinator && <Td className="whitespace-nowrap">
                    {e.status === 'queued' && <Button size="sm" variant="primary" onClick={() => setDlg({ kind: 'schedule', evc: e })}>Schedule</Button>}
                    {['scheduled', 'rescheduled'].includes(e.status) && <><Button size="sm" onClick={() => setDlg({ kind: 'complete', evc: e })}>Record visit</Button> <Button size="sm" variant="ghost" onClick={() => setDlg({ kind: 'reschedule', evc: e })}>Reschedule</Button></>}</Td>}
                </tr>))}</tbody></Table>
              <Pager page={d.page} pages={d.pages} total={d.total} onPage={p => set({ page: String(p) })} /></>)}</Query>
        </Card>)}
      {dlg && (dlg.kind === 'complete' ? <CompleteDialog evc={dlg.evc} onClose={() => setDlg(null)} /> : <SlotDialog evc={dlg.evc} mode={dlg.kind as any} onClose={() => setDlg(null)} />)}
      {!coordinator && <p className="mt-3 text-[13px] text-muted">Only EVC coordinators can schedule visits or record completion. You can follow progress here.</p>}
      <span className="hidden">{String(toast && '')}</span>
    </>);
}
void errMsg;
