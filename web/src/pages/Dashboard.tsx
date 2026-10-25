import { Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Badge, Card, Empty, PageHeader, Query, Table, Td, Th, cx, Button } from '../components/ui';
import { NameValueChart } from '../components/charts';
import { fmtDate } from '../lib/format';
import { ArrowUpRight, CheckCircle2, ShieldAlert } from 'lucide-react';

const TONE: Record<string, string> = { good: 'text-good', warn: 'text-warn', bad: 'text-bad', neutral: 'text-ink', brand: 'text-brand' };
const TITLE: Record<string, string> = {
  institution: 'Your applications and obligations', regional_officer: 'Regional overview', bureau_officer: 'Pendency and workload', evc_coordinator: 'EVC scheduling',
  competent_authority: 'Decisions and escalations', admin: 'System overview',
};

export default function Dashboard() {
  const { user } = useAuth();
  const nav = useNavigate();
  const q = useQuery({ queryKey: ['dashboard'], queryFn: () => api<any>('/dashboard'), refetchInterval: 120_000 });
  return (
    <>
      <PageHeader title={TITLE[user!.role]} subtitle={`Signed in as ${user!.name}${user!.institution_name ? `, ${user!.institution_name}` : user!.region_name ? `, ${user!.region_name}` : ''}. Figures are calculated from the current database.`}
        actions={user!.role === 'institution' ? <Link to="/applications/new"><Button variant="primary">New application</Button></Link> : undefined} />
      <Query q={q}>{(d: any) => (
        <div className="space-y-5">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {d.cards.map((c: any) => {
              const inner = (<><p className="text-[13px] text-muted">{c.label}</p>
                <p className={cx('mt-1 text-[28px] font-semibold leading-none', TONE[c.tone ?? 'neutral'])}>{c.value}</p>{c.hint && <p className="mt-1 text-xs text-muted">{c.hint}</p>}</>);
              return c.link ? <button key={c.key} onClick={() => nav(c.link)} className="group rounded-lg border border-line bg-white p-4 text-left hover:border-brand/50"><span className="flex justify-between">{inner}<ArrowUpRight className="h-4 w-4 text-muted opacity-0 group-hover:opacity-100" aria-hidden /></span></button>
                : <div key={c.key} className="rounded-lg border border-line bg-white p-4">{inner}</div>;
            })}
          </div>
          {d.health && (
            <Card title="System health">
              <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                <li className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-good" aria-hidden />Database {d.health.database}</li>
                <li className="flex items-center gap-2">{d.health.audit_chain === 'intact' ? <CheckCircle2 className="h-4 w-4 text-good" aria-hidden /> : <ShieldAlert className="h-4 w-4 text-bad" aria-hidden />}Audit chain {d.health.audit_chain} ({d.health.audit_events_checked} events)</li>
                <li>Last job run: {d.health.last_job ? `${d.health.last_job.status}, ${fmtDate(d.health.last_job.at)}` : 'none yet'}</li>
                <li>{d.health.clock_pinned ? <Badge tone="warn">Simulated date {fmtDate(d.health.clock_today)}</Badge> : <>Clock: real time ({fmtDate(d.health.clock_today)})</>}</li>
              </ul>
            </Card>)}
          {d.charts.length > 0 && <div className="grid gap-4 lg:grid-cols-2">{d.charts.map((c: any) => <Card key={c.key} title={c.title}><NameValueChart data={c.data} type={c.type} /></Card>)}</div>}
          <div className="grid gap-4 lg:grid-cols-2">
            {d.lists.map((l: any) => (
              <Card key={l.key} title={l.title} pad={false}>
                {l.rows.length === 0 ? <Empty title={l.empty ?? 'Nothing to show'} /> : (
                  <Table fluid={['subs', 'deadlines'].includes(l.key)} className={['subs', 'deadlines'].includes(l.key) ? 'no-scrollbar' : 'max-h-[360px]'}><thead><tr>{l.columns.map((c: any) => <Th key={c.key}>{c.label}</Th>)}</tr></thead>
                    <tbody>{l.rows.map((r: any, i: number) => (
                      <tr key={i} className={r.link ? 'cursor-pointer hover:bg-paper' : ''} onClick={() => r.link && nav(r.link)}>
                        {l.columns.map((c: any, j: number) => <Td key={c.key}>{j === 0 && r.link ? <Link className="whitespace-nowrap text-brand hover:underline" to={r.link} onClick={e => e.stopPropagation()}>{String(r[c.key] ?? '–')}</Link> : /^\d{4}-\d{2}-\d{2}$/.test(String(r[c.key])) ? fmtDate(r[c.key]) : String(r[c.key] ?? '–')}</Td>)}
                      </tr>))}</tbody></Table>)}
              </Card>))}
          </div>
        </div>)}
      </Query>
    </>);
}
