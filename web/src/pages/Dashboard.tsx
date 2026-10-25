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

const LIST_TARGETS: Record<string, string> = {
  actions: '/tasks',
  deadlines: '/compliance',
  subs: '/applications',
  ovr: '/applications?deadline=overdue',
  recent: '/applications',
  esc: '/inbox?tab=escalations',
  long: '/applications',
  wait: '/applications?stage=decision',
  up: '/evc',
  q: '/evc?status=queued',
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
        <div className="space-y-6">
          {/* Stat cards: responsive 4-col wide, 2-col tablet, 1-col phone; min-w-0 on each child prevents overflow */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
            {d.cards.map((c: any) => {
              const inner = (
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-medium text-muted truncate" title={c.label}>{c.label}</p>
                  <p className={cx('mt-1.5 text-[28px] font-bold leading-none tracking-tight tabular-nums truncate', TONE[c.tone ?? 'neutral'])} title={String(c.value)}>
                    {c.value}
                  </p>
                  {c.hint && <p className="mt-1 text-xs text-muted truncate" title={c.hint}>{c.hint}</p>}
                </div>
              );
              return c.link ? (
                <button key={c.key} onClick={() => nav(c.link)}
                  className="group min-w-0 rounded-lg border border-line bg-white p-4 text-left shadow-xs hover:border-brand/50 hover:shadow-sm transition-all duration-100 flex items-start justify-between gap-2">
                  {inner}
                  <ArrowUpRight className="h-4 w-4 shrink-0 text-muted opacity-0 group-hover:opacity-100 group-hover:text-brand transition-all mt-0.5" aria-hidden />
                </button>
              ) : (
                <div key={c.key} className="min-w-0 rounded-lg border border-line bg-white p-4 shadow-xs">
                  {inner}
                </div>
              );
            })}
          </div>
          {d.health && (
            <Card title="System health">
              <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-sm">
                <li className="flex items-center gap-2 min-w-0">
                  <CheckCircle2 className="h-4 w-4 shrink-0 text-good" aria-hidden />
                  <span className="truncate">Database {d.health.database}</span>
                </li>
                <li className="flex items-center gap-2 min-w-0">
                  {d.health.audit_chain === 'intact' ? <CheckCircle2 className="h-4 w-4 shrink-0 text-good" aria-hidden /> : <ShieldAlert className="h-4 w-4 shrink-0 text-bad" aria-hidden />}
                  <span className="truncate">Audit chain {d.health.audit_chain} ({d.health.audit_events_checked} events)</span>
                </li>
                <li className="flex items-center min-w-0">
                  <span className="truncate">Last job run: {d.health.last_job ? `${d.health.last_job.status}, ${fmtDate(d.health.last_job.at)}` : 'none yet'}</span>
                </li>
                <li className="flex items-center min-w-0">
                  {d.health.clock_pinned ? <Badge tone="warn">Simulated date {fmtDate(d.health.clock_today)}</Badge> : <span className="truncate">Clock: real time ({fmtDate(d.health.clock_today)})</span>}
                </li>
              </ul>
            </Card>
          )}
          {d.charts.length > 0 && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {d.charts.map((c: any) => (
                <Card key={c.key} title={c.title} className="min-w-0">
                  <NameValueChart data={c.data} type={c.type} />
                </Card>
              ))}
            </div>
          )}
          {/* Lists: two-column grid on desktop, single column below; fluid tables prevent all side scrolling */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {d.lists.map((l: any) => {
              const isNoScrollbar = ['subs', 'deadlines'].includes(l.key);
              const visibleRows = l.rows.slice(0, 8);
              const hasMore = l.rows.length > 8;
              const targetUrl = LIST_TARGETS[l.key] ?? '/applications';
              return (
                <Card key={l.key} title={l.title} pad={false}
                  actions={hasMore ? <Link to={targetUrl} className="text-[13px] font-medium text-brand hover:underline">View all</Link> : undefined}>
                  {visibleRows.length === 0 ? <Empty title={l.empty ?? 'Nothing to show'} /> : (
                    <Table fluid={true} className={isNoScrollbar ? 'no-scrollbar' : 'max-h-[360px]'}>
                      <thead>
                        <tr>
                          {l.columns.map((c: any) => <Th key={c.key}>{c.label}</Th>)}
                        </tr>
                      </thead>
                      <tbody>
                        {visibleRows.map((r: any, i: number) => (
                          <tr key={i} className={r.link ? 'cursor-pointer hover:bg-paper/70 transition-colors' : ''} onClick={() => r.link && nav(r.link)}>
                            {l.columns.map((c: any, j: number) => {
                              const isNum = typeof r[c.key] === 'number' || /^-?\d+(\.\d+)?$/.test(String(r[c.key]));
                              const isDate = /^\d{4}-\d{2}-\d{2}/.test(String(r[c.key]));
                              return (
                                <Td key={c.key} className={cx(isNum && 'tabular-nums', j === 0 && 'font-medium')}>
                                  {j === 0 && r.link ? (
                                    <Link className="text-brand hover:underline" to={r.link} onClick={e => e.stopPropagation()}>
                                      {String(r[c.key] ?? '–')}
                                    </Link>
                                  ) : isDate ? (
                                    fmtDate(r[c.key])
                                  ) : (
                                    String(r[c.key] ?? '–')
                                  )}
                                </Td>
                              );
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </Table>
                  )}
                </Card>
              );
            })}
          </div>
        </div>
      )}
      </Query>
    </>
  );
}

