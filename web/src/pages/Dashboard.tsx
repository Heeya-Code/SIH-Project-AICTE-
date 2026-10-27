import { Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useLookups } from '../lib/hooks';
import { Badge, Card, Empty, PageHeader, Query, Table, Td, Th, cx, Button } from '../components/ui';
import { NameValueChart } from '../components/charts';
import { fmtDate } from '../lib/format';
import { AttentionPanel, GroupedDeadlines } from '../components/Attention';
import { ArrowUpRight, CheckCircle2, ShieldAlert, Calendar, Clock, AlertTriangle, FileText, Building2, MapPin, CalendarClock, ShieldCheck, Bell, Users, FileClock, Gavel } from 'lucide-react';

// An icon that matches what the figure counts, so tiles can be told apart at a glance.
const iconFor = (label: string) => { const l = label.toLowerCase(); const cls = 'h-4 w-4';
  return /overdue|late|past/.test(l) ? <AlertTriangle className={cls} /> : /expir|renew|valid/.test(l) ? <FileClock className={cls} /> : /obligation|complian|undertak/.test(l) ? <ShieldCheck className={cls} />
    : /evc|visit|schedul|committee/.test(l) ? <CalendarClock className={cls} /> : /escalat|alert|remind/.test(l) ? <Bell className={cls} /> : /officer|unassigned|workload|user/.test(l) ? <Users className={cls} />
    : /decision|authori/.test(l) ? <Gavel className={cls} /> : /progress|pending|wait|stage/.test(l) ? <Clock className={cls} /> : <FileText className={cls} />; };

const TONE: Record<string, string> = { good: 'text-success', warn: 'text-warning', bad: 'text-danger', neutral: 'text-[#0F172A]', brand: 'text-[#2F5BEA]' };
const TITLE: Record<string, string> = {
  institution: 'Your applications and obligations', regional_officer: 'Regional overview', bureau_officer: 'Pendency and workload', evc_coordinator: 'EVC scheduling',
  competent_authority: 'Decisions and escalations', admin: 'System overview',
};

const QUESTION: Record<string, string> = {
  institution: 'What do I need to do next?', regional_officer: 'Which cases need my attention first?', bureau_officer: 'Where is work piling up, and who is it waiting on?',
  evc_coordinator: 'Which visits must I schedule or report on?', competent_authority: 'Which cases are waiting for my decision?', admin: 'Is everything configured, running and reviewed?',
};
const greeting = () => { const h = new Date().getHours(); return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'; };

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
  const lookups = useLookups();
  const q = useQuery({ queryKey: ['dashboard'], queryFn: () => api<any>('/dashboard'), refetchInterval: 120_000 });

  const firstName = user?.name ? user.name.replace(/^(Dr\.|Prof\.|Mr\.|Ms\.)\s+/, '').split(' ')[0] : 'User';
  const todayStr = lookups.data?.clock?.today ? fmtDate(lookups.data.clock.today) : fmtDate(new Date().toISOString().slice(0, 10));

  return (
    <>
      {/* Hero Band */}
      <div className="dashboard-hero mb-6 rounded-[14px] border border-[#E2E8F0] bg-gradient-to-r from-[#EEF3FF] via-white to-white p-6 sm:p-8 shadow-xs">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex flex-wrap items-center gap-2 mb-2">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-[#2F5BEA]/10 px-3 py-1 text-xs font-semibold text-[#2F5BEA]">
                <Building2 className="h-3.5 w-3.5" /> {user!.role_label}
              </span>
              {user!.region_name && (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-white px-3 py-1 text-xs font-medium text-[#475569] border border-[#E2E8F0]">
                  <MapPin className="h-3.5 w-3.5 text-[#94A3B8]" /> {user!.region_name}
                </span>
              )}
            </div>
            <h1 className="text-2xl sm:text-[28px] font-semibold text-[#0F172A] tracking-tight">{greeting()}, {firstName}</h1>
            <p className="mt-1 text-sm text-[#475569]">
              <span className="font-semibold text-[#0F172A]">{QUESTION[user!.role]}</span> {TITLE[user!.role]}.
            </p>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            <div className="flex items-center gap-2 rounded-[10px] bg-white px-4 py-2.5 border border-[#E2E8F0] shadow-xs text-xs font-medium text-[#475569]">
              <Calendar className="h-4 w-4 text-[#2F5BEA]" />
              <span>Today: <strong className="text-[#0F172A]">{todayStr}</strong></span>
            </div>
            {user!.role === 'institution' && (
              <Link to="/applications/new">
                <Button variant="primary">New application</Button>
              </Link>
            )}
          </div>
        </div>
      </div>

      <Query q={q}>{(d: any) => (
        <div className="space-y-6">
          {d.attention && <AttentionPanel a={d.attention} role={user!.role} />}
          {/* KPI Stat Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {d.cards.map((c: any) => {
              const toneCls = TONE[c.tone ?? 'neutral'];
              const inner = (
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-[13px] font-medium text-[#475569] truncate" title={c.label}>{c.label}</p>
                    <div className={cx('flex h-8 w-8 items-center justify-center rounded-lg', c.tone === 'good' ? 'bg-[#E8F7EE] text-[#15803D]' : c.tone === 'warn' ? 'bg-[#FFF4E0] text-[#B45309]' : c.tone === 'bad' ? 'bg-[#FDECEC] text-[#B91C1C]' : 'bg-[#EEF3FF] text-[#2F5BEA]')}>
                      {iconFor(c.label)}
                    </div>
                  </div>
                  <p className={cx('text-[32px] font-bold leading-none tracking-tight tabular-nums truncate', toneCls)} title={String(c.value)}>
                    {c.value}
                  </p>
                  {c.hint && <p className="mt-2 text-xs text-[#566579] truncate" title={c.hint}>{c.hint}</p>}
                </div>
              );
              return c.link ? (
                <button key={c.key} onClick={() => nav(c.link)}
                  className="dashboard-stat group min-w-0 rounded-[14px] border border-[#E2E8F0] bg-white p-5 text-left shadow-xs hover:border-[#2F5BEA]/50 hover:shadow-md transition-all duration-150 flex flex-col justify-between">
                  {inner}
                  <div className="mt-4 flex items-center justify-between text-xs font-medium text-[#2449C7]">
                    <span>View details</span>
                    <ArrowUpRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
                  </div>
                </button>
              ) : (
                <div key={c.key} className="dashboard-stat min-w-0 rounded-[14px] border border-[#E2E8F0] bg-white p-5 shadow-xs flex flex-col justify-between">
                  {inner}
                </div>
              );
            })}
          </div>

          {/* System Health */}
          {d.health && (
            <Card title="System health and status">
              <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 text-sm">
                <li className="flex items-center gap-2.5 min-w-0 rounded-lg bg-[#F5F7FB] p-3 border border-[#E2E8F0]">
                  <CheckCircle2 className="h-4 w-4 shrink-0 text-[#15803D]" aria-hidden />
                  <span className="truncate font-medium text-[#0F172A]">Database: <span className="text-[#475569]">{d.health.database}</span></span>
                </li>
                <li className="flex items-center gap-2.5 min-w-0 rounded-lg bg-[#F5F7FB] p-3 border border-[#E2E8F0]">
                  {d.health.audit_chain === 'intact' ? <CheckCircle2 className="h-4 w-4 shrink-0 text-[#15803D]" aria-hidden /> : <ShieldAlert className="h-4 w-4 shrink-0 text-[#B91C1C]" aria-hidden />}
                  <span className="truncate font-medium text-[#0F172A]">Audit chain: <span className="text-[#475569]">{d.health.audit_chain}</span></span>
                </li>
                <li className="flex items-center gap-2.5 min-w-0 rounded-lg bg-[#F5F7FB] p-3 border border-[#E2E8F0]">
                  <Clock className="h-4 w-4 shrink-0 text-[#2F5BEA]" />
                  <span className="truncate font-medium text-[#0F172A]">Last job: <span className="text-[#475569]">{d.health.last_job ? `${d.health.last_job.status}` : 'none'}</span></span>
                </li>
                <li className="flex items-center gap-2.5 min-w-0 rounded-lg bg-[#F5F7FB] p-3 border border-[#E2E8F0]">
                  {d.health.clock_pinned ? <Badge tone="warn">Simulated: {fmtDate(d.health.clock_today)}</Badge> : <span className="truncate font-medium text-[#0F172A]">Clock: <span className="text-[#475569]">Real-time</span></span>}
                </li>
              </ul>
            </Card>
          )}

          {/* Charts */}
          {d.charts.length > 0 && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {d.charts.map((c: any) => (
                <Card key={c.key} title={c.title} className="min-w-0">
                  <div className="pt-2">
                    <NameValueChart data={c.data} type={c.type} />
                  </div>
                </Card>
              ))}
            </div>
          )}

          {/* Lists / Tables */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {d.lists.map((l: any) => {
              if (l.grouped) return <GroupedDeadlines key={l.key} l={l} />;
              const isNoScrollbar = ['subs', 'deadlines'].includes(l.key);
              const visibleRows = l.rows.slice(0, 8);
              const hasMore = l.rows.length > 8;
              const targetUrl = LIST_TARGETS[l.key] ?? '/applications';
              return (
                <Card key={l.key} title={l.title} pad={false}
                  actions={hasMore ? <Link to={targetUrl} className="text-xs font-semibold text-[#2F5BEA] hover:underline">View all ({l.rows.length})</Link> : undefined}>
                  {visibleRows.length === 0 ? <Empty title={l.empty ?? 'Nothing to show'} /> : (
                    <Table fluid={true} className={isNoScrollbar ? 'no-scrollbar' : 'max-h-[380px]'}>
                      <thead>
                        <tr>
                          {l.columns.map((c: any) => <Th key={c.key}>{c.label}</Th>)}
                        </tr>
                      </thead>
                      <tbody>
                        {visibleRows.map((r: any, i: number) => (
                          <tr key={i} className={cx(r.link ? 'cursor-pointer hover:bg-[#EEF3FF]/40 transition-colors' : '')} onClick={() => r.link && nav(r.link)}>
                            {l.columns.map((c: any, j: number) => {
                              const val = r[c.key];
                              const isNum = typeof val === 'number' || /^-?\d+(\.\d+)?$/.test(String(val));
                              const isDate = /^\d{4}-\d{2}-\d{2}/.test(String(val));
                              return (
                                <Td key={c.key} className={cx(isNum && 'tabular-nums', j === 0 && 'font-semibold text-[#0F172A]')}>
                                  {j === 0 && r.link ? (
                                    <Link className="text-[#2F5BEA] hover:underline font-semibold" to={r.link} onClick={e => e.stopPropagation()}>
                                      {String(val ?? '–')}
                                    </Link>
                                  ) : isDate ? (
                                    fmtDate(val)
                                  ) : (
                                    String(val ?? '–')
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
