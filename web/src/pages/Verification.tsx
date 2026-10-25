import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Download } from 'lucide-react';
import { api, download, qstr } from '../lib/api';
import { useLookupMaps } from '../lib/hooks';
import { fmtDate, pretty } from '../lib/format';
import { Badge, Button, Card, DocLabel, Empty, Field, PageHeader, Pager, Query, Select, Table, Td, Th, useToast } from '../components/ui';
import { ReasonDialog } from '../components/ReasonDialog';

export default function Verification() {
  const lk = useLookupMaps(); const qc = useQueryClient(); const toast = useToast();
  const [f, setF] = useState<Record<string, string>>({}); const [page, setPage] = useState(1); const [ret, setRet] = useState<any>(null);
  const sum = useQuery({ queryKey: ['queue-summary'], queryFn: () => api<any>('/documents/queue-summary') });
  const q = useQuery({ queryKey: ['queue', f, page], queryFn: () => api<any>(`/documents${qstr({ ...f, queue: 1, page, pageSize: 12 })}`), placeholderData: p => p });
  const set = (k: string, v: string) => { setF(x => ({ ...x, [k]: v })); setPage(1); };
  const refresh = () => { qc.invalidateQueries({ queryKey: ['queue'] }); qc.invalidateQueries({ queryKey: ['queue-summary'] }); qc.invalidateQueries({ queryKey: ['dashboard'] }); };
  const decide = async (d: any, decision: string, note?: string) => { await api(`/documents/${d.id}/verify`, { body: { decision, note } }); toast.ok(decision === 'verified' ? 'Document verified' : 'Document returned to the institution'); refresh(); };
  const cards = (s: any) => [['Waiting for verification', s.pending, ''], ['Waiting over 7 days', s.waiting_over_7_days, s.waiting_over_7_days ? 'warn' : ''], ['Expiring within 30 days', s.expiring_within_30_days, s.expiring_within_30_days ? 'warn' : ''], ['Already expired', s.already_expired, s.already_expired ? 'bad' : ''], ['Returned, awaiting institution', s.returned_awaiting_institution, '']];
  return (
    <>
      <PageHeader title="Document verification queue" subtitle="Current document versions waiting for an officer's decision, oldest first. Verification is always a person's decision: nothing here is verified automatically." />
      <Query q={sum}>{(s: any) => <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">{cards(s).map(([l, v, t]) => <div key={l as string} className="rounded-lg border border-line bg-white p-3"><p className="text-[13px] text-muted">{l}</p><p className={`text-2xl font-semibold ${t === 'warn' ? 'text-warn' : t === 'bad' ? 'text-bad' : ''}`}>{v}</p></div>)}</div>}</Query>
      <Card pad={false}>
        <div className="grid gap-3 border-b border-line p-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Document type">{id => <Select id={id} value={f.doc_type ?? ''} onChange={e => set('doc_type', e.target.value)}><option value="">All</option>{lk.docTypes.map((t: string) => <option key={t} value={t}>{lk.data?.doc_type_names?.[t] ?? t}</option>)}</Select>}</Field>
          {lk.regions.length > 1 && <Field label="Region">{id => <Select id={id} value={f.region_id ?? ''} onChange={e => set('region_id', e.target.value)}><option value="">All</option>{lk.regions.map((r: any) => <option key={r.id} value={r.id}>{r.name}</option>)}</Select>}</Field>}
          <Field label="Expiry">{id => <Select id={id} value={f.expiry ?? ''} onChange={e => set('expiry', e.target.value)}><option value="">Any</option><option value="expired">Expired</option><option value="30">Within 30 days</option><option value="90">Within 90 days</option></Select>}</Field>
        </div>
        <Query q={q}>{(d: any) => d.rows.length === 0 ? <Empty title="Nothing is waiting for verification" hint="New uploads on submitted applications appear here." /> : (
          <><Table><thead><tr><Th>Document</Th><Th>Institution</Th><Th>Application</Th><Th>Waiting</Th><Th>Expiry</Th><Th><span className="sr-only">Actions</span></Th></tr></thead>
            <tbody>{d.rows.map((x: any) => (
              <tr key={x.id} className="hover:bg-paper"><Td><DocLabel name={x.display_name} code={x.doc_code} reference={x.reference_no} file={x.file_name} /><p className="text-[13px] text-muted">Version {x.version}</p></Td>
                <Td>{x.institution_name}<p className="text-[13px] text-muted">{x.region_name}</p></Td>
                <Td>{x.application_id ? <Link className="text-brand hover:underline" to={`/applications/${x.application_id}`}>{x.application_ref}</Link> : '–'}<p className="text-[13px] text-muted">{pretty(x.app_status)}</p></Td>
                <Td><Badge tone={x.waiting_days > 7 ? 'warn' : 'neutral'}>{x.waiting_days} day{x.waiting_days === 1 ? '' : 's'}</Badge></Td>
                <Td>{x.expiry_date ? <>{fmtDate(x.expiry_date)}<p><Badge tone={x.expiry_state === 'expired' ? 'bad' : x.expiry_state === 'expiring_soon' ? 'warn' : 'good'}>{x.expiry_state === 'expired' ? `Expired ${-x.days_to_expiry}d ago` : `${x.days_to_expiry}d left`}</Badge></p></> : <span className="text-muted">No expiry</span>}</Td>
                <Td className="whitespace-nowrap"><Button size="sm" variant="ghost" aria-label={`Download ${x.file_name}`} onClick={() => download(`/documents/${x.id}/download`, x.file_name).catch(e => toast.err(e.message))}><Download className="h-4 w-4" /></Button>
                  <Button size="sm" variant="primary" onClick={() => decide(x, 'verified').catch(e => toast.err(e.message))}>Verify</Button> <Button size="sm" onClick={() => setRet(x)}>Return</Button></Td></tr>))}</tbody></Table>
            <Pager page={d.page} pages={d.pages} total={d.total} onPage={setPage} /></>)}</Query>
      </Card>
      {ret && <ReasonDialog title={`Return ${ret.display_name}`} required label="What needs to be corrected?" submitLabel="Return document" onSubmit={r => decide(ret, 'returned', r)} onClose={() => setRet(null)} />}
    </>);
}
