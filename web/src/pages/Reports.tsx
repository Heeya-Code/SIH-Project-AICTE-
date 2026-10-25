import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Download } from 'lucide-react';
import { api, download, qstr } from '../lib/api';
import { useLookupMaps } from '../lib/hooks';
import { cx, Button, Card, Empty, Field, Input, PageHeader, Pager, Query, Select, Table, Td, Th, useToast } from '../components/ui';
import { SeriesChart } from '../components/charts';

export default function Reports() {
  const toast = useToast(); const lk = useLookupMaps();
  const list = useQuery({ queryKey: ['report-list'], queryFn: () => api<any[]>('/reports') });
  const [key, setKey] = useState('pendency_stage'); const [f, setF] = useState<Record<string, string>>({}); const [page, setPage] = useState(1);
  const meta = list.data?.find(r => r.key === key) ?? list.data?.[0];
  const active = meta?.key ?? key;
  const q = useQuery({ queryKey: ['report', active, f, page], enabled: !!meta, queryFn: () => api<any>(`/reports/${active}${qstr({ ...f, page, pageSize: 20 })}`), placeholderData: p => p });
  const set = (k: string, v: string) => { setF(x => ({ ...x, [k]: v })); setPage(1); };
  const has = (k: string) => meta?.filters.includes(k);
  const exp = (format: string) => download(`/reports/${active}${qstr({ ...f, format })}`, `${active}.${format}`).catch(e => toast.err(e.message));
  return (
    <>
      <PageHeader title="Reports and analytics" subtitle="Calculated from live records within your access scope. Exports respect the same filters and scope."
        actions={<><Button onClick={() => exp('csv')}><Download className="h-4 w-4" aria-hidden />CSV</Button><Button onClick={() => exp('pdf')}><Download className="h-4 w-4" aria-hidden />PDF</Button></>} />
      <div className="grid gap-4 lg:grid-cols-[250px_1fr]">
        <nav aria-label="Reports" className="rounded-lg border border-line bg-white p-1.5 lg:self-start">
          {(list.data ?? []).map(r => <button key={r.key} onClick={() => { setKey(r.key); setF({}); setPage(1); }} aria-current={r.key === active ? 'page' : undefined}
            className={cx('block w-full rounded-md px-3 py-2 text-left text-[14px]', r.key === active ? 'bg-brand-soft font-medium text-brand-dark' : 'hover:bg-paper')}>{r.title}</button>)}
        </nav>
        <div className="min-w-0 space-y-4">
          {meta && <p className="text-muted">{meta.description}</p>}
          {meta && meta.filters.length > 0 && (
            <Card><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {has('region_id') && lk.regions.length > 1 && <Field label="Region">{id => <Select id={id} value={f.region_id ?? ''} onChange={e => set('region_id', e.target.value)}><option value="">All</option>{lk.regions.map((r: any) => <option key={r.id} value={r.id}>{r.name}</option>)}</Select>}</Field>}
              {has('institution_id') && lk.institutions.length > 1 && <Field label="Institution">{id => <Select id={id} value={f.institution_id ?? ''} onChange={e => set('institution_id', e.target.value)}><option value="">All</option>{lk.institutions.map((r: any) => <option key={r.id} value={r.id}>{r.name}</option>)}</Select>}</Field>}
              {has('category') && <Field label="Category">{id => <Select id={id} value={f.category ?? ''} onChange={e => set('category', e.target.value)}><option value="">All</option>{lk.categories.map((c: any) => <option key={c.code} value={c.code}>{c.name}</option>)}</Select>}</Field>}
              {has('stage') && <Field label="Stage">{id => <Select id={id} value={f.stage ?? ''} onChange={e => set('stage', e.target.value)}><option value="">All</option>{lk.stages.map((s: any) => <option key={s.key} value={s.key}>{s.name}</option>)}</Select>}</Field>}
              {has('status') && <Field label="Status">{id => <Select id={id} value={f.status ?? ''} onChange={e => set('status', e.target.value)}><option value="">All</option>{['in_progress', 'returned', 'approved', 'rejected', 'withdrawn'].map(s => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}</Select>}</Field>}
              {has('doc_type') && <Field label="Document type">{id => <Select id={id} value={f.doc_type ?? ''} onChange={e => set('doc_type', e.target.value)}><option value="">All</option>{lk.docTypes.map((t: string) => <option key={t} value={t}>{lk.data?.doc_type_names?.[t] ?? t}</option>)}</Select>}</Field>}
              {has('window') && <Field label="Expiry window">{id => <Select id={id} value={f.window ?? '90'} onChange={e => set('window', e.target.value)}><option value="30">30 days</option><option value="60">60 days</option><option value="90">90 days</option><option value="180">180 days</option></Select>}</Field>}
              {has('from') && <Field label="From">{id => <Input id={id} type="date" value={f.from ?? ''} onChange={e => set('from', e.target.value)} />}</Field>}
              {has('to') && <Field label="To">{id => <Input id={id} type="date" value={f.to ?? ''} onChange={e => set('to', e.target.value)} />}</Field>}
            </div></Card>)}
          <Query q={q}>{(d: any) => (
            <>
              {d.chart && d.rows.length > 0 && <Card title="Chart"><SeriesChart type={d.chart.type} rows={d.chartRows} x={d.chart.x} series={d.chart.series} /></Card>}
              <Card pad={false}>{d.rows.length === 0 ? <Empty title="No rows match" hint="Widen the filters to see more." /> : (
                <><Table><thead><tr>{d.columns.map((c: any) => <Th key={c.key}>{c.label}</Th>)}</tr></thead><tbody>{d.rows.map((r: any, i: number) => <tr key={i}>{d.columns.map((c: any) => <Td key={c.key}>{String(r[c.key] ?? '')}</Td>)}</tr>)}</tbody></Table>
                  <Pager page={d.page} pages={d.pages} total={d.total} onPage={setPage} /></>)}</Card>
              <p className="text-[13px] text-muted">Generated {d.generated_at}. Synthetic demonstration data.</p></>)}</Query>
        </div>
      </div>
    </>);
}
