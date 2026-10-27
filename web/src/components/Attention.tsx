import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, ChevronDown, ChevronUp } from 'lucide-react';
import { Badge, Button, Card, Empty, StatusBadge, cx } from './ui';
import { fmtDate } from '../lib/format';

const RANK_TONE: Record<number, any> = { 1: 'bad', 2: 'warn', 3: 'warn', 4: 'brand', 5: 'neutral' };

export function AttentionPanel({ a, role }: { a: any; role: string }) {
  const [all, setAll] = useState(false); const [howOpen, setHowOpen] = useState(false);
  const items = all ? a.items : a.items.slice(0, 5);
  return (
    <Card title="Needs your attention" actions={<button className="-my-1 min-h-[28px] text-[13px] text-brand underline" aria-expanded={howOpen} onClick={() => setHowOpen(o => !o)}>How is this ordered?</button>}>
      {howOpen && (
        <div className="mb-3 rounded-md bg-paper p-3 text-[13px]"><p className="mb-1 font-medium">Items are ranked in this order. {a.ordering}</p>
          <ol className="list-decimal pl-5">{a.criteria.map((c: any) => <li key={c.rank}><b>{c.label}.</b> {c.help}</li>)}</ol></div>)}
      {a.items.length === 0 ? (
        <Empty title="Nothing needs your attention right now" hint={role === 'institution' ? 'When something needs you, such as a response or a renewal, it will appear here with the reason.' : 'Overdue, blocked and approaching items will appear here, ranked, with the reason for each.'}
          action={role === 'institution' ? <Link to="/applications/new"><Button variant="primary">Start an application</Button></Link> : undefined} />
      ) : (
        <ol className="divide-y divide-line/70">{items.map((i: any, idx: number) => (
          <li key={i.key} className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2 py-3 first:pt-0">
            <div className="min-w-0 basis-full sm:flex-1 sm:basis-0">
              <p className="flex flex-wrap items-center gap-2"><StatusBadge tone={RANK_TONE[i.rank]}>{i.rank_label}</StatusBadge>{idx === 0 && role === 'institution' && <Badge tone="brand">Your next step</Badge>}{i.due && <span className="text-[13px] text-muted">Deadline {fmtDate(i.due)}</span>}</p>
              <p className="mt-1 font-medium"><Link to={i.link} className="text-ink hover:text-brand hover:underline">{i.title}</Link></p>
              <ul className="mt-1 list-disc pl-5 text-[13px] text-muted" aria-label="Why this is here">{i.why.map((w: string, k: number) => <li key={k}>{w}</li>)}</ul>
            </div>
            <Link to={i.link} className="max-w-full shrink-0"><Button size="sm" variant={i.rank <= 2 ? 'primary' : 'secondary'}>{i.action}<ArrowRight className="h-3.5 w-3.5" aria-hidden /></Button></Link>
          </li>))}</ol>)}
      {a.total > 5 && <div className="mt-3"><Button size="sm" variant="ghost" onClick={() => setAll(x => !x)}>{all ? <><ChevronUp className="h-4 w-4" aria-hidden />Show fewer</> : <><ChevronDown className="h-4 w-4" aria-hidden />Show all {Math.min(a.total, 12)} of {a.total}</>}</Button></div>}
    </Card>);
}

const GROUPS = [['overdue', 'Overdue', 'bad'], ['due_soon', 'Due within 7 days', 'warn'], ['later', 'Later', 'neutral']] as const;
export function GroupedDeadlines({ l }: { l: any }) {
  return (
    <Card title={l.title} pad={false}>
      {l.rows.length === 0 ? <Empty title={l.empty} /> : (
        <div className="no-scrollbar">{GROUPS.map(([g, label, tone]) => { const rows = l.rows.filter((r: any) => r.group === g); if (!rows.length) return null; return (
          <section key={g} aria-label={label}><h3 className="flex items-center gap-2 border-b border-line bg-[#f8fafc] px-4 py-1.5 text-[13px] font-semibold"><StatusBadge tone={tone as any}>{label}</StatusBadge><span className="text-muted">{rows.length}</span></h3>
            <ul>{rows.map((r: any, i: number) => (
              <li key={i} className="border-b border-line/70 px-4 py-2.5"><div className="flex flex-wrap items-baseline justify-between gap-x-3"><Link to={r.link} className="font-medium text-brand hover:underline">{r.what}</Link><span className={cx('text-[13px]', g === 'overdue' ? 'font-medium text-bad' : 'text-muted')}>{fmtDate(r.date)}, {r.urgency}</span></div>
                <p className="text-[13px] text-muted">{r.role}: {r.action}</p></li>))}</ul></section>); })}</div>)}
    </Card>);
}

