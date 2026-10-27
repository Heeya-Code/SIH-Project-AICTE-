import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { z } from 'zod';
import { useState } from 'react';
import { Download } from 'lucide-react';
import { api, download, qstr } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useLookupMaps } from '../lib/hooks';
import { APP_STATUS, fmtDate } from '../lib/format';
import { useStoredList } from '../lib/hooks';
import { getRecent } from '../lib/recent';
import { Badge, Button, Card, DeadlineMeter, Empty, ErrorBox, Field, Input, PageHeader, Pager, Query, Select, Table, Td, Textarea, Th, useToast } from '../components/ui';

export function ApplicationList() {
  const { user } = useAuth(); const lk = useLookupMaps(); const [sp, setSp] = useSearchParams(); const toast = useToast();
  const f = Object.fromEntries(sp.entries());
  const page = Number(f.page ?? 1), sort = f.sort ?? 'updated', order = f.order ?? 'desc';
  const set = (patch: Record<string, string>) => { const n = new URLSearchParams(sp); for (const [k, v] of Object.entries(patch)) v ? n.set(k, v) : n.delete(k); if (!('page' in patch)) n.delete('page'); setSp(n); };
  const q = useQuery({ queryKey: ['applications', f], queryFn: () => api<any>(`/applications${qstr({ ...f, page, pageSize: 15, sort, order })}`), placeholderData: p => p });
  const [presets, savePresets] = useStoredList<{ name: string; query: string }>(`af_presets_${user!.id}`, 8); const [naming, setNaming] = useState(false); const [pname, setPname] = useState('');
  const recent = getRecent(user!.id); const filterCount = Object.keys(f).filter(k => !['page', 'sort', 'order'].includes(k)).length;
  const toggle = (k: string) => set({ sort: k, order: sort === k && order === 'asc' ? 'desc' : 'asc' });
  const th = (label: string, key?: string) => <Th sort={key} active={sort === key} dir={order} onSort={toggle}>{label}</Th>;
  return (
    <>
      <PageHeader title="Applications" subtitle={user!.role === 'institution' ? 'Your applications and where each one stands.' : 'Applications in your scope. Filters are applied on the server.'}
        actions={<>
          <Button onClick={() => download(`/reports/applications_register${qstr({ ...f, format: 'csv' })}`, 'applications.csv').catch(e => toast.err(e.message))}><Download className="h-4 w-4" aria-hidden />Export CSV</Button>
          {user!.role === 'institution' && <Link to="/applications/new"><Button variant="primary">New application</Button></Link>}</>} />
      {(presets.length > 0 || recent.length > 0) && (
        <div className="mb-3 space-y-2">
          {presets.length > 0 && <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Saved filters"><span className="text-[13px] text-muted">Saved filters</span>{presets.map(p => <span key={p.name} className="inline-flex items-center rounded-full border border-line bg-white"><button className="rounded-l-full px-3 py-1 hover:bg-paper" onClick={() => setSp(new URLSearchParams(p.query))}>{p.name}</button><button aria-label={`Delete saved filter ${p.name}`} className="rounded-r-full px-2 py-1 text-muted hover:bg-paper" onClick={() => savePresets(presets.filter(x => x.name !== p.name))}>×</button></span>)}</div>}
          {recent.length > 0 && <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Recently viewed"><span className="text-[13px] text-muted">Recently viewed</span>{recent.map(r => <Link key={r.id} to={`/applications/${r.id}`} title={r.title} className="rounded-full border border-line bg-white px-3 py-1 text-brand hover:bg-paper">{r.ref}</Link>)}</div>}
        </div>)}
      <Card pad={false}>
        <form className="grid gap-3 border-b border-line p-4 sm:grid-cols-2 lg:grid-cols-6" onSubmit={e => e.preventDefault()} role="search" aria-label="Filter applications">
          <div className="lg:col-span-2"><Field label="Search">{(id) => <Input id={id} placeholder="Reference, title or institution" defaultValue={f.q ?? ''} onKeyDown={e => { if (e.key === 'Enter') set({ q: (e.target as HTMLInputElement).value }); }} onBlur={e => e.target.value !== (f.q ?? '') && set({ q: e.target.value })} />}</Field></div>
          {user!.role !== 'institution' && lk.regions.length > 1 && <Field label="Region">{id => <Select id={id} value={f.region_id ?? ''} onChange={e => set({ region_id: e.target.value })}><option value="">All</option>{lk.regions.map((r: any) => <option key={r.id} value={r.id}>{r.name}</option>)}</Select>}</Field>}
          <Field label="Stage">{id => <Select id={id} value={f.stage ?? ''} onChange={e => set({ stage: e.target.value })}><option value="">All</option>{lk.stages.map((s: any) => <option key={s.key} value={s.key}>{s.name}</option>)}</Select>}</Field>
          <Field label="Category">{id => <Select id={id} value={f.category ?? ''} onChange={e => set({ category: e.target.value })}><option value="">All</option>{lk.categories.map((c: any) => <option key={c.code} value={c.code}>{c.name}</option>)}</Select>}</Field>
          <Field label="Status">{id => <Select id={id} value={f.status ?? ''} onChange={e => set({ status: e.target.value })}><option value="">All</option>{Object.entries(APP_STATUS).filter(([k]) => user!.role === 'institution' || k !== 'draft').map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</Select>}</Field>
          <Field label="Needs attention">{id => <Select id={id} value={f.unassigned === '1' ? 'unassigned' : f.stalled === '1' ? 'stalled' : ''} onChange={e => set({ unassigned: e.target.value === 'unassigned' ? '1' : '', stalled: e.target.value === 'stalled' ? '1' : '' })}><option value="">Any</option><option value="unassigned">Unassigned</option><option value="stalled">Stalled</option></Select>}</Field>
          <Field label="Deadline">{id => <Select id={id} value={f.deadline ?? ''} onChange={e => set({ deadline: e.target.value })}><option value="">Any</option><option value="overdue">Overdue</option><option value="due_soon">Due within 3 days</option></Select>}</Field>
          {user!.role !== 'institution' && <Field label="Assigned to">{id => <Select id={id} value={f.assigned_user_id ?? ''} onChange={e => set({ assigned_user_id: e.target.value })}><option value="">Anyone</option><option value="me">Me</option>{lk.officers.map((o: any) => <option key={o.id} value={o.id}>{o.name}</option>)}</Select>}</Field>}
        </form>
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-2">{naming ? (<form className="flex items-center gap-2" onSubmit={e => { e.preventDefault(); if (!pname.trim()) return; savePresets([{ name: pname.trim(), query: sp.toString() }, ...presets.filter(p => p.name !== pname.trim())]); setPname(''); setNaming(false); toast.ok('Filter saved on this device'); }}><Input aria-label="Name for this filter" value={pname} onChange={e => setPname(e.target.value)} maxLength={30} placeholder="Name, e.g. Overdue in my Region" /><Button type="submit" size="sm" variant="primary">Save</Button><Button size="sm" onClick={() => setNaming(false)}>Cancel</Button></form>) : (<Button size="sm" variant="ghost" disabled={filterCount === 0} title={filterCount === 0 ? 'Choose some filters first' : undefined} onClick={() => setNaming(true)}>Save these filters</Button>)}{filterCount > 0 && <Button size="sm" variant="ghost" onClick={() => setSp({})}>Clear all</Button>}</div>
        <Query q={q}>{(d: any) => d.rows.length === 0 ? (
          <Empty title="No applications match" hint={Object.keys(f).length ? 'Clear a filter to see more.' : user!.role === 'institution' ? 'Create your first application to begin.' : 'Applications appear here once an institution submits them.'}
            action={Object.keys(f).length ? <Button onClick={() => setSp({})}>Clear filters</Button> : user!.role === 'institution' ? <Link to="/applications/new"><Button variant="primary">New application</Button></Link> : undefined} />
        ) : (
          <>
            <Table><thead><tr>{th('Application', 'ref')}{th('Institution', 'institution')}{th('Stage', 'stage')}{th('Status', 'status')}{th('Deadline', 'due')}{th('Assigned to')}{th('Age')}</tr></thead>
              <tbody>{d.rows.map((a: any) => (
                <tr key={a.id} className="hover:bg-paper">
                  <Td><Link className="font-medium text-brand hover:underline" to={`/applications/${a.id}`}>{a.ref}</Link><p className="max-w-[260px] truncate text-[13px] text-muted" title={a.title}>{a.title}</p></Td>
                  <Td>{a.institution_name}<p className="text-[13px] text-muted">{a.region_name}</p></Td>
                  <Td className="capitalize">{a.current_stage?.replace(/_/g, ' ') ?? '–'}</Td>
                  <Td><Badge tone={APP_STATUS[a.status]?.tone}>{APP_STATUS[a.status]?.label}</Badge></Td>
                  <Td><DeadlineMeter compact daysInStage={a.days_in_stage} daysToDue={a.days_to_due} status={a.due_status} due={a.stage_due_date} /></Td>
                  <Td>{a.assigned_name ?? (a.status === 'returned' ? 'Institution' : '–')}</Td>
                  <Td>{a.submitted_at ? `${a.age_days}d` : <span className="text-muted">Draft since {fmtDate(a.created_at)}</span>}</Td>
                </tr>))}</tbody></Table>
            <Pager page={d.page} pages={d.pages} total={d.total} onPage={p => set({ page: String(p) })} /></>)}</Query>
      </Card>
    </>);
}

const schema = z.object({ category_code: z.string().min(1, 'Choose a category'), title: z.string().trim().min(5, 'Use at least 5 characters').max(200), summary: z.string().max(2000).optional() });
type F = z.infer<typeof schema>;

const BASIS: Record<string, string> = { verified_excerpt: '· read in a handbook excerpt', needs_review: '· needs review', unverified: '· unverified source', assumption: '· demo assumption' };

export function ApplicationNew() {
  const nav = useNavigate(); const lk = useLookupMaps(); const [error, setError] = useState<unknown>(null);
  const { register, handleSubmit, watch, formState: { errors } } = useForm<F>({ resolver: zodResolver(schema), defaultValues: { category_code: '', title: '', summary: '' } });
  const cat = watch('category_code');
  const reqs = (lk.data?.document_requirements ?? []).filter((r: any) => r.category_code === cat);
  const m = useMutation({ mutationFn: (v: F) => api<{ id: number }>('/applications', { body: v }), onSuccess: r => nav(`/applications/${r.id}`), onError: setError });
  return (
    <>
      <PageHeader title="New application" subtitle="Save a draft first. You will upload the required documents on the next screen, then submit." />
      <Card className="max-w-2xl"><form onSubmit={handleSubmit(v => { setError(null); m.mutate(v); })} className="space-y-4" noValidate>
        <Field label="Application category" error={errors.category_code?.message} required>{(id, d) => <Select id={id} aria-describedby={d} aria-invalid={!!errors.category_code} {...register('category_code')}><option value="">Choose…</option>{lk.categories.map((c: any) => <option key={c.code} value={c.code}>{c.name}</option>)}</Select>}</Field>
        {cat && <div className="rounded-md bg-brand-soft p-3 text-[13px]"><p className="font-medium">Documents needed for this category</p><ul className="mt-1 list-disc pl-4">{reqs.map((r: any) => <li key={r.doc_type}>{lk.data?.doc_type_names?.[r.doc_type] ?? r.doc_type}{r.has_expiry ? ' (with expiry date)' : ''} <span className="text-muted">{BASIS[r.basis] ?? ''}</span></li>)}</ul></div>}
        <Field label="Title" error={errors.title?.message} required hint="For example: Extension of approval for the 2026-27 academic year">{(id, d) => <Input id={id} aria-describedby={d} aria-invalid={!!errors.title} {...register('title')} />}</Field>
        <Field label="Summary" error={errors.summary?.message}>{(id, d) => <Textarea id={id} aria-describedby={d} rows={4} {...register('summary')} />}</Field>
        {!!error && <ErrorBox error={error} />}
        <div className="flex gap-2"><Button type="submit" variant="primary" busy={m.isPending}>Save draft</Button><Button onClick={() => nav('/applications')}>Cancel</Button></div>
      </form></Card>
    </>);
}
