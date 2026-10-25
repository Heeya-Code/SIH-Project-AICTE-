import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ExternalLink } from 'lucide-react';
import { api, download, errMsg, qstr } from '../lib/api';
import { useAuth } from '../lib/auth';
import { fmtDate, pretty } from '../lib/format';
import { Badge, Button, Card, Empty, ErrorBox, Field, Input, Modal, PageHeader, Pager, Query, Select, Table, Tabs, Td, Textarea, Th, useToast } from '../components/ui';
import { ReasonDialog } from '../components/ReasonDialog';

export const ProvenanceLegend = () => (
  <div className="flex flex-wrap gap-x-5 gap-y-1 text-[13px]" aria-label="Data origins">
    <span className="flex items-center gap-1.5"><Badge tone="teal">Public import</Badge>from a published file you imported here</span>
    <span className="flex items-center gap-1.5"><Badge tone="brand">Admin-configured</Badge>a rule or value set by an administrator</span>
    <span className="flex items-center gap-1.5"><Badge>Synthetic demo</Badge>generated, never a real record</span>
  </div>);

const ACCESS: Record<string, { label: string; tone: any }> = {
  not_attempted: { label: 'Not attempted', tone: 'neutral' }, reachable_not_downloaded: { label: 'Reachable, not downloaded', tone: 'warn' }, requires_manual_download: { label: 'Needs a manual download', tone: 'warn' },
  blocked: { label: 'Blocked', tone: 'bad' }, downloaded_and_imported: { label: 'Imported', tone: 'good' },
};
const BATCH: Record<string, { label: string; tone: any }> = { completed: { label: 'Completed', tone: 'good' }, completed_with_warnings: { label: 'Completed with warnings', tone: 'warn' }, rejected: { label: 'Rejected', tone: 'bad' }, blocked_provenance: { label: 'Blocked: provenance incomplete', tone: 'bad' }, duplicate_file: { label: 'Skipped: same file already imported', tone: 'neutral' } };

export function QualityReport({ r }: { r: any }) {
  if (!r) return null;
  if (['blocked_provenance', 'duplicate_file'].includes(r.status) || (r.status === 'rejected' && !r.rows_read && !r.missing_fields)) {
    return <div className="rounded-md border border-line bg-paper p-4"><p className="font-medium">{r.message}</p>{r.missing && <ul className="mt-2 list-disc pl-5">{r.missing.map((m: string, i: number) => <li key={i}>{m}</li>)}</ul>}{r.headers && <p className="mt-2 text-[13px]">Columns found: {r.headers.join(', ')}</p>}</div>;
  }
  const stat = (l: string, v: any, tone = '') => <div key={l} className="rounded-md border border-line bg-white p-3"><p className="text-[13px] text-muted">{l}</p><p className={`text-xl font-semibold ${tone === 'bad' ? 'text-bad' : tone === 'warn' ? 'text-warn' : ''}`}>{v}</p></div>;
  return (
    <div className="space-y-4">
      <p className="flex flex-wrap items-center gap-2"><Badge tone={BATCH[r.status]?.tone}>{BATCH[r.status]?.label ?? r.status}</Badge>{r.dry_run && <Badge tone="warn">Dry run: nothing was saved</Badge>}<span className="text-[13px] text-muted">{r.file} · {r.source} · {r.academic_year} · retrieved {fmtDate(r.retrieved_on)}</span></p>
      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {stat('Rows read', r.rows_read)}{stat('New records', r.imported.new)}{stat('Blanks filled', r.imported.filled_blank)}{stat('Unchanged', r.imported.unchanged)}{stat('Rejected rows', r.rejected.count, r.rejected.count ? 'bad' : '')}{stat('Open conflicts', r.conflicts.opened, r.conflicts.opened ? 'warn' : '')}
        {stat('Repeated in file', r.duplicates.in_file_identical)}{stat('Conflicting in file', r.duplicates.in_file_conflicting, r.duplicates.in_file_conflicting ? 'warn' : '')}{stat('Possible near-duplicates', r.duplicates.possible_near, r.duplicates.possible_near ? 'warn' : '')}{stat('Completeness', `${r.completeness_pct}%`)}
      </div>
      {r.rejected.count > 0 && <div><p className="font-medium">Why rows were rejected</p><ul className="list-disc pl-5 text-[14px]">{Object.entries(r.rejected.by_reason).map(([k, v]) => <li key={k}>{k.replace(/_/g, ' ')}: {v as number}</li>)}</ul></div>}
      {Object.keys(r.warnings ?? {}).length > 0 && <div><p className="font-medium">Warnings (rows kept)</p><ul className="list-disc pl-5 text-[14px]">{Object.entries(r.warnings).map(([k, v]) => <li key={k}>{k.replace(/_/g, ' ')}: {v as number}</li>)}</ul></div>}
      <div><p className="mb-1 font-medium">Missing fields among accepted rows</p>
        <div className="grid gap-x-6 gap-y-1 sm:grid-cols-2">{Object.entries(r.missing_fields).map(([k, v]: any) => (
          <div key={k} className="flex items-center gap-2 text-[13px]"><span className="w-40 shrink-0">{pretty(k)}</span><div className="h-1.5 flex-1 overflow-hidden rounded-full bg-[#e3e9f0]"><div className={`h-full ${v.pct > 20 ? 'bg-warn' : 'bg-teal'}`} style={{ width: `${Math.max(v.pct, v.count ? 3 : 0)}%` }} /></div><span className="w-24 text-right text-muted">{v.count} ({v.pct}%)</span></div>))}</div></div>
      <div className="text-[13px]"><p className="font-medium">Column mapping</p>
        <p>Mapped: {Object.entries(r.columns.mapped).map(([h, f]) => `${h} → ${f}`).join('; ') || 'none'}</p>
        {r.columns.unmapped_columns.length > 0 && <p className="text-muted">Ignored columns: {r.columns.unmapped_columns.join(', ')}</p>}{r.columns.fields_without_a_column.length > 0 && <p className="text-muted">Fields with no column in this file: {r.columns.fields_without_a_column.join(', ')}</p>}</div>
      {r.conflicts.opened > 0 && <p className="rounded-md bg-warn-soft p-3 text-warn">{r.conflicts.note}</p>}
      <ul className="list-disc pl-5 text-[13px] text-muted">{r.limits.map((l: string, i: number) => <li key={i}>{l}</li>)}</ul>
    </div>);
}

function Sources({ admin }: { admin: boolean }) {
  const qc = useQueryClient(); const toast = useToast(); const q = useQuery({ queryKey: ['pd-sources'], queryFn: () => api<any[]>('/public-data/sources') });
  const [edit, setEdit] = useState<any>(null); const [err, setErr] = useState<unknown>(null);
  return (
    <div className="space-y-3">
      <Query q={q}>{(rows: any[]) => rows.map(s => (
        <Card key={s.id}><div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1"><p className="flex flex-wrap items-center gap-2 font-semibold">{s.name}<Badge tone={ACCESS[s.access_status].tone}>{ACCESS[s.access_status].label}</Badge>{!s.usable_for_import && <Badge>Not an institution list</Badge>}</p>
            <p className="break-words text-[13px] text-muted">{s.publisher} · <a className="inline-flex max-w-full items-center gap-0.5 break-all text-brand underline" href={s.url} target="_blank" rel="noreferrer noopener">{s.url.slice(0, 70)}{s.url.length > 70 ? '…' : ''}<ExternalLink className="h-3 w-3" aria-hidden /></a></p>
            <dl className="mt-2 grid gap-x-6 gap-y-1 text-[14px] sm:grid-cols-2">
              <div><dt className="text-[13px] text-muted">Licence</dt><dd>{s.licence ?? <span className="font-medium text-warn">Not recorded. Imports are blocked until it is.</span>}</dd></div>
              <div><dt className="text-[13px] text-muted">Dataset date</dt><dd>{s.dataset_date ? fmtDate(s.dataset_date) : 'Not recorded'}</dd></div>
              <div className="sm:col-span-2"><dt className="text-[13px] text-muted">Field definitions</dt><dd>{s.field_definitions_ref ?? 'None recorded'}</dd></div>
              <div className="sm:col-span-2"><dt className="text-[13px] text-muted">Access, checked {s.access_checked_on ? fmtDate(s.access_checked_on) : 'never'}</dt><dd>{s.access_note}</dd></div>
              {s.licence_note && <div className="sm:col-span-2"><dt className="text-[13px] text-muted">Licence note</dt><dd>{s.licence_note}</dd></div>}
            </dl></div>
          {admin && <Button size="sm" onClick={() => { setEdit({ ...s }); setErr(null); }}>Edit provenance</Button>}
        </div></Card>))}</Query>
      {edit && (
        <Modal title={`Provenance: ${edit.code}`} onClose={() => setEdit(null)} footer={<><Button onClick={() => setEdit(null)}>Cancel</Button><Button variant="primary" onClick={async () => { try { await api(`/public-data/sources/${edit.id}`, { method: 'PUT', body: { licence: edit.licence ?? '', licence_note: edit.licence_note ?? '', dataset_date: edit.dataset_date || null, field_definitions_ref: edit.field_definitions_ref ?? '', publisher: edit.publisher ?? '' } }); toast.ok('Provenance saved'); qc.invalidateQueries({ queryKey: ['pd-sources'] }); setEdit(null); } catch (e) { setErr(e); } }}>Save</Button></>}>
          <p className="text-[13px] text-muted">Record only what you have confirmed on the publisher's page. Importing is allowed once licence, publisher and field definitions are recorded.</p>
          <Field label="Licence">{id => <Input id={id} value={edit.licence ?? ''} onChange={e => setEdit({ ...edit, licence: e.target.value })} />}</Field>
          <Field label="Publisher">{id => <Input id={id} value={edit.publisher ?? ''} onChange={e => setEdit({ ...edit, publisher: e.target.value })} />}</Field>
          <Field label="Dataset date (as published)">{id => <Input id={id} value={edit.dataset_date ?? ''} onChange={e => setEdit({ ...edit, dataset_date: e.target.value })} />}</Field>
          <Field label="Field definitions (link or note)">{id => <Textarea id={id} value={edit.field_definitions_ref ?? ''} onChange={e => setEdit({ ...edit, field_definitions_ref: e.target.value })} />}</Field>
          <Field label="Licence note">{id => <Textarea id={id} value={edit.licence_note ?? ''} onChange={e => setEdit({ ...edit, licence_note: e.target.value })} />}</Field>
          {!!err && <ErrorBox error={err} />}</Modal>)}
    </div>);
}

function ImportForm({ onDone }: { onDone: () => void }) {
  const srcs = useQuery({ queryKey: ['pd-sources'], queryFn: () => api<any[]>('/public-data/sources') });
  const [f, setF] = useState({ source_code: 'AIKOSH-AISHE-COLLEGES', academic_year: '', retrieved_on: '', sheet: '', mapping: '' }); const [dry, setDry] = useState(true); const [force, setForce] = useState(false);
  const [file, setFile] = useState<File | null>(null); const [busy, setBusy] = useState(false); const [err, setErr] = useState<unknown>(null); const [res, setRes] = useState<any>(null);
  const go = async () => {
    if (!file) { setErr(new Error('Choose a file')); return; }
    setBusy(true); setErr(null); setRes(null);
    try { const fd = new FormData(); for (const [k, v] of Object.entries(f)) if (v) fd.set(k, v); if (dry) fd.set('dry_run', '1'); if (force) fd.set('force', '1'); fd.set('file', file); const r = await api<any>('/public-data/import', { form: fd }); setRes(r); if (!r.dry_run) onDone(); }
    catch (e) { setErr(e); } finally { setBusy(false); }
  };
  return (
    <div className="space-y-4">
      <Card title="Import a file you downloaded">
        <p className="mb-3 text-[13px] text-muted">The app does not fetch data from the internet. Download a published file (CSV, Excel or JSON) from the source yourself, then import it here. A dry run shows the data-quality report without saving anything.</p>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Source" required>{id => <Select id={id} value={f.source_code} onChange={e => setF({ ...f, source_code: e.target.value })}>{(srcs.data ?? []).filter(s => s.usable_for_import).map(s => <option key={s.code} value={s.code}>{s.name}</option>)}</Select>}</Field>
          <Field label="Academic year of the data" required hint="For example 2023-24">{id => <Input id={id} placeholder="2023-24" value={f.academic_year} onChange={e => setF({ ...f, academic_year: e.target.value })} />}</Field>
          <Field label="Date you retrieved the file" required>{id => <Input id={id} type="date" value={f.retrieved_on} onChange={e => setF({ ...f, retrieved_on: e.target.value })} />}</Field>
          <Field label="Sheet name (Excel only, optional)">{id => <Input id={id} value={f.sheet} onChange={e => setF({ ...f, sheet: e.target.value })} />}</Field>
          <div className="sm:col-span-2"><Field label="Column mapping (optional JSON)" hint='Only needed when headers are not recognised, for example {"Institute Name":"name","State Name":"state"}'>{id => <Textarea id={id} rows={2} value={f.mapping} onChange={e => setF({ ...f, mapping: e.target.value })} />}</Field></div>
          <div className="sm:col-span-2"><Field label="File (.csv, .xlsx or .json, up to 25 MB)" required>{id => <Input id={id} type="file" accept=".csv,.xlsx,.json,.txt" onChange={e => setFile(e.target.files?.[0] ?? null)} />}</Field></div>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-5"><label className="flex items-center gap-2"><input type="checkbox" checked={dry} onChange={e => setDry(e.target.checked)} />Dry run (do not save)</label><label className="flex items-center gap-2"><input type="checkbox" checked={force} onChange={e => setForce(e.target.checked)} />Import even if this exact file was imported before</label></div>
        {!!err && <div className="mt-3"><ErrorBox error={err} /></div>}
        <Button variant="primary" className="mt-4" busy={busy} onClick={go}>{dry ? 'Check the file' : 'Import'}</Button>
      </Card>
      {res && <Card title="Data-quality report"><QualityReport r={res.report} /></Card>}
    </div>);
}

function Batches() {
  const toast = useToast(); const [page, setPage] = useState(1); const [open, setOpen] = useState<number | null>(null);
  const q = useQuery({ queryKey: ['pd-batches', page], queryFn: () => api<any>(`/public-data/batches${qstr({ page, pageSize: 8 })}`) });
  const one = useQuery({ queryKey: ['pd-batch', open], enabled: open !== null, queryFn: () => api<any>(`/public-data/batches/${open}`) });
  return (
    <Card pad={false}><Query q={q}>{(d: any) => d.rows.length === 0 ? <Empty title="No imports yet" hint="Sources are registered, but no file has been imported. Use the Import tab." /> : (
      <><Table><thead><tr><Th>Batch</Th><Th>Source and year</Th><Th>Status</Th><Th>Rows</Th><Th>Outcome</Th><Th><span className="sr-only">Report</span></Th></tr></thead>
        <tbody>{d.rows.map((b: any) => (
          <tr key={b.id}><Td>#{b.id}<p className="text-[13px] text-muted">{b.file_name}</p></Td><Td>{b.source_code}<p className="text-[13px] text-muted">{b.academic_year}, retrieved {fmtDate(b.retrieved_on)}</p></Td><Td><Badge tone={BATCH[b.status]?.tone}>{BATCH[b.status]?.label}</Badge></Td>
            <Td>{b.rows_read}</Td><Td className="text-[13px]">{b.rows_new} new · {b.rows_filled} filled · {b.rows_unchanged} unchanged<br />{b.rows_rejected} rejected · {b.conflicts_opened} conflicts</Td><Td><Button size="sm" onClick={() => setOpen(b.id)}>Quality report</Button></Td></tr>))}</tbody></Table>
        <Pager page={d.page} pages={d.pages} total={d.total} onPage={setPage} /></>)}</Query>
      {open !== null && <Modal title={`Batch #${open}: data-quality report`} wide onClose={() => setOpen(null)} footer={<Button onClick={() => download(`/public-data/batches/${open}/rejects.csv`, `batch-${open}-rejected-rows.csv`).catch(e => toast.err(e.message))}>Download rejected rows (CSV)</Button>}>
        <Query q={one}>{(b: any) => <QualityReport r={{ ...b.report, rows_read: b.report.rows_read ?? b.rows_read }} />}</Query></Modal>}
    </Card>);
}

function Conflicts({ admin }: { admin: boolean }) {
  const qc = useQueryClient(); const toast = useToast(); const [status, setStatus] = useState('open'); const [page, setPage] = useState(1); const [res, setRes] = useState<{ c: any; d: 'keep_existing' | 'use_incoming' } | null>(null);
  const q = useQuery({ queryKey: ['pd-conflicts', status, page], queryFn: () => api<any>(`/public-data/conflicts${qstr({ status, page, pageSize: 10 })}`) });
  return (
    <Card pad={false}>
      <div className="border-b border-line p-4"><div className="w-56"><Field label="Status">{id => <Select id={id} value={status} onChange={e => { setStatus(e.target.value); setPage(1); }}><option value="open">Open</option><option value="">All</option><option value="kept_existing">Kept existing</option><option value="used_incoming">Used incoming</option></Select>}</Field></div></div>
      <p className="border-b border-line bg-warn-soft px-4 py-2.5 text-warn">A conflict means a new file disagrees with a record already stored. The stored value is kept until a person chooses. Nothing is overwritten automatically.</p>
      <Query q={q}>{(d: any) => d.rows.length === 0 ? <Empty title="No conflicts" /> : (
        <><Table><thead><tr><Th>Institution</Th><Th>Field</Th><Th>Stored value</Th><Th>Incoming value</Th><Th>Status</Th><Th><span className="sr-only">Decide</span></Th></tr></thead>
          <tbody>{d.rows.map((c: any) => (
            <tr key={c.id}><Td>{c.institution_name}<p className="text-[13px] text-muted">{c.aishe_code ?? 'no code'} · {c.state}</p></Td><Td>{pretty(c.field)}<p className="text-[13px] text-muted">batch #{c.batch_id}, row {c.row_number}</p></Td><Td>{c.existing_value}</Td><Td>{c.incoming_value}</Td>
              <Td>{c.status === 'open' ? <Badge tone="warn">Open</Badge> : <Badge tone="good">{pretty(c.status)}</Badge>}{c.note && <p className="max-w-[200px] text-[13px] text-muted">{c.note} ({c.resolved_by_name})</p>}</Td>
              <Td className="whitespace-nowrap">{admin && c.status === 'open' && <><Button size="sm" onClick={() => setRes({ c, d: 'keep_existing' })}>Keep stored</Button> <Button size="sm" variant="primary" onClick={() => setRes({ c, d: 'use_incoming' })}>Use incoming</Button></>}</Td></tr>))}</tbody></Table>
          <Pager page={d.page} pages={d.pages} total={d.total} onPage={setPage} /></>)}</Query>
      {res && <ReasonDialog title={res.d === 'use_incoming' ? 'Use the incoming value' : 'Keep the stored value'} required label="What did you check?" submitLabel="Record decision" intro={<p>{pretty(res.c.field)} for {res.c.institution_name}: stored “{res.c.existing_value}”, incoming “{res.c.incoming_value}”. This decision is recorded in the audit trail.</p>}
        onSubmit={async note => { await api(`/public-data/conflicts/${res.c.id}/resolve`, { body: { decision: res.d, note } }); toast.ok('Decision recorded'); qc.invalidateQueries({ queryKey: ['pd-conflicts'] }); qc.invalidateQueries({ queryKey: ['pd-summary'] }); }} onClose={() => setRes(null)} />}
    </Card>);
}

function Directory() {
  const [f, setF] = useState<Record<string, string>>({}); const [page, setPage] = useState(1);
  const q = useQuery({ queryKey: ['pd-inst', f, page], queryFn: () => api<any>(`/public-data/institutions${qstr({ ...f, page, pageSize: 12 })}`), placeholderData: p => p });
  const set = (k: string, v: string) => { setF(x => ({ ...x, [k]: v })); setPage(1); };
  return (
    <Card pad={false}>
      <div className="grid gap-3 border-b border-line p-4 sm:grid-cols-3"><Field label="Search name or AISHE code">{id => <Input id={id} onChange={e => set('q', e.target.value)} />}</Field>
        <Field label="State">{id => <Select id={id} value={f.state ?? ''} onChange={e => set('state', e.target.value)}><option value="">All</option>{(q.data?.states ?? []).map((s: string) => <option key={s}>{s}</option>)}</Select>}</Field></div>
      <Query q={q}>{(d: any) => d.rows.length === 0 ? <Empty title="No public records" hint="Nothing has been imported yet, or nothing matches. These records are separate from the fictional demo institutions." /> : (
        <><Table><thead><tr><Th>Institution</Th><Th>Place</Th><Th>Type and management</Th><Th>Established</Th><Th>Provenance</Th></tr></thead>
          <tbody>{d.rows.map((i: any) => (
            <tr key={i.id}><Td className="max-w-[320px]">{i.name}<p className="text-[13px] text-muted">{i.aishe_code ?? 'No AISHE code in the file'}{i.university_name ? ` · ${i.university_name}` : ''}</p></Td><Td>{i.state}<p className="text-[13px] text-muted">{i.district ?? '–'}{i.location ? ` · ${i.location}` : ''}</p></Td>
              <Td>{i.institution_type ?? '–'}<p className="text-[13px] text-muted">{i.management ?? '–'}</p></Td><Td>{i.year_of_establishment ?? '–'}</Td>
              <Td><Badge tone="teal">Public import</Badge><p className="text-[13px] text-muted">{i.source_code}, {i.academic_year}</p>{i.open_conflicts > 0 && <Badge tone="warn">{i.open_conflicts} open conflict(s)</Badge>}</Td></tr>))}</tbody></Table>
          <Pager page={d.page} pages={d.pages} total={d.total} onPage={setPage} /></>)}</Query>
    </Card>);
}

function Handbook({ admin }: { admin: boolean }) {
  const qc = useQueryClient(); const toast = useToast(); const q = useQuery({ queryKey: ['pd-hb'], queryFn: () => api<any[]>('/public-data/handbook-versions') }); const [rev, setRev] = useState<any>(null); const [st, setSt] = useState('current'); const [read, setRead] = useState(false);
  return (
    <div className="space-y-3">
      <p className="rounded-md bg-warn-soft px-3 py-2 text-warn">A regulatory rule can only become an <b>active</b> workflow rule when it has been checked against the official text, its handbook version is current, and every current addendum has been reviewed. The official handbook PDF could not be opened automatically, so no text below counts as reviewed.</p>
      <Query q={q}>{(rows: any[]) => rows.map(v => (
        <Card key={v.id}><div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-2 font-semibold">{v.title}<Badge tone={v.status === 'current' ? 'good' : v.status === 'unknown' ? 'warn' : 'neutral'}>{pretty(v.status)}</Badge><Badge>{pretty(v.kind)}</Badge><Badge tone={v.text_reviewed ? 'good' : 'warn'}>{v.text_reviewed ? 'Text reviewed' : 'Text not reviewed'}</Badge></p>
          <p className="text-[13px] text-muted">Covers {v.academic_years} · {v.issued_on ? `issued ${fmtDate(v.issued_on)}` : 'issue date not confirmed'}</p><p className="mt-1 text-[14px]">{v.issued_note}</p><p className="mt-1 text-[14px]">{v.notes}</p>
          <p className="mt-1 text-[13px] text-muted">Checked {fmtDate(v.checked_on)}: {v.check_method}</p>{v.url && <a className="inline-flex items-center gap-0.5 text-[13px] text-brand underline" href={v.url} target="_blank" rel="noreferrer noopener">Official location<ExternalLink className="h-3 w-3" aria-hidden /></a>}</div>
          {admin && <Button size="sm" onClick={() => { setRev(v); setSt(v.status); setRead(!!v.text_reviewed); }}>Record a review</Button>}</div></Card>))}</Query>
      {rev && <ReasonDialog title={`Review ${rev.code}`} required label="What did you check, and where?" submitLabel="Save review"
        intro={<div className="space-y-2"><Field label="Status">{id => <Select id={id} value={st} onChange={e => setSt(e.target.value)}><option value="current">Current</option><option value="superseded">Superseded</option><option value="unknown">Unknown</option></Select>}</Field><label className="flex items-center gap-2"><input type="checkbox" checked={read} onChange={e => setRead(e.target.checked)} />I have read the full text of this document</label></div>}
        onSubmit={async notes => { await api(`/public-data/handbook-versions/${rev.id}`, { method: 'PUT', body: { status: st, text_reviewed: read, notes } }); toast.ok('Review recorded'); qc.invalidateQueries({ queryKey: ['pd-hb'] }); }} onClose={() => setRev(null)} />}
    </div>);
}

export default function PublicData() {
  const { user } = useAuth(); const admin = user!.role === 'admin'; const qc = useQueryClient();
  const [tab, setTab] = useState('sources');
  const sum = useQuery({ queryKey: ['pd-summary'], queryFn: () => api<any>('/public-data/summary') });
  return (
    <>
      <PageHeader title="Public data" subtitle="Published datasets and handbook versions, with where each came from, what was actually downloaded, and how clean it is." />
      <div className="mb-4 space-y-3"><ProvenanceLegend />
        <Query q={sum}>{(s: any) => (
          <div className="space-y-3"><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{[['Public institutions imported', s.institutions], ['Completed imports', s.batches], ['Open conflicts', s.open_conflicts], ['States and UTs covered', s.states]].map(([l, v]) => <div key={l as string} className="rounded-lg border border-line bg-white p-3"><p className="text-[13px] text-muted">{l}</p><p className="text-2xl font-semibold">{v}</p></div>)}</div>
            <p className={`rounded-md px-3 py-2 text-[14px] ${s.institutions ? 'bg-teal-soft text-[#0b6769]' : 'bg-warn-soft text-warn'}`}>{s.note}</p></div>)}</Query></div>
      <Tabs value={tab} onChange={setTab} tabs={[{ key: 'sources', label: 'Sources' }, ...(admin ? [{ key: 'import', label: 'Import' }] : []), { key: 'batches', label: 'Import history' }, { key: 'conflicts', label: 'Conflicts' }, { key: 'directory', label: 'Directory' }, { key: 'handbook', label: 'Handbook versions' }]} />
      <div className="mt-4">
        {tab === 'sources' && <Sources admin={admin} />}
        {tab === 'import' && <ImportForm onDone={() => { qc.invalidateQueries(); }} />}
        {tab === 'batches' && <Batches />}
        {tab === 'conflicts' && <Conflicts admin={admin} />}
        {tab === 'directory' && <Directory />}
        {tab === 'handbook' && <Handbook admin={admin} />}
      </div>
    </>);
}
void errMsg;
