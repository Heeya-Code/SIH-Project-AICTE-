import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api, qstr } from '../lib/api';
import { useAuth } from '../lib/auth';
import { daysLabel, fmtDate, pretty } from '../lib/format';
import { Badge, Card, Empty, PageHeader, Pager, Query, Table, Tabs, Td, Th } from '../components/ui';
import { SeriesChart } from '../components/charts';

const RISK: Record<string, { label: string; tone: any }> = { confirmed_overdue: { label: 'Overdue (confirmed)', tone: 'bad' }, likely_late: { label: 'Likely late (forecast)', tone: 'warn' }, watch: { label: 'Watch', tone: 'warn' }, on_track: { label: 'On track', tone: 'good' } };

export default function Tasks() {
  const { user } = useAuth(); const staff = user!.role !== 'institution';
  const [tab, setTab] = useState('mine'); const [page, setPage] = useState(1);
  const tasks = useQuery({ queryKey: ['tasks', tab, page], enabled: tab === 'mine' || tab === 'all', queryFn: () => api<any>(`/tasks${qstr({ scope: tab === 'all' ? 'all' : undefined, page, pageSize: 15 })}`) });
  const stage = useQuery({ queryKey: ['rep', 'pendency_stage'], enabled: tab === 'pendency', queryFn: () => api<any>('/reports/pendency_stage?pageSize=50') });
  const dur = useQuery({ queryKey: ['rep', 'stage_duration'], enabled: tab === 'pendency', queryFn: () => api<any>('/reports/stage_duration?pageSize=50') });
  const fc = useQuery({ queryKey: ['forecast'], enabled: tab === 'forecast', queryFn: () => api<any>('/forecast') });
  const tabs = [{ key: 'mine', label: 'My tasks' }, ...(staff ? [{ key: 'all', label: 'All tasks in my scope' }, { key: 'pendency', label: 'Pendency and ageing' }, ...(user!.role !== 'evc_coordinator' ? [{ key: 'forecast', label: 'Forecast' }] : [])] : [])];
  return (
    <>
      <PageHeader title="Tasks and pendency" subtitle="Open work, how long stages are taking, and which cases are at risk of missing their deadline." />
      <Tabs tabs={tabs} value={tab} onChange={t => { setTab(t); setPage(1); }} />
      <div className="mt-4">
        {(tab === 'mine' || tab === 'all') && (
          <Card pad={false}><Query q={tasks}>{(d: any) => d.rows.length === 0 ? <Empty title="No open tasks" hint="Tasks are created automatically when an application enters your stage." /> : (
            <><Table><thead><tr><Th>Task</Th><Th>Institution</Th><Th>Owner</Th><Th>Due</Th></tr></thead>
              <tbody>{d.rows.map((t: any) => (
                <tr key={t.id}><Td><Link className="font-medium text-brand hover:underline" to={`/applications/${t.application_id}`}>{t.title}</Link></Td><Td>{t.institution_name}</Td><Td>{t.assigned_name ?? pretty(t.role)}</Td>
                  <Td>{t.due_date ? <>{fmtDate(t.due_date)}<p className={`text-[13px] ${t.days_to_due < 0 ? 'font-medium text-bad' : t.days_to_due <= 3 ? 'text-warn' : 'text-muted'}`}>{daysLabel(t.days_to_due)}</p></> : '–'}</Td></tr>))}</tbody></Table>
              <Pager page={d.page} pages={d.pages} total={d.total} onPage={setPage} /></>)}</Query></Card>)}
        {tab === 'pendency' && (
          <div className="grid gap-4 lg:grid-cols-2">
            <Card title="Pending applications by stage"><Query q={stage}>{(d: any) => d.rows.length === 0 ? <Empty title="No pending applications" /> : <SeriesChart type="bar" rows={d.chartRows} x={d.chart.x} series={d.chart.series} />}</Query></Card>
            <Card title="Completed stage duration (days)"><Query q={dur}>{(d: any) => d.rows.length === 0 ? <Empty title="No completed stages yet" /> : <SeriesChart type="bar" rows={d.chartRows} x={d.chart.x} series={d.chart.series} />}</Query></Card>
            <Card title="Average days in current stage" pad={false} className="lg:col-span-2"><Query q={stage}>{(d: any) => (
              <Table><thead><tr><Th>Stage</Th><Th>Pending</Th><Th>Overdue</Th><Th>Avg days in stage</Th></tr></thead><tbody>{d.rows.map((r: any) => <tr key={r.stage}><Td>{r.stage}</Td><Td>{r.pending}</Td><Td className={r.overdue ? 'font-medium text-bad' : ''}>{r.overdue}</Td><Td>{r.avg_days_in_stage}</Td></tr>)}</tbody></Table>)}</Query></Card>
          </div>)}
        {tab === 'forecast' && (
          <Card pad={false}><Query q={fc}>{(d: any) => (
            <><p className="border-b border-line bg-warn-soft px-4 py-2.5 text-warn">{d.notice}</p>
              {d.rows.length === 0 ? <Empty title="Nothing to forecast" /> : (
                <Table><thead><tr><Th>Application</Th><Th>Stage</Th><Th>Deadline</Th><Th>Assessment</Th><Th>Why</Th></tr></thead>
                  <tbody>{d.rows.map((r: any) => (
                    <tr key={r.id}><Td><Link className="font-medium text-brand hover:underline" to={`/applications/${r.id}`}>{r.ref}</Link><p className="text-[13px] text-muted">{r.institution}</p></Td><Td>{r.stage}</Td>
                      <Td>{fmtDate(r.due)}<p className="text-[13px] text-muted">{daysLabel(r.days_to_due)}</p></Td>
                      <Td><Badge tone={RISK[r.risk].tone}>{RISK[r.risk].label}</Badge><p className="text-[13px] text-muted">Confidence: {r.confidence}</p></Td>
                      <Td className="max-w-[380px]"><ul className="list-disc pl-4 text-[13px]">{r.factors.map((f: string, i: number) => <li key={i}>{f}</li>)}</ul></Td></tr>))}</tbody></Table>)}</>)}</Query></Card>)}
      </div>
    </>);
}
