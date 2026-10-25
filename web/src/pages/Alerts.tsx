import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api, qstr } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useLookupMaps } from '../lib/hooks';
import { Badge, Button, Card, Empty, Field, Input, PageHeader, Pager, Query, Select, cx } from '../components/ui';

const SEV: Record<string, any> = { high: 'bad', medium: 'warn', low: 'neutral' };

export default function Alerts({ embedded }: { embedded?: boolean }) {
  const { user } = useAuth(); const lk = useLookupMaps();
  const [f, setF] = useState<Record<string, string>>({}); const [page, setPage] = useState(1); const [open, setOpen] = useState<number | null>(null);
  const rules = useQuery({ queryKey: ['alert-rules'], queryFn: () => api<any[]>('/intelligence/rules') });
  const q = useQuery({ queryKey: ['alerts', f, page], queryFn: () => api<any>(`/intelligence/alerts${qstr({ ...f, page, pageSize: 12 })}`), placeholderData: p => p });
  const set = (k: string, v: string) => { setF(x => ({ ...x, [k]: v })); setPage(1); };
  const ruleTitle = (id: string) => rules.data?.find(r => r.id === id)?.title ?? id;
  return (
    <>
      {!embedded && <PageHeader title="Alerts" subtitle="Prompts produced by fixed, published rules over your cases. Each alert shows the rule and the facts behind it. An alert never changes a case; a person decides what to do." />}
      <Query q={q}>{(d: any) => (
        <div className="space-y-4">
          <div className="flex flex-wrap gap-2">
            <button onClick={() => set('rule', '')} className={cx('rounded-full border px-3 py-1', !f.rule ? 'border-brand bg-brand-soft text-brand-dark' : 'border-line bg-white hover:bg-paper')}>All ({Object.values(d.summary).reduce((a: number, b: any) => a + b, 0) as number})</button>
            {Object.entries(d.summary).map(([k, v]) => <button key={k} onClick={() => set('rule', f.rule === k ? '' : k)} className={cx('rounded-full border px-3 py-1', f.rule === k ? 'border-brand bg-brand-soft text-brand-dark' : 'border-line bg-white hover:bg-paper')}>{ruleTitle(k)} ({v as number})</button>)}
          </div>
          <Card pad={false}>
            <div className="grid gap-3 border-b border-line p-4 sm:grid-cols-3">
              <Field label="Search">{id => <Input id={id} placeholder="Application, institution or text" onChange={e => set('q', e.target.value)} />}</Field>
              <Field label="Severity">{id => <Select id={id} value={f.severity ?? ''} onChange={e => set('severity', e.target.value)}><option value="">Any</option><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option></Select>}</Field>
              {user!.role !== 'institution' && lk.regions.length > 1 && <Field label="Region">{id => <Select id={id} value={f.region_id ?? ''} onChange={e => set('region_id', e.target.value)}><option value="">All</option>{lk.regions.map((r: any) => <option key={r.id} value={r.id}>{r.name}</option>)}</Select>}</Field>}
            </div>
            {d.rows.length === 0 ? <Empty title="No alerts match" hint="Nothing currently triggers these rules for your scope." /> : (
              <>
                <ul>{d.rows.map((a: any, i: number) => (
                  <li key={i} className="border-b border-line/70 px-4 py-3">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0 flex-1"><p className="flex flex-wrap items-center gap-2"><Badge tone={SEV[a.severity]}>{a.severity}</Badge><Badge>{ruleTitle(a.rule)}</Badge></p>
                        <p className="mt-1 font-medium"><Link className="text-brand hover:underline" to={a.link}>{a.title}</Link></p></div>
                      <Button size="sm" variant="ghost" aria-expanded={open === i} onClick={() => setOpen(open === i ? null : i)}>{open === i ? 'Hide facts' : 'Why this alert'}</Button>
                    </div>
                    {open === i && <div className="mt-2 rounded-md bg-paper p-3 text-[13px]"><p className="font-medium">Rule: {a.rule}</p><ul className="mt-1 list-disc pl-5">{a.evidence.map((e: string, j: number) => <li key={j}>{e}</li>)}</ul></div>}
                  </li>))}</ul>
                <Pager page={d.page} pages={d.pages} total={d.total} onPage={setPage} /></>)}
          </Card>
          <Card title="The rules behind these alerts" pad={false}>
            <Query q={rules}>{(rs: any[]) => <ul>{rs.map(r => <li key={r.id} className="border-b border-line/70 px-4 py-3 last:border-0"><p className="font-medium">{r.title} <span className="font-normal text-muted">({r.id})</span></p><p className="text-[13px]">{r.logic}</p><p className="text-[13px] text-muted">Threshold: {r.threshold}. Basis: {r.basis}.</p></li>)}</ul>}</Query>
          </Card>
        </div>)}</Query>
    </>);
}
