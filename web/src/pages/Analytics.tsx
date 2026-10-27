import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api, qstr } from '../lib/api';
import { useLookupMaps } from '../lib/hooks';
import { fmtDate } from '../lib/format';
import { Badge, Button, Card, Empty, Field, Input, PageHeader, Pager, Query, Select, Table, Td, Th, cx } from '../components/ui';
import { DrillChart, SeriesChart } from '../components/charts';

const Calc = () => <Badge tone="teal" title="Computed from stored records when this page loaded">Calculated</Badge>;
const LEVEL: Record<string, any> = { high: 'bad', medium: 'warn', low: 'good' };

export default function Analytics() {
  const nav = useNavigate(); const lk = useLookupMaps();
  const [f, setF] = useState<Record<string, string>>({}); const [dpage, setDpage] = useState(1); const [open, setOpen] = useState<string | null>(null);
  const q = useQuery({ queryKey: ['analytics', f], queryFn: () => api<any>(`/analytics${qstr(f)}`), placeholderData: p => p });
  const set = (k: string, v: string) => { setF(x => ({ ...x, [k]: v })); setDpage(1); };
  const drill = (d: Record<string, string>) => nav(`/applications${qstr({ ...f, ...d })}`);
  return (
    <>
      <PageHeader title="Analytics" subtitle="Counts, time spent per stage, bottlenecks and workload, calculated from the case records in your scope. Click any figure or bar to open the underlying cases." />
      <Card className="mb-4"><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {lk.regions.length > 1 && <Field label="Region">{id => <Select id={id} value={f.region_id ?? ''} onChange={e => set('region_id', e.target.value)}><option value="">All</option>{lk.regions.map((r: any) => <option key={r.id} value={r.id}>{r.name}</option>)}</Select>}</Field>}
        <Field label="Category">{id => <Select id={id} value={f.category ?? ''} onChange={e => set('category', e.target.value)}><option value="">All</option>{lk.categories.map((c: any) => <option key={c.code} value={c.code}>{c.name}</option>)}</Select>}</Field>
        <Field label="Submitted from">{id => <Input id={id} type="date" value={f.from ?? ''} onChange={e => set('from', e.target.value)} />}</Field>
        <Field label="Submitted to">{id => <Input id={id} type="date" value={f.to ?? ''} onChange={e => set('to', e.target.value)} />}</Field>
        <div className="flex items-end"><Button onClick={() => setF({})} disabled={!Object.keys(f).length}>Clear filters</Button></div>
      </div></Card>
      <Query q={q}>{(d: any) => {
        const t = d.totals;
        const cards = [
          ['Submitted applications', t.applications, '', {}], ['Open', t.open, '', { open: '1' }], ['Completed', t.completed, 'good', { status: 'approved' }],
          ['Past deadline', t.overdue_open, t.overdue_open ? 'bad' : 'good', { deadline: 'overdue' }], ['Due within 3 days', t.due_soon_open, 'warn', { deadline: 'due_soon' }],
          ['Unassigned', t.unassigned_open, t.unassigned_open ? 'bad' : 'good', { unassigned: '1' }], ['Stalled', t.stalled_open, t.stalled_open ? 'warn' : 'good', { stalled: '1' }],
        ] as const;
        const up = d.upcoming_deadlines.slice((dpage - 1) * 8, dpage * 8);
        return (
          <div className="space-y-4">
            <p className="rounded-md bg-teal-soft px-3 py-2 text-[13px] text-[#0b6769]">{d.data_origin} Every figure is labelled <b>Calculated</b> unless marked as a forecast.</p>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
              {cards.map(([label, value, tone, dr]) => (
                <button key={label} onClick={() => drill(dr as any)} className="rounded-lg border border-line bg-white p-3 text-left hover:border-brand/50">
                  <p className="text-[13px] text-muted">{label}</p><p className={cx('mt-1 text-[26px] font-semibold leading-none', tone === 'bad' ? 'text-bad' : tone === 'warn' ? 'text-warn' : tone === 'good' ? 'text-good' : 'text-ink')}>{value}</p></button>))}
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <Card title="Applications by status" actions={<Calc />}><DrillChart data={d.by_status} onPick={p => drill(p.drill ?? p.payload?.drill)} /></Card>
              <Card title="Applications by category" actions={<Calc />}><DrillChart data={d.by_category} onPick={p => drill(p.drill ?? p.payload?.drill)} /></Card>
              <Card title="Applications by region" actions={<Calc />}><DrillChart data={d.by_region} onPick={p => drill(p.drill ?? p.payload?.drill)} /></Card>
              <Card title="Open cases by workflow stage" actions={<Calc />}><DrillChart data={d.by_stage} onPick={p => drill(p.drill ?? p.payload?.drill)} /></Card>
            </div>

            <Card title="Bottleneck indicators" actions={<Calc />} pad={false}>
              <p className="border-b border-line px-4 py-2.5 text-[13px] text-muted">{d.bottlenecks.method}</p>
              {d.bottlenecks.rows.length === 0 ? <Empty title="No open cases" /> : (
                <Table><thead><tr><Th>Stage</Th><Th>Level</Th><Th>Open</Th><Th>Past deadline</Th><Th>Avg wait (days)</Th><Th>Historical median (days)</Th><Th><span className="sr-only">Why</span></Th></tr></thead>
                  <tbody>{d.bottlenecks.rows.map((b: any) => (
                    <>
                      <tr key={b.key}><Td className="font-medium">{b.label}</Td><Td><Badge tone={LEVEL[b.level]}>{b.level} ({b.score})</Badge></Td>
                        <Td><button className="-my-1 inline-flex min-h-[28px] min-w-[28px] items-center justify-center text-brand underline-offset-2 hover:underline" aria-label={`${b.open} open applications, show them`} onClick={() => drill(b.drill)}>{b.open}</button></Td><Td>{b.overdue} ({b.overdue_share}%)</Td><Td>{b.avg_open_age_days}</Td><Td>{b.median_completed_days ?? 'not enough history'}</Td>
                        <Td><Button size="sm" variant="ghost" aria-expanded={open === b.key} onClick={() => setOpen(open === b.key ? null : b.key)}>{open === b.key ? 'Hide' : 'Why'}</Button></Td></tr>
                      {open === b.key && <tr key={`${b.key}w`}><Td colSpan={7} className="bg-paper"><ul className="list-disc pl-5 text-[13px]">{b.explanation.map((x: string, i: number) => <li key={i}>{x}</li>)}</ul></Td></tr>}
                    </>))}</tbody></Table>)}
            </Card>

            <div className="grid gap-4 lg:grid-cols-2">
              <Card title="Time spent at each stage" actions={<Calc />} pad={false}>
                <Table fluid><thead><tr><Th>Stage</Th><Th>Completed stays</Th><Th>Median (days)</Th><Th>Open now</Th><Th>Open avg (days)</Th></tr></thead>
                  <tbody>{d.stage_time.map((s: any) => <tr key={s.key}><Td>{s.label}</Td><Td>{s.completed_stays}</Td><Td>{s.median_days ?? '–'}</Td><Td>{s.open_now}</Td><Td>{s.open_avg_age_days ?? '–'}</Td></tr>)}</tbody></Table>
              </Card>
              <Card title="Historical processing time" actions={<Calc />}>
                {d.processing_time.length === 0 ? <Empty title="No finished applications yet" /> : <SeriesChart type="line" rows={d.processing_time} x="month" series={[{ key: 'median_days', label: 'Median days to finish' }, { key: 'finished', label: 'Finished' }]} height={240} />}
              </Card>
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <Card title="Officer workload (open tasks)" actions={<Calc />} pad={false}>
                <p className="border-b border-line px-4 py-2.5 text-[13px] text-muted">{d.workload.note} {d.workload.unassigned_open > 0 && <button className="font-medium text-bad underline" onClick={() => drill({ unassigned: '1' })}>{d.workload.unassigned_open} open case(s) have no assignee.</button>}</p>
                {d.workload.officers.length === 0 ? <Empty title="No assigned tasks" /> : (
                  <Table fluid><thead><tr><Th>Officer</Th><Th>Open</Th><Th>Overdue</Th></tr></thead>
                    <tbody>{d.workload.officers.slice(0, 12).map((o: any) => (
                      <tr key={o.id}><Td>{o.name}<p className="text-[13px] text-muted">{o.role.replace('_', ' ')}{o.region ? `, ${o.region}` : ''}</p></Td>
                        <Td><div className="flex items-center gap-2"><div className="h-1.5 w-24 overflow-hidden rounded-full bg-[#e3e9f0]"><div className="h-full bg-brand" style={{ width: `${Math.min(100, (o.open / d.workload.officers[0].open) * 100)}%` }} /></div>{o.open}</div></Td>
                        <Td className={o.overdue ? 'font-medium text-bad' : ''}>{o.overdue}</Td></tr>))}</tbody></Table>)}
              </Card>
              <div className="space-y-4">
                <Card title="Overdue actions" actions={<Calc />}><dl className="grid grid-cols-2 gap-3">
                  {([['Stage tasks', d.overdue_actions.stage_tasks, '/applications?deadline=overdue'], ['EVC visits', d.overdue_actions.evc, '/evc?status=overdue'], ['Obligations', d.overdue_actions.obligations, '/compliance?status=overdue'], ['Expired documents', d.overdue_actions.expired_documents, '/documents?expiry=expired']] as const).map(([l, v, to]) => (
                    <div key={l}><dt className="text-[13px] text-muted">{l}</dt><dd><Link to={to} className={cx('text-xl font-semibold hover:underline', v ? 'text-bad' : 'text-good')}>{v}</Link></dd></div>))}</dl></Card>
                <Card title="Document expiry and EVC" actions={<Calc />}><div className="grid grid-cols-2 gap-x-6 gap-y-2 text-[14px]">
                  <p>Expired: <b>{d.documents.expired}</b></p><p>EVC queued: <b>{d.evc.queued}</b></p><p>Expiring in 30 days: <b>{d.documents.within_30}</b></p><p>EVC scheduled: <b>{(d.evc.scheduled ?? 0) + (d.evc.rescheduled ?? 0)}</b></p>
                  <p>In 31 to 60 days: <b>{d.documents.within_60}</b></p><p>EVC completed: <b>{d.evc.completed}</b></p><p>In 61 to 90 days: <b>{d.documents.within_90}</b></p><p>EVC delayed: <b className={d.evc.overdue ? 'text-bad' : ''}>{d.evc.overdue}</b></p></div></Card>
              </div>
            </div>

            <Card title="Upcoming deadlines (next 14 days)" actions={<Calc />} pad={false}>
              {d.upcoming_deadlines.length === 0 ? <Empty title="Nothing due in the next 14 days" /> : (
                <><Table><thead><tr><Th>Date</Th><Th>Type</Th><Th>Item</Th></tr></thead><tbody>{up.map((u: any, i: number) => <tr key={i}><Td className="whitespace-nowrap">{fmtDate(u.date)}</Td><Td>{u.type}</Td><Td><Link className="text-brand hover:underline" to={u.link}>{u.what}</Link></Td></tr>)}</tbody></Table>
                  <Pager page={dpage} pages={Math.max(1, Math.ceil(d.upcoming_deadlines.length / 8))} total={d.upcoming_deadlines.length} onPage={setDpage} /></>)}
            </Card>

            {d.forecast && (
              <Card title="Forecast" actions={<Badge tone="warn">Illustrative, not a confirmed status</Badge>}>
                <p className="text-muted">{d.forecast.notice}</p>
                <p className="mt-2">Likely to miss their deadline: <b>{d.forecast.likely_late}</b> · Close to the deadline: <b>{d.forecast.watch}</b> · Already past it (confirmed): <b>{d.forecast.confirmed_overdue}</b>. <Link className="text-brand underline" to="/tasks">See the reasoning for each case</Link>.</p>
              </Card>)}
            <p className="text-[13px] text-muted">Generated {d.generated_at}. {d.kinds.calculated}</p>
          </div>);
      }}</Query>
    </>);
}
