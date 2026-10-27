import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api, qstr } from '../lib/api';
import { fmtDate, pretty } from '../lib/format';
import { Badge, Card, Empty, PageHeader, Query } from '../components/ui';
import { MonthGrid, monthRange, type CalEvent } from '../components/MonthGrid';
import { useLookups } from '../lib/hooks';

const TYPES = [['undertaking', 'Obligations'], ['document', 'Document expiry'], ['evc', 'EVC'], ['clarification', 'Clarification deadlines']];
const tone = (s: string): CalEvent['tone'] => (['overdue', 'expired'].includes(s) ? 'bad' : ['due_soon', 'queued', 'returned_for_correction'].includes(s) ? 'warn' : ['verified', 'closed', 'completed'].includes(s) ? 'good' : 'brand');

export default function CalendarPage() {
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const [types, setTypes] = useState<string[]>(TYPES.map(t => t[0]));
  const lk = useLookups();
  const q = useQuery({ queryKey: ['calendar', month, types], queryFn: () => api<any[]>(`/calendar${qstr({ ...monthRange(month), types: types.join(',') })}`) });
  const toggle = (t: string) => setTypes(x => (x.includes(t) ? x.filter(y => y !== t) : [...x, t]));
  return (
    <>
      <PageHeader title="Compliance calendar" subtitle="Obligation deadlines, document expiries, EVC dates and clarification deadlines in one place." />
      <fieldset className="mb-4 flex flex-wrap gap-4"><legend className="sr-only">Show</legend>
        {TYPES.map(([k, l]) => <label key={k} className="flex items-center gap-2"><input type="checkbox" checked={types.includes(k)} onChange={() => toggle(k)} />{l}</label>)}</fieldset>
      <Query q={q}>{(rows: any[]) => (
        <div className="grid gap-4 xl:grid-cols-[2fr_1fr]">
          <Card className="min-w-0"><MonthGrid month={month} onMonth={setMonth} today={lk.data?.clock.today ?? new Date().toISOString().slice(0, 10)} events={rows.map(e => ({ date: e.date, title: e.title, tone: tone(e.status), link: e.link }))} /></Card>
          <Card title="This month" pad={false}>{rows.length === 0 ? <Empty title="Nothing due this month" /> : (
            <ul className="max-h-[640px] overflow-y-auto">{rows.map((e, i) => <li key={i} className="border-b border-line/70 px-4 py-2.5"><p className="flex items-center justify-between gap-2"><Link className="font-medium text-brand hover:underline" to={e.link}>{e.title}</Link><Badge tone={tone(e.status)}>{pretty(e.status)}</Badge></p><p className="text-[13px] text-muted">{fmtDate(e.date)}, {e.institution}</p></li>)}</ul>)}</Card>
        </div>)}</Query>
    </>);
}
