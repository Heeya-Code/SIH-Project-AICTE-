import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ExternalLink } from 'lucide-react';
import { api, qstr } from '../lib/api';
import { useAuth } from '../lib/auth';
import { fmtDate } from '../lib/format';
import { Badge, Button, Card, Empty, Field, Input, PageHeader, Pager, Query, Select, Tabs, Table, Td, Th, useToast } from '../components/ui';
import { ReasonDialog } from '../components/ReasonDialog';
import { Modal } from '../components/ui';

const ACT: Record<string, { label: string; tone: any }> = { not_bound: { label: 'Not used by the workflow', tone: 'neutral' }, demo_active: { label: 'Used in the demo workflow, not verified', tone: 'warn' }, active: { label: 'Active (verified)', tone: 'good' }, suspended: { label: 'Suspended', tone: 'bad' } };

function ActivationDialog({ rule, onClose }: { rule: any; onClose: () => void }) {
  const qc = useQueryClient(); const toast = useToast(); const q = useQuery({ queryKey: ['activation', rule.id], queryFn: () => api<any>(`/public-data/rules/${rule.id}/activation`) }); const [ask, setAsk] = useState<'activate' | 'suspend' | null>(null);
  return (
    <Modal title={`Activation check: ${rule.code}`} onClose={onClose}>
      <Query q={q}>{(c: any) => (<div className="space-y-3">
        <p>Where it is used: <b>{c.rule.workflow_binding ?? 'nowhere yet'}</b></p>
        <p>Handbook version: {c.rule.handbook_version ?? 'not linked'}</p>
        {c.can_activate ? <p className="rounded-md bg-good-soft p-3 text-good">All activation checks pass.</p> : <div className="rounded-md bg-warn-soft p-3 text-warn"><p className="font-medium">Cannot be activated yet</p><ul className="mt-1 list-disc pl-5">{c.blockers.map((b: string, i: number) => <li key={i}>{b}</li>)}</ul></div>}
        <div className="flex gap-2">{c.can_activate && c.rule.activation_status !== 'active' && <Button variant="primary" onClick={() => setAsk('activate')}>Activate</Button>}{c.rule.activation_status === 'active' && <Button variant="danger" onClick={() => setAsk('suspend')}>Suspend</Button>}</div>
      </div>)}</Query>
      {ask && <ReasonDialog title={ask === 'activate' ? 'Activate this rule' : 'Suspend this rule'} required label="Reason" submitLabel={ask === 'activate' ? 'Activate' : 'Suspend'} onSubmit={async note => { await api(`/public-data/rules/${rule.id}/activation`, { body: { action: ask, note } }); toast.ok('Recorded'); qc.invalidateQueries({ queryKey: ['reg-rules'] }); qc.invalidateQueries({ queryKey: ['activation', rule.id] }); }} onClose={() => setAsk(null)} />}
    </Modal>);
}

export const STATUS: Record<string, { label: string; tone: any; help: string }> = {
  verified_official: { label: 'Checked against the official handbook', tone: 'good', help: 'An administrator confirmed this against the official document.' },
  verified_excerpt: { label: 'Read in a source excerpt', tone: 'teal', help: 'The statement was read in an excerpt of the named source. It still needs confirming against the original.' },
  needs_review: { label: 'Needs review', tone: 'warn', help: 'The excerpt was truncated or unclear, or the clause number is not confirmed.' },
  unverified: { label: 'Unverified', tone: 'bad', help: 'From a draft, a news article or an institution page. Not to be treated as a rule.' },
  outdated: { label: 'Outdated', tone: 'bad', help: 'Superseded by a later version.' },
  assumption: { label: 'Demo assumption', tone: 'neutral', help: 'A configurable value used in this demonstration. Not an AICTE requirement.' },
};
export const StatusBadge = ({ s }: { s: string }) => <Badge tone={STATUS[s]?.tone} title={STATUS[s]?.help}>{STATUS[s]?.label ?? s}</Badge>;

export default function Rules() {
  const { user } = useAuth(); const qc = useQueryClient(); const toast = useToast();
  const [tab, setTab] = useState('rules'); const [f, setF] = useState<Record<string, string>>(() => Object.fromEntries(new URLSearchParams(location.search))); const [page, setPage] = useState(1); const [open, setOpen] = useState<number | null>(null); const [review, setReview] = useState<any>(null); const [act, setAct] = useState<any>(null); const [st, setSt] = useState('verified_official');
  const sum = useQuery({ queryKey: ['reg-summary'], queryFn: () => api<any>('/regulatory/summary') });
  const rules = useQuery({ queryKey: ['reg-rules', f, page], queryFn: () => api<any>(`/regulatory/rules${qstr({ ...f, page, pageSize: 12 })}`), placeholderData: p => p });
  const sources = useQuery({ queryKey: ['reg-sources'], enabled: tab === 'sources', queryFn: () => api<any[]>('/regulatory/sources') });
  const set = (k: string, v: string) => { setF(x => ({ ...x, [k]: v })); setPage(1); };
  return (
    <>
      <PageHeader title="Regulatory sources and rules" subtitle="What this prototype treats as a requirement, where it comes from, and how well it is verified. Demonstration assumptions are kept separate from rules read in the handbook." />
      <Query q={sum}>{(s: any) => (
        <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {[['Read in a source excerpt', s.verified_excerpt, ''], ['Checked by an administrator', s.reviewed_by_admin, ''], ['Need review or unverified', s.needs_review, 'warn'], ['Demo assumptions', s.assumptions, ''], ['Sources', s.sources, '']].map(([l, v, t]) => (
            <div key={l as string} className="rounded-lg border border-line bg-white p-3"><p className="text-[13px] text-muted">{l}</p><p className={`text-2xl font-semibold ${t === 'warn' ? 'text-warn' : ''}`}>{v}</p></div>))}
        </div>)}</Query>
      <p className="mb-4 rounded-md bg-warn-soft px-3 py-2 text-warn">The official handbook PDF could not be downloaded automatically. Rules were read from excerpts of copies and are paraphrased. Page numbers are shown only where an excerpt showed one. An administrator should confirm each rule against the original before relying on it.</p>
      <Tabs value={tab} onChange={setTab} tabs={[{ key: 'rules', label: 'Rules' }, { key: 'sources', label: 'Sources' }]} />
      <div className="mt-4">
        {tab === 'rules' && (
          <Card pad={false}>
            <div className="grid gap-3 border-b border-line p-4 sm:grid-cols-2 lg:grid-cols-4">
              <Field label="Search">{id => <Input id={id} defaultValue={f.q ?? ''} onChange={e => set('q', e.target.value)} />}</Field>
              <Field label="Status">{id => <Select id={id} value={f.status ?? ''} onChange={e => set('status', e.target.value)}><option value="">All</option>{Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</Select>}</Field>
              <Field label="Type">{id => <Select id={id} value={f.kind ?? ''} onChange={e => set('kind', e.target.value)}><option value="">All</option><option value="regulatory_rule">Rule</option><option value="process_fact">Process fact</option><option value="configurable_assumption">Demo assumption</option></Select>}</Field>
              <label className="flex items-end gap-2 pb-2"><input type="checkbox" checked={f.flagged === '1'} onChange={e => set('flagged', e.target.checked ? '1' : '')} />Only those flagged for review</label>
            </div>
            <Query q={rules}>{(d: any) => d.rows.length === 0 ? <Empty title="No rules match" /> : (
              <><ul>{d.rows.map((r: any) => (
                <li key={r.id} className="border-b border-line/70 px-4 py-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0 flex-1"><p className="flex flex-wrap items-center gap-2"><StatusBadge s={r.verification_status} /><span className="text-[13px] text-muted">{r.code}</span>{r.flagged_for_review ? <Badge tone="warn">Flagged for review</Badge> : null}</p><p className="mt-1 font-medium">{r.title}</p></div>
                    <Button size="sm" variant="ghost" aria-expanded={open === r.id} onClick={() => setOpen(open === r.id ? null : r.id)}>{open === r.id ? 'Hide details' : 'Details'}</Button>
                  </div>
                  {open === r.id && (
                    <div className="mt-2 space-y-2 rounded-md bg-paper p-3 text-[14px]">
                      <p>{r.statement}</p>
                      <dl className="grid gap-x-6 gap-y-1 text-[13px] sm:grid-cols-2">
                        <div><dt className="text-muted">Source</dt><dd>{r.source_title ? <>{r.source_title} {r.source_url && <a className="inline-flex items-center gap-0.5 text-brand underline" href={r.source_url} target="_blank" rel="noreferrer noopener">open<ExternalLink className="h-3 w-3" aria-hidden /></a>}<br /><span className="text-muted">Trust: {r.source_trust}{r.version_label ? `, ${r.version_label}` : ''}</span></> : 'None (a configurable assumption)'}</dd></div>
                        <div><dt className="text-muted">Section</dt><dd>{r.section_ref ?? '–'}</dd></div>
                        <div><dt className="text-muted">Page</dt><dd>{r.page_ref ?? 'Not shown in the excerpt'}{r.page_note && <><br /><span className="text-muted">{r.page_note}</span></>}</dd></div>
                        <div><dt className="text-muted">Applies to</dt><dd>{r.effective_note ?? (r.effective_from ? `From ${fmtDate(r.effective_from)}` : 'Effective dates not verified')}</dd></div>
                        <div><dt className="text-muted">Handbook version</dt><dd>{r.handbook_code ?? '–'}{r.handbook_status && ` (${r.handbook_status})`}</dd></div>
                        <div><dt className="text-muted">Use in the workflow</dt><dd><Badge tone={ACT[r.activation_status]?.tone}>{ACT[r.activation_status]?.label}</Badge>{r.workflow_binding && <><br /><span className="text-muted">{r.workflow_binding}</span></>}</dd></div>
                        <div><dt className="text-muted">Last reviewed</dt><dd>{r.last_reviewed_on ? `${fmtDate(r.last_reviewed_on)} by ${r.reviewed_by_name ?? 'an administrator'}` : 'Not yet reviewed by an administrator'}</dd></div>
                        {r.review_notes && <div><dt className="text-muted">Review note</dt><dd>{r.review_notes}</dd></div>}
                      </dl>
                      {user!.role === 'admin' && r.kind !== 'configurable_assumption' && <div className="flex gap-2"><Button size="sm" onClick={() => { setReview(r); setSt('verified_official'); }}>Record a review</Button><Button size="sm" onClick={() => setAct(r)}>Check activation</Button></div>}
                    </div>)}
                </li>))}</ul>
                <Pager page={d.page} pages={d.pages} total={d.total} onPage={setPage} /></>)}</Query>
          </Card>)}
        {tab === 'sources' && (
          <Card pad={false}><Query q={sources}>{(rows: any[]) => (
            <Table><thead><tr><Th>Source</Th><Th>Trust</Th><Th>Version</Th><Th>Rules</Th><Th>Access note</Th></tr></thead>
              <tbody>{rows.map(s => <tr key={s.id}><Td className="max-w-[320px]">{s.title}{s.url && <><br /><a className="inline-flex items-center gap-0.5 break-all text-[13px] text-brand underline" href={s.url} target="_blank" rel="noreferrer noopener">{s.url.slice(0, 60)}…<ExternalLink className="h-3 w-3" aria-hidden /></a></>}</Td>
                <Td><Badge tone={s.trust === 'primary' ? 'good' : s.trust === 'secondary' ? 'teal' : 'warn'}>{s.trust}</Badge><p className="text-[13px] text-muted">{s.source_kind.replace(/_/g, ' ')}</p></Td><Td>{s.version_label ?? '–'}</Td><Td>{s.rules}</Td>
                <Td className="max-w-[320px] text-[13px]">{s.retrieved_on ? `Read on ${fmtDate(s.retrieved_on)}. ` : <b className="text-warn">Not retrieved. </b>}{s.access_note}</Td></tr>)}</tbody></Table>)}</Query></Card>)}
      </div>
      {act && <ActivationDialog rule={act} onClose={() => setAct(null)} />}
      {review && (
        <ReasonDialog title={`Review ${review.code}`} required label="What did you check, and where?" submitLabel="Save review"
          intro={<div className="space-y-2"><p>{review.title}</p><Field label="Result">{id => <Select id={id} value={st} onChange={e => setSt(e.target.value)}><option value="verified_official">Checked against the official handbook</option><option value="verified_excerpt">Still only read in an excerpt</option><option value="needs_review">Needs more review</option><option value="unverified">Unverified</option><option value="outdated">Outdated</option></Select>}</Field></div>}
          onSubmit={async notes => { await api(`/regulatory/rules/${review.id}/review`, { method: 'PUT', body: { status: st, notes } }); toast.ok('Review recorded'); qc.invalidateQueries({ queryKey: ['reg-rules'] }); qc.invalidateQueries({ queryKey: ['reg-summary'] }); }} onClose={() => setReview(null)} />)}
    </>);
}
