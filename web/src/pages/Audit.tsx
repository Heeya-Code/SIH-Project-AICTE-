import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ShieldCheck, ShieldAlert } from 'lucide-react';
import { api, errMsg, qstr } from '../lib/api';
import { fmtDateTime } from '../lib/format';
import { Button, Card, Empty, Field, Input, PageHeader, Pager, Query, Select, Table, Td, Th, useToast } from '../components/ui';

export default function Audit() {
  const toast = useToast();
  const [f, setF] = useState<Record<string, string>>({}); const [page, setPage] = useState(1); const [open, setOpen] = useState<number | null>(null); const [chain, setChain] = useState<any>(null);
  const types = useQuery({ queryKey: ['audit-types'], queryFn: () => api<string[]>('/audit/event-types') });
  const q = useQuery({ queryKey: ['audit', f, page], queryFn: () => api<any>(`/audit${qstr({ ...f, page, pageSize: 25 })}`), placeholderData: p => p });
  const set = (k: string, v: string) => { setF(x => ({ ...x, [k]: v })); setPage(1); };
  return (
    <>
      <PageHeader title="Audit trail" subtitle="Every significant action, recorded with the actor, the time (set by the server), and the before and after state. Entries cannot be edited or deleted through the application."
        actions={<Button onClick={async () => { try { setChain(await api('/audit/verify')); } catch (e) { toast.err(errMsg(e)); } }}>Verify chain integrity</Button>} />
      {chain && <div role="status" className={`mb-4 flex items-start gap-2 rounded-md border p-3 ${chain.ok ? 'border-good/30 bg-good-soft text-good' : 'border-bad/30 bg-bad-soft text-bad'}`}>
        {chain.ok ? <ShieldCheck className="mt-0.5 h-4 w-4" aria-hidden /> : <ShieldAlert className="mt-0.5 h-4 w-4" aria-hidden />}
        <p>{chain.ok ? `All ${chain.checked} events are linked correctly.` : `The chain breaks at event ${chain.brokenAtId}.`} <span className="opacity-80">{chain.note}</span></p></div>}
      <Card pad={false}>
        <div className="grid gap-3 border-b border-line p-4 sm:grid-cols-2 lg:grid-cols-5">
          <Field label="Event type">{id => <Select id={id} value={f.event_type ?? ''} onChange={e => set('event_type', e.target.value)}><option value="">All</option>{(types.data ?? []).map(t => <option key={t}>{t}</option>)}</Select>}</Field>
          <Field label="Actor">{id => <Input id={id} placeholder="Name or role" onChange={e => set('actor', e.target.value)} />}</Field>
          <Field label="Search">{id => <Input id={id} placeholder="Reason or state" onChange={e => set('q', e.target.value)} />}</Field>
          <Field label="From">{id => <Input id={id} type="date" onChange={e => set('from', e.target.value)} />}</Field>
          <Field label="To">{id => <Input id={id} type="date" onChange={e => set('to', e.target.value)} />}</Field>
        </div>
        <Query q={q}>{(d: any) => d.rows.length === 0 ? <Empty title="No events match" /> : (
          <><Table><thead><tr><Th>When</Th><Th>Event</Th><Th>Actor</Th><Th>Entity</Th><Th>Reason</Th><Th><span className="sr-only">Details</span></Th></tr></thead>
            <tbody>{d.rows.map((r: any) => (
              <>
                <tr key={r.id}><Td className="whitespace-nowrap">{fmtDateTime(r.at)}</Td><Td className="font-medium">{r.event_type}</Td><Td>{r.actor_label}</Td><Td>{r.entity_label ?? `${r.entity_type} ${r.entity_id ?? ''}`}<p className="text-[13px] text-muted">{r.entity_type}</p></Td><Td className="max-w-[260px]">{r.reason ?? '–'}</Td>
                  <Td><Button size="sm" variant="ghost" aria-expanded={open === r.id} onClick={() => setOpen(open === r.id ? null : r.id)}>{open === r.id ? 'Hide' : 'Details'}</Button></Td></tr>
                {open === r.id && <tr key={`${r.id}d`}><Td colSpan={6} className="bg-paper"><dl className="grid gap-2 text-[13px] sm:grid-cols-2"><div><dt className="font-semibold">Before</dt><dd className="break-all">{r.prev_state ?? '–'}</dd></div><div><dt className="font-semibold">After</dt><dd className="break-all">{r.new_state ?? '–'}</dd></div>
                  <div><dt className="font-semibold">Event id</dt><dd>{r.event_id}</dd></div><div><dt className="font-semibold">Correlation id</dt><dd>{r.correlation_id ?? '–'}</dd></div></dl></Td></tr>}
              </>))}</tbody></Table>
            <Pager page={d.page} pages={d.pages} total={d.total} onPage={setPage} /></>)}</Query>
      </Card>
    </>);
}
