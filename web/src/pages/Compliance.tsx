import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Download, Plus } from 'lucide-react';
import { api, download, errMsg, qstr } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useLookupMaps } from '../lib/hooks';
import { fmtDate, fmtDateTime, pretty, toneFor, daysLabel } from '../lib/format';
import { Badge, Button, Card, Empty, ErrorBox, Field, Input, Modal, PageHeader, Pager, Query, Select, Table, Td, Textarea, Th, useToast } from '../components/ui';
import { ReasonDialog } from '../components/ReasonDialog';

const STATUSES = [['', 'All'], ['upcoming', 'Upcoming'], ['due_soon', 'Due soon'], ['submitted', 'Submitted'], ['under_verification', 'Under verification'], ['returned_for_correction', 'Returned for correction'], ['verified', 'Verified'], ['overdue', 'Overdue'], ['closed', 'Closed']];

const create = z.object({ institution_id: z.string().min(1, 'Choose an institution'), condition_text: z.string().trim().min(3, 'Describe the condition').max(300), description: z.string().trim().min(3, 'Add a description').max(1000), required_evidence: z.string().trim().min(3, 'Say what evidence is required').max(500), due_date: z.string().min(1, 'Choose a due date') });

function NewObligation({ onClose }: { onClose: () => void }) {
  const lk = useLookupMaps(); const qc = useQueryClient(); const toast = useToast(); const [err, setErr] = useState<unknown>(null); const [busy, setBusy] = useState(false);
  const { register, handleSubmit, formState: { errors } } = useForm<z.infer<typeof create>>({ resolver: zodResolver(create) });
  const go = handleSubmit(async v => { setBusy(true); setErr(null); try { await api('/undertakings', { body: { ...v, institution_id: Number(v.institution_id) } }); toast.ok('Obligation recorded. The institution has been notified.'); qc.invalidateQueries({ queryKey: ['undertakings'] }); onClose(); } catch (e) { setErr(e); } finally { setBusy(false); } });
  return (
    <Modal title="Record a new obligation" onClose={onClose} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" busy={busy} onClick={go}>Record obligation</Button></>}>
      <form onSubmit={go} className="space-y-4" noValidate>
        <Field label="Institution" required error={errors.institution_id?.message}>{(id, d) => <Select id={id} aria-describedby={d} {...register('institution_id')}><option value="">Choose…</option>{lk.institutions.map((i: any) => <option key={i.id} value={i.id}>{i.name}</option>)}</Select>}</Field>
        <Field label="Condition" required error={errors.condition_text?.message}>{(id, d) => <Input id={id} aria-describedby={d} {...register('condition_text')} />}</Field>
        <Field label="Description" required error={errors.description?.message}>{(id, d) => <Textarea id={id} aria-describedby={d} rows={2} {...register('description')} />}</Field>
        <Field label="Required evidence" required error={errors.required_evidence?.message}>{(id, d) => <Input id={id} aria-describedby={d} {...register('required_evidence')} />}</Field>
        <Field label="Due date" required error={errors.due_date?.message}>{(id, d) => <Input id={id} aria-describedby={d} type="date" {...register('due_date')} />}</Field>
        {!!err && <ErrorBox error={err} />}
      </form>
    </Modal>);
}

const evSchema = z.object({ note: z.string().trim().min(3, 'Describe the evidence'), file: z.custom<FileList>().refine(f => f && f.length === 1, 'Attach a file') });
function EvidenceForm({ u, onDone }: { u: any; onDone: () => void }) {
  const [err, setErr] = useState<unknown>(null); const [busy, setBusy] = useState(false); const toast = useToast();
  const { register, handleSubmit, formState: { errors } } = useForm<z.infer<typeof evSchema>>({ resolver: zodResolver(evSchema) });
  const go = handleSubmit(async v => { setBusy(true); setErr(null); try { const fd = new FormData(); fd.set('note', v.note); fd.set('file', v.file[0]); await api(`/undertakings/${u.id}/submissions`, { form: fd }); toast.ok('Evidence submitted for verification'); onDone(); } catch (e) { setErr(e); } finally { setBusy(false); } });
  return (
    <form onSubmit={go} className="space-y-3 rounded-md border border-line p-4" noValidate>
      <p className="font-medium">{u.status === 'returned' ? 'Submit corrected evidence' : 'Submit evidence'}</p>
      <p className="text-[13px] text-muted">Required: {u.required_evidence}</p>
      <Field label="Note" required error={errors.note?.message}>{(id, d) => <Textarea id={id} aria-describedby={d} rows={2} {...register('note')} />}</Field>
      <Field label="File (PDF, PNG or JPEG, up to 5 MB)" required error={errors.file?.message as string}>{(id, d) => <Input id={id} aria-describedby={d} type="file" accept=".pdf,.png,.jpg,.jpeg" {...register('file')} />}</Field>
      {!!err && <ErrorBox error={err} />}
      <Button type="submit" variant="primary" busy={busy}>Submit evidence</Button>
    </form>);
}

function Detail({ id, onClose }: { id: number; onClose: () => void }) {
  const { user } = useAuth(); const qc = useQueryClient(); const toast = useToast(); const [dlg, setDlg] = useState<'return' | 'verify' | null>(null);
  const q = useQuery({ queryKey: ['undertaking', id], queryFn: () => api<any>(`/undertakings/${id}`) });
  const refresh = () => { qc.invalidateQueries({ queryKey: ['undertaking', id] }); qc.invalidateQueries({ queryKey: ['undertakings'] }); qc.invalidateQueries({ queryKey: ['dashboard'] }); };
  const review = async (decision: string, note?: string) => { await api(`/undertakings/${id}/review`, { body: { decision, note } }); toast.ok('Saved'); refresh(); };
  return (
    <Modal title="Obligation details" wide onClose={onClose}>
      <Query q={q}>{(u: any) => {
        const isVerifier = user!.role === u.verifier_role;
        return (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2"><div><p className="text-lg font-semibold">{u.code}</p><p>{u.condition_text}</p></div><Badge tone={toneFor(u.effective_status)}>{pretty(u.effective_status)}</Badge></div>
            <dl className="grid gap-3 text-[14px] sm:grid-cols-3"><div><dt className="text-muted">Due</dt><dd className="font-medium">{fmtDate(u.due_date)} <span className={u.days_to_due < 0 ? 'text-bad' : 'text-muted'}>({daysLabel(u.days_to_due)})</span></dd></div>
              <div><dt className="text-muted">Required evidence</dt><dd className="font-medium">{u.required_evidence}</dd></div><div><dt className="text-muted">Verified by role</dt><dd className="font-medium">{pretty(u.verifier_role)}</dd></div></dl>
            <p className="text-muted">{u.description}</p>
            {u.observations && <p className="rounded-md bg-warn-soft p-3 text-warn"><b>Reviewer note:</b> {u.observations}</p>}
            {user!.role === 'institution' && ['pending', 'returned'].includes(u.status) && <EvidenceForm u={u} onDone={refresh} />}
            {isVerifier && ['submitted', 'under_verification'].includes(u.status) && (
              <div className="flex flex-wrap gap-2 rounded-md border border-line p-3"><p className="w-full font-medium">Review the latest submission</p>
                {u.status === 'submitted' && <Button onClick={() => review('begin_review').catch(e => toast.err(errMsg(e)))}>Start review</Button>}
                <Button variant="primary" onClick={() => setDlg('verify')}>Verify</Button><Button onClick={() => setDlg('return')}>Return for correction</Button></div>)}
            {isVerifier && u.status === 'verified' && <Button onClick={() => review('close').catch(e => toast.err(errMsg(e)))}>Close obligation</Button>}
            <div><h3 className="mb-1 font-semibold">Submissions</h3>
              {u.submissions.length === 0 ? <p className="text-muted">Nothing submitted yet.</p> : <ul className="space-y-2">{u.submissions.map((s: any) => (
                <li key={s.id} className="rounded-md border border-line p-3"><div className="flex flex-wrap items-center justify-between gap-2"><p className="font-medium">Version {s.version}, {fmtDateTime(s.submitted_at)}</p><Badge tone={toneFor(s.review_status)}>{pretty(s.review_status)}</Badge></div>
                  <p>{s.note}</p><p className="text-[13px] text-muted">By {s.submitted_by_name}</p>
                  {s.file_name && <Button size="sm" variant="ghost" onClick={() => download(`/undertakings/submissions/${s.id}/download`, s.file_name).catch(e => toast.err(e.message))}><Download className="h-4 w-4" aria-hidden />{s.file_name}</Button>}
                  {s.review_note && <p className="mt-1 text-[13px]"><b>Review:</b> {s.review_note} ({s.reviewed_by_name}, {fmtDate(s.reviewed_at)})</p>}</li>))}</ul>}</div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div><h3 className="mb-1 font-semibold">Reminders sent</h3>{u.reminders.length === 0 ? <p className="text-muted">None yet.</p> : <ul className="text-[13px]">{u.reminders.map((r: any, i: number) => <li key={i}>{fmtDate(r.at)}: {r.title}</li>)}</ul>}</div>
              {user!.role !== 'institution' && <div><h3 className="mb-1 font-semibold">Escalations</h3>{u.escalations.length === 0 ? <p className="text-muted">None.</p> : <ul className="text-[13px]">{u.escalations.map((r: any, i: number) => <li key={i}>Level {r.level}, {r.status}: {fmtDate(r.triggered_at)}</li>)}</ul>}</div>}
            </div>
            <div><h3 className="mb-1 font-semibold">Audit history</h3><ul className="text-[13px] text-muted">{u.audit.map((a: any, i: number) => <li key={i}>{fmtDateTime(a.at)}: {a.event_type.replace(/[._]/g, ' ')}, {a.actor_label}{a.reason ? ` (${a.reason})` : ''}</li>)}</ul></div>
            {dlg && <ReasonDialog title={dlg === 'verify' ? 'Verify evidence' : 'Return for correction'} required={dlg === 'return'} label={dlg === 'verify' ? 'Note (optional)' : 'What needs to be corrected?'} submitLabel={dlg === 'verify' ? 'Verify' : 'Return'}
              intro={dlg === 'verify' ? 'Verification is an explicit decision. An upload alone never marks an obligation as verified.' : undefined} onSubmit={r => review(dlg === 'verify' ? 'verify' : 'return', r)} onClose={() => setDlg(null)} />}
          </div>);
      }}</Query>
    </Modal>);
}

export default function Compliance() {
  const { user } = useAuth(); const [sp, setSp] = useSearchParams(); const [open, setOpen] = useState<number | null>(null); const [creating, setCreating] = useState(false);
  const status = sp.get('status') ?? '', page = Number(sp.get('page') ?? 1), qtext = sp.get('q') ?? '';
  const set = (p: Record<string, string>) => { const n = new URLSearchParams(sp); for (const [k, v] of Object.entries(p)) v ? n.set(k, v) : n.delete(k); if (!('page' in p)) n.delete('page'); setSp(n); };
  const q = useQuery({ queryKey: ['undertakings', status, page, qtext], queryFn: () => api<any>(`/undertakings${qstr({ status, page, pageSize: 15, q: qtext })}`), placeholderData: p => p });
  const canCreate = ['regional_officer', 'bureau_officer'].includes(user!.role);
  return (
    <>
      <PageHeader title="Compliance tracker" subtitle="Undertakings and time-bound obligations. Status is recalculated from the due date every time, and only a reviewer can mark evidence as verified."
        actions={canCreate ? <Button variant="primary" onClick={() => setCreating(true)}><Plus className="h-4 w-4" aria-hidden />New obligation</Button> : undefined} />
      <Card pad={false}>
        <div className="grid gap-3 border-b border-line p-4 sm:grid-cols-3">
          <Field label="Search">{id => <Input id={id} defaultValue={qtext} placeholder="Code, condition or institution" onKeyDown={e => { if (e.key === 'Enter') set({ q: (e.target as HTMLInputElement).value }); }} onBlur={e => e.target.value !== qtext && set({ q: e.target.value })} />}</Field>
          <Field label="Status">{id => <Select id={id} value={status} onChange={e => set({ status: e.target.value })}>{STATUSES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select>}</Field>
        </div>
        <Query q={q}>{(d: any) => d.rows.length === 0 ? <Empty title="No obligations found" hint={status || qtext ? 'Try clearing the filters.' : user!.role === 'institution' ? 'Obligations appear here when an approval carries conditions.' : 'Obligations are created from approval conditions, or recorded manually.'} /> : (
          <><Table><thead><tr><Th>Obligation</Th><Th>Institution</Th><Th>Due</Th><Th>Status</Th><Th><span className="sr-only">Open</span></Th></tr></thead>
            <tbody>{d.rows.map((u: any) => (
              <tr key={u.id} className="hover:bg-paper"><Td><button className="text-left font-medium text-brand hover:underline" onClick={() => setOpen(u.id)}>{u.code}</button><p className="max-w-[300px] text-[13px]">{u.condition_text}</p></Td>
                <Td>{u.institution_name}<p className="text-[13px] text-muted">{u.region_name}</p></Td>
                <Td>{fmtDate(u.due_date)}<p className={`text-[13px] ${u.days_to_due < 0 && ['pending', 'returned'].includes(u.status) ? 'text-bad' : 'text-muted'}`}>{['pending', 'returned'].includes(u.status) ? daysLabel(u.days_to_due) : ''}</p></Td>
                <Td><Badge tone={toneFor(u.effective_status)}>{pretty(u.effective_status)}</Badge></Td>
                <Td><Button size="sm" onClick={() => setOpen(u.id)}>{user!.role === 'institution' && ['pending', 'returned'].includes(u.status) ? 'Submit evidence' : 'Open'}</Button></Td></tr>))}</tbody></Table>
            <Pager page={d.page} pages={d.pages} total={d.total} onPage={p => set({ page: String(p) })} /></>)}</Query>
      </Card>
      {open && <Detail id={open} onClose={() => setOpen(null)} />}
      {creating && <NewObligation onClose={() => setCreating(false)} />}
    </>);
}
