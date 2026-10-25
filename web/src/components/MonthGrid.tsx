import { useMemo } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Button, cx } from './ui';

export type CalEvent = { date: string; title: string; tone: 'brand' | 'good' | 'warn' | 'bad' | 'neutral'; link?: string; type?: string };
const TONE = { brand: 'bg-brand-soft text-brand-dark', good: 'bg-good-soft text-good', warn: 'bg-warn-soft text-warn', bad: 'bg-bad-soft text-bad', neutral: 'bg-[#eaeef3] text-[#3b4a5c]' };
export const monthRange = (ym: string) => {
  const [y, m] = ym.split('-').map(Number); const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${ym}-01`, to: `${ym}-${String(last).padStart(2, '0')}` };
};
export const shiftMonth = (ym: string, n: number) => { const [y, m] = ym.split('-').map(Number); const d = new Date(Date.UTC(y, m - 1 + n, 1)); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`; };

export function MonthGrid({ month, onMonth, events, today }: { month: string; onMonth: (m: string) => void; events: CalEvent[]; today: string }) {
  const { cells, label } = useMemo(() => {
    const [y, m] = month.split('-').map(Number);
    const first = new Date(Date.UTC(y, m - 1, 1)), days = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const lead = (first.getUTCDay() + 6) % 7;     // Monday first
    const cells: (string | null)[] = [...Array(lead).fill(null), ...Array.from({ length: days }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`)];
    while (cells.length % 7) cells.push(null);
    return { cells, label: first.toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' }) };
  }, [month]);
  const by = useMemo(() => { const g: Record<string, CalEvent[]> = {}; for (const e of events) (g[e.date] ??= []).push(e); return g; }, [events]);
  return (
    <div>
      <div className="mb-3 flex items-center gap-2">
        <Button size="sm" aria-label="Previous month" onClick={() => onMonth(shiftMonth(month, -1))}><ChevronLeft className="h-4 w-4" /></Button>
        <h3 className="min-w-[150px] text-center font-semibold" aria-live="polite">{label}</h3>
        <Button size="sm" aria-label="Next month" onClick={() => onMonth(shiftMonth(month, 1))}><ChevronRight className="h-4 w-4" /></Button>
        <Button size="sm" variant="ghost" onClick={() => onMonth(today.slice(0, 7))}>Today</Button>
      </div>
      <div className="overflow-x-auto"><div className="grid min-w-[700px] grid-cols-7 border-l border-t border-line bg-white text-[12px]" role="grid" aria-label={label}>
        {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(d => <div key={d} role="columnheader" className="border-b border-r border-line bg-[#f8fafc] px-2 py-1.5 font-semibold text-muted">{d}</div>)}
        {cells.map((c, i) => (
          <div key={i} role="gridcell" className={cx('min-h-[92px] border-b border-r border-line p-1', !c && 'bg-[#fafbfc]', c === today && 'bg-teal-soft/50')}>
            {c && <p className={cx('mb-0.5 px-1 text-right', c === today ? 'font-bold text-[#0b6769]' : 'text-muted')}>{Number(c.slice(8))}</p>}
            {c && (by[c] ?? []).slice(0, 3).map((e, j) => {
              const cls = cx('mb-0.5 block truncate rounded px-1.5 py-0.5', TONE[e.tone]);
              return e.link ? <Link key={j} to={e.link} title={e.title} className={cls}>{e.title}</Link> : <span key={j} title={e.title} className={cls}>{e.title}</span>; })}
            {c && (by[c]?.length ?? 0) > 3 && <p className="px-1 text-muted">+{by[c].length - 3} more</p>}
          </div>))}
      </div></div>
    </div>);
}
