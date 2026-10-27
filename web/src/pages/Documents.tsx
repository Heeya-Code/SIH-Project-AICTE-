import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, Eye, History, RefreshCw } from 'lucide-react';
import { DocPreview } from '../components/DocPreview';
import { api, download, qstr } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useLookupMaps } from '../lib/hooks';
import { fmtDate, pretty, toneFor } from '../lib/format';
import { Badge, Button, Card, DocLabel, Empty, Field, Modal, PageHeader, Pager, Query, Select, Table, Td, Th, useToast } from '../components/ui';
import { UploadDialog } from '../components/UploadDialog';
import { ReasonDialog } from '../components/ReasonDialog';

function Versions({ doc, onClose }: { doc: any; onClose: () => void }) {
  const q = useQuery({ queryKey: ['doc-versions', doc.id], queryFn: () => api<any[]>(`/documents/${doc.id}/versions`) }); const toast = useToast();
  return (
    <Modal title={`${doc.display_name}: version history`} onClose={onClose} wide>
      <Query q={q}>{(rows: any[]) => (
        <Table><thead><tr><Th>Version</Th><Th>Reference</Th><Th>Issued</Th><Th>Expiry</Th><Th>Uploaded</Th><Th>Verification</Th><Th><span className="sr-only">Download</span></Th></tr></thead>
          <tbody>{rows.map(v => <tr key={v.id}><Td><DocLabel name={doc.display_name} code={v.doc_code} />v{v.version} {v.is_current ? <Badge tone="teal">Current</Badge> : <Badge>Earlier</Badge>}</Td><Td>{v.reference_no ?? '–'}</Td><Td>{fmtDate(v.issue_date)}</Td><Td>{v.expiry_date ? fmtDate(v.expiry_date) : 'No expiry'}</Td>
            <Td>{fmtDate(v.uploaded_at)}<p className="text-[13px] text-muted">{v.uploaded_by_name}</p></Td><Td><Badge tone={toneFor(v.verification_status)}>{pretty(v.verification_status)}</Badge></Td>
            <Td><Button size="sm" variant="ghost" aria-label={`Download version ${v.version}`} onClick={() => download(`/documents/${v.id}/download`, v.file_name).catch(e => toast.err(e.message))}><Download className="h-4 w-4" /></Button></Td></tr>)}</tbody></Table>)}</Query>
    </Modal>);
}

export default function Documents() {
  const { user } = useAuth(); const lk = useLookupMaps(); const qc = useQueryClient(); const toast = useToast();
  const [sp, setSp] = useSearchParams(); const [renew, setRenew] = useState<any>(null); const [versions, setVersions] = useState<any>(null); const [ret, setRet] = useState<any>(null); const [prev, setPrev] = useState<any>(null); const [samplePreview, setSamplePreview] = useState<any>(null);
  const f = Object.fromEntries(sp.entries()), page = Number(f.page ?? 1);
  const set = (p: Record<string, string>) => { const n = new URLSearchParams(sp); for (const [k, v] of Object.entries(p)) v ? n.set(k, v) : n.delete(k); if (!('page' in p)) n.delete('page'); setSp(n); };
  const q = useQuery({ queryKey: ['documents', f], queryFn: () => api<any>(`/documents${qstr({ ...f, page, pageSize: 15 })}`), placeholderData: p => p });
  const samples = useQuery({ queryKey: ['document-samples'], queryFn: () => api<{ rows: any[] }>('/documents/samples') });
  useEffect(() => {
    const key = sp.get('sample');
    const found = samples.data?.rows.find(x => x.doc_type === key);
    if (found) setSamplePreview(found);
  }, [sp, samples.data]);
  const officer = ['regional_officer', 'bureau_officer'].includes(user!.role);
  const verify = async (d: any, decision: string, note?: string) => { await api(`/documents/${d.id}/verify`, { body: { decision, note } }); toast.ok(decision === 'verified' ? 'Document verified' : 'Document returned'); qc.invalidateQueries({ queryKey: ['documents'] }); };
  return (
    <>
      <PageHeader title="Document validity" subtitle="Leases and other prescribed documents, with their actual expiry dates. Reminders go out automatically before expiry; renewals are kept as new versions." />
      <Card title="Sample document library" className="mb-5">
        <p className="mb-4 text-sm text-muted">Fictional examples for the document types used in this prototype. Samples are not official certificates, submitted evidence, or proof of compliance.</p>
        <Query q={samples}>{(data: { rows: any[] }) => (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {data.rows.map((sample: any) => (
              <article key={sample.doc_type} className="rounded-xl border border-line bg-paper/60 p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0"><h2 className="font-semibold text-ink">{sample.display_name}</h2><p className="mt-1 text-[13px] text-muted">{sample.description}</p></div>
                  <Badge tone="warn">{sample.kind === 'workflow_example' ? 'Workflow example' : 'Document sample'}</Badge>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button size="sm" onClick={() => setSamplePreview(sample)}><Eye className="h-4 w-4" aria-hidden />Preview</Button>
                  <Button size="sm" variant="secondary" onClick={() => download(`/documents/samples/download${qstr({ doc_type: sample.doc_type })}`, sample.file_name).catch(e => toast.err(e.message))}><Download className="h-4 w-4" aria-hidden />Download sample</Button>
                </div>
              </article>
            ))}
          </div>)}</Query>
      </Card>
      <Card pad={false}>
        <div className="grid gap-3 border-b border-line p-4 sm:grid-cols-2 lg:grid-cols-5">
          <Field label="Expiry">{id => <Select id={id} value={f.expiry ?? ''} onChange={e => set({ expiry: e.target.value })}><option value="">Any</option><option value="expired">Expired</option><option value="30">Within 30 days</option><option value="60">Within 60 days</option><option value="90">Within 90 days</option><option value="no_expiry">No expiry date</option></Select>}</Field>
          <Field label="Document type">{id => <Select id={id} value={f.doc_type ?? ''} onChange={e => set({ doc_type: e.target.value })}><option value="">All</option>{lk.docTypes.map((t: string) => <option key={t} value={t}>{lk.data?.doc_type_names?.[t] ?? t}</option>)}</Select>}</Field>
          {user!.role !== 'institution' && <Field label="Institution">{id => <Select id={id} value={f.institution_id ?? ''} onChange={e => set({ institution_id: e.target.value })}><option value="">All</option>{lk.institutions.map((i: any) => <option key={i.id} value={i.id}>{i.name}</option>)}</Select>}</Field>}
          {user!.role !== 'institution' && lk.regions.length > 1 && <Field label="Region">{id => <Select id={id} value={f.region_id ?? ''} onChange={e => set({ region_id: e.target.value })}><option value="">All</option>{lk.regions.map((r: any) => <option key={r.id} value={r.id}>{r.name}</option>)}</Select>}</Field>}
          <Field label="Verification">{id => <Select id={id} value={f.verification ?? ''} onChange={e => set({ verification: e.target.value })}><option value="">Any</option><option value="pending">Pending</option><option value="verified">Verified</option><option value="returned">Returned</option></Select>}</Field>
        </div>
        <Query q={q}>{(d: any) => d.rows.length === 0 ? <Empty title="No documents match" hint="Documents appear here when they are uploaded with an application." /> : (
          <><Table><thead><tr><Th>Document</Th>{user!.role !== 'institution' && <Th>Institution</Th>}<Th>Expiry</Th><Th>Verification</Th><Th>Renewal</Th><Th><span className="sr-only">Actions</span></Th></tr></thead>
            <tbody>{d.rows.map((x: any) => (
              <tr key={x.id} className="hover:bg-paper"><Td><DocLabel name={x.display_name} code={x.doc_code} reference={x.reference_no} /><p className="text-[13px] text-muted">Version {x.version} · {x.application_ref ?? 'Not linked to an application'}</p><p className="text-[13px] text-muted">{x.file_name}</p></Td>
                {user!.role !== 'institution' && <Td>{x.institution_name}<p className="text-[13px] text-muted">{x.region_name}</p></Td>}
                <Td>{x.expiry_date ? <>{fmtDate(x.expiry_date)}<p><Badge tone={toneFor(x.expiry_state)}>{x.expiry_state === 'expired' ? `Expired ${-x.days_to_expiry}d ago` : x.expiry_state === 'no_expiry' ? 'No expiry' : `${x.days_to_expiry}d left`}</Badge></p></> : <span className="text-muted">No expiry date</span>}</Td>
                <Td><Badge tone={toneFor(x.verification_status)}>{pretty(x.verification_status)}</Badge></Td>
                <Td>{x.expiry_date ? <Badge tone={x.renewal_status === 'expired' ? 'bad' : x.renewal_status === 'due_for_renewal' ? 'warn' : 'neutral'}>{pretty(x.renewal_status)}</Badge> : '–'}</Td>
                <Td className="whitespace-nowrap">
                  <Button size="sm" variant="ghost" aria-label={`Preview ${x.display_name}`} onClick={() => setPrev(x)}><Eye className="h-4 w-4" aria-hidden /></Button>
                  <Button size="sm" variant="ghost" aria-label={`Download ${x.display_name}`} onClick={() => download(`/documents/${x.id}/download`, x.file_name).catch(e => toast.err(e.message))}><Download className="h-4 w-4" /></Button>
                  <Button size="sm" variant="ghost" aria-label="Version history" onClick={() => setVersions(x)}><History className="h-4 w-4" /></Button>
                  {user!.role === 'institution' && x.expiry_date && <Button size="sm" onClick={() => setRenew(x)}><RefreshCw className="h-3.5 w-3.5" aria-hidden />Renew</Button>}
                  {officer && x.verification_status === 'pending' && <><Button size="sm" variant="ghost" onClick={() => verify(x, 'verified').catch(e => toast.err(e.message))}>Verify</Button><Button size="sm" variant="ghost" onClick={() => setRet(x)}>Return</Button></>}</Td></tr>))}</tbody></Table>
            <Pager page={d.page} pages={d.pages} total={d.total} onPage={p => set({ page: String(p) })} /></>)}</Query>
      </Card>
      {prev && <DocPreview id={prev.id} name={prev.display_name} fileName={prev.file_name} onClose={() => setPrev(null)} />}
      {samplePreview && <DocPreview path={`/documents/samples/download${qstr({ doc_type: samplePreview.doc_type })}`} name={samplePreview.display_name} fileName={samplePreview.file_name} sample onClose={() => setSamplePreview(null)} />}
      {renew && <UploadDialog renewOf={renew} onClose={() => setRenew(null)} />}
      {versions && <Versions doc={versions} onClose={() => setVersions(null)} />}
      {ret && <ReasonDialog title={`Return ${ret.display_name}`} required label="What needs to be corrected?" submitLabel="Return document" onSubmit={r => verify(ret, 'returned', r)} onClose={() => setRet(null)} />}
    </>);
}
