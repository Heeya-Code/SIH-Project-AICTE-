import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, errMsg, qstr } from '../lib/api';
import { useAuth } from '../lib/auth';
import { fmtDate, fmtDateTime, pretty, toneFor } from '../lib/format';
import { Badge, Button, Card, Empty, PageHeader, Pager, Query, Table, Tabs, Td, Th, useToast } from '../components/ui';

export function Notifications({ embedded }: { embedded?: boolean }) {
  const nav = useNavigate(); const qc = useQueryClient(); const toast = useToast();
  const [tab, setTab] = useState('all'); const [page, setPage] = useState(1);
  const params = { page, pageSize: 15, unread: tab === 'unread' ? 1 : undefined, pending_ack: tab === 'ack' ? 1 : undefined };
  const q = useQuery({ queryKey: ['notifications', tab, page], queryFn: () => api<any>(`/notifications${qstr(params)}`), placeholderData: p => p });
  const counts = useQuery({ queryKey: ['unread'], queryFn: () => api<any>('/notifications/unread-count') });
  const refresh = () => { qc.invalidateQueries({ queryKey: ['notifications'] }); qc.invalidateQueries({ queryKey: ['unread'] }); };
  const act = useMutation({ mutationFn: (p: { path: string }) => api(p.path, { method: 'POST', body: {} }), onSuccess: refresh, onError: e => toast.err(errMsg(e)) });
  return (
    <>
      <PageHeader title="Notifications" subtitle={embedded ? undefined : "Everything sent to you is kept here. Email is simulated in this prototype, and its delivery status is shown."}
        actions={<Button disabled={!counts.data?.unread} onClick={() => act.mutate({ path: '/notifications/read-all' })}>Mark all as read</Button>} />
      <Tabs value={tab} onChange={t => { setTab(t); setPage(1); }} tabs={[{ key: 'all', label: 'All' }, { key: 'unread', label: 'Unread', count: counts.data?.unread }, { key: 'ack', label: 'Needs acknowledgment', count: counts.data?.pending_ack }]} />
      <Card pad={false} className="mt-4">
        <Query q={q}>{(d: any) => d.rows.length === 0 ? <Empty title={tab === 'all' ? 'No notifications yet' : 'Nothing here'} hint="New reminders, assignments and decisions will appear here." /> : (
          <><ul>{d.rows.map((n: any) => (
            <li key={n.id} className={`flex flex-wrap items-start justify-between gap-3 border-b border-line/70 px-4 py-3 ${n.read_at ? '' : 'bg-brand-soft/40'}`}>
              <div className="min-w-0 flex-1">
                <p className="font-medium">{!n.read_at && <span className="mr-1.5 inline-block h-2 w-2 rounded-full bg-brand" role="img" aria-label="Unread" />}{n.title}</p>
                <p className="text-muted">{n.body}</p>
                <p className="mt-1 flex flex-wrap items-center gap-2 text-[13px] text-muted">{fmtDateTime(n.created_at)}
                  {n.deliveries.filter((x: any) => x.channel === 'email').map((x: any, i: number) => <Badge key={i} tone={toneFor(x.status)} title={x.last_error ?? undefined}>Email: {pretty(x.status)}{x.attempts > 1 ? ` (${x.attempts} tries)` : ''}</Badge>)}
                  {n.ack_required ? (n.acked_at ? <Badge tone="good">Acknowledged</Badge> : <Badge tone="warn">Needs acknowledgment</Badge>) : null}</p>
              </div>
              <div className="flex gap-2">
                {n.link && <Button size="sm" onClick={() => { if (!n.read_at) act.mutate({ path: `/notifications/${n.id}/read` }); nav(n.link); }}>Open</Button>}
                {n.ack_required && !n.acked_at && <Button size="sm" variant="primary" onClick={() => act.mutate({ path: `/notifications/${n.id}/ack` })}>Acknowledge</Button>}
                {!n.read_at && <Button size="sm" variant="ghost" onClick={() => act.mutate({ path: `/notifications/${n.id}/read` })}>Mark read</Button>}
              </div></li>))}</ul>
            <Pager page={d.page} pages={d.pages} total={d.total} onPage={setPage} /></>)}</Query>
      </Card>
    </>);
}

export function Escalations({ embedded }: { embedded?: boolean }) {
  const { user } = useAuth(); const qc = useQueryClient(); const toast = useToast();
  const [status, setStatus] = useState('open'); const [all, setAll] = useState(user!.role === 'admin'); const [page, setPage] = useState(1);
  const q = useQuery({ queryKey: ['escalations', status, all, page], queryFn: () => api<any>(`/escalations${qstr({ status, all: all ? 1 : undefined, page, pageSize: 15 })}`), placeholderData: p => p });
  const ack = useMutation({ mutationFn: (id: number) => api(`/escalations/${id}/ack`, { body: {} }), onSuccess: () => { toast.ok('Acknowledged'); qc.invalidateQueries({ queryKey: ['escalations'] }); }, onError: e => toast.err(errMsg(e)) });
  return (
    <>
      {!embedded && <PageHeader title="Escalations" subtitle="Raised automatically when a deadline passes, under the configured rules. They close by themselves when the underlying work is done." />}
      <Card pad={false}>
        <div className="flex flex-wrap items-center gap-4 border-b border-line p-4">
          <label className="flex items-center gap-2">Status
            <select className="rounded-md border border-line px-2 py-1.5" value={status} onChange={e => { setStatus(e.target.value); setPage(1); }}><option value="">All</option><option value="open">Open</option><option value="acknowledged">Acknowledged</option><option value="cancelled">Cancelled (resolved)</option></select></label>
          {user!.role !== 'admin' && <label className="flex items-center gap-2"><input type="checkbox" checked={all} onChange={e => { setAll(e.target.checked); setPage(1); }} />Include those sent to colleagues in my scope</label>}
        </div>
        <Query q={q}>{(d: any) => d.rows.length === 0 ? <Empty title="No escalations" hint="Nothing has gone past its deadline far enough to escalate." /> : (
          <><Table><thead><tr><Th>Level</Th><Th>What happened</Th><Th>Sent to</Th><Th>Raised</Th><Th>Status</Th><Th><span className="sr-only">Actions</span></Th></tr></thead>
            <tbody>{d.rows.map((x: any) => (
              <tr key={x.id}><Td><Badge tone={x.level > 1 ? 'bad' : 'warn'}>Level {x.level}</Badge></Td>
                <Td className="max-w-[360px]">{x.reason}<p className="text-[13px] text-muted">{x.institution_name}, {x.overdue_days} day(s) overdue{x.application_ref && <> · <Link className="text-brand hover:underline" to={`/applications/${x.application_id}`}>{x.application_ref}</Link></>}</p></Td>
                <Td>{x.recipient_name}<p className="text-[13px] text-muted">{pretty(x.recipient_role)}</p></Td><Td>{fmtDate(x.triggered_at.slice(0, 10))}</Td>
                <Td><Badge tone={toneFor(x.status)}>{pretty(x.status)}</Badge>{x.cancel_reason && <p className="text-[13px] text-muted">{x.cancel_reason}</p>}</Td>
                <Td>{x.status === 'open' && x.recipient_user_id === user!.id && <Button size="sm" variant="primary" onClick={() => ack.mutate(x.id)}>Acknowledge</Button>}</Td></tr>))}</tbody></Table>
            <Pager page={d.page} pages={d.pages} total={d.total} onPage={setPage} /></>)}</Query>
      </Card>
    </>);
}
