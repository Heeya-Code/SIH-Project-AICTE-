import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Bot, ExternalLink, Send, X } from 'lucide-react';
import { api, errMsg } from '../lib/api';
import { Badge, Button, Input, cx } from './ui';
import { STATUS } from '../pages/Rules';

const DATA_Q = ['Which applications are overdue?', 'Which EVCs need scheduling?', 'Which leases are expiring soon?', 'Which stage has the largest backlog?', 'Which compliance deadlines are coming up?'];
const BOOK_Q = ['Is an EVC visit needed for an increase in intake?', 'How long must a land lease be?', 'Who prepares the building plan?', 'When can I apply for a change of site?', 'What happens if a document is fraudulent?'];

export function Assistant() {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<'data' | 'book'>('data');
  const [q, setQ] = useState(''); const [busy, setBusy] = useState(false); const [res, setRes] = useState<any>(null); const [err, setErr] = useState('');
  async function ask(text: string) {
    if (text.trim().length < 3) return;
    setBusy(true); setErr('');
    try { setRes(await api(mode === 'data' ? '/assistant/ask' : '/reference/ask', { body: { question: text } })); } catch (e) { setErr(errMsg(e)); } finally { setBusy(false); }
  }
  const switchMode = (m: 'data' | 'book') => { setMode(m); setRes(null); setErr(''); };
  return (
    <>
      <button aria-label="Open the assistant" onClick={() => setOpen(o => !o)} className="fixed bottom-4 left-4 z-40 flex items-center gap-2 rounded-full bg-ink px-4 py-2.5 text-white shadow-lg hover:bg-ink-2 lg:left-auto lg:right-4">
        {open ? <X className="h-4 w-4" /> : <Bot className="h-4 w-4" />}<span className="hidden sm:inline">Ask the assistant</span>
      </button>
      {open && (
        <div role="dialog" aria-label="Assistant" className="fixed bottom-16 left-4 right-4 z-40 flex max-h-[78vh] flex-col rounded-lg border border-line bg-white shadow-xl sm:left-auto sm:w-[420px] lg:right-4">
          <div className="border-b border-line px-4 pt-3">
            <div role="tablist" className="flex gap-1">
              {([['data', 'My case data'], ['book', 'AICTE handbook']] as const).map(([k, l]) => <button key={k} role="tab" aria-selected={mode === k} onClick={() => switchMode(k)} className={cx('border-b-2 px-3 py-2 text-[14px] font-medium', mode === k ? 'border-brand text-brand' : 'border-transparent text-muted')}>{l}</button>)}
            </div>
            <p className="py-2 text-[13px] text-muted">{mode === 'data' ? 'Rule-based, not an AI model. Reads only data you may see and never changes anything.' : 'Searches only the indexed, paraphrased excerpts, and shows where each came from. It says so when it cannot answer, and never decides an approval.'}</p>
          </div>
          <div className="flex-1 space-y-3 overflow-y-auto p-4">
            {!res && <div className="flex flex-wrap gap-1.5">{(mode === 'data' ? DATA_Q : BOOK_Q).map(s => <button key={s} onClick={() => { setQ(s); ask(s); }} className="rounded-full border border-line px-2.5 py-1 text-[13px] hover:bg-paper">{s}</button>)}</div>}
            {err && <p role="alert" className="text-bad">{err}</p>}
            {busy && <p className="text-muted">Looking that up…</p>}
            {res && !busy && mode === 'data' && (
              <div className="space-y-2">
                <p className="font-semibold">{res.title}</p>
                <ul className="list-disc space-y-1 pl-4">{res.facts.map((f: string, i: number) => <li key={i}>{f}</li>)}</ul>
                {res.suggestions.length > 0 && <div className="rounded-md bg-teal-soft p-2.5"><p className="text-[13px] font-medium text-[#0b6769]">Suggestion (not a recorded fact)</p>{res.suggestions.map((s: string, i: number) => <p key={i} className="text-[13px]">{s}</p>)}</div>}
                {res.references.length > 0 && <p className="flex flex-wrap gap-x-3 gap-y-1 text-[13px]">{res.references.slice(0, 12).map((r: any) => <Link key={`${r.type}${r.id}`} className="text-brand underline" to={r.link} onClick={() => setOpen(false)}>{r.label}</Link>)}</p>}
                <p className="text-xs text-muted">{res.notice}</p>
                <Button size="sm" onClick={() => { setRes(null); setQ(''); }}>Ask something else</Button>
              </div>)}
            {res && !busy && mode === 'book' && (
              <div className="space-y-3">
                <p className="font-semibold">{res.answered ? res.message : 'No answer from the indexed sources'}</p>
                {!res.answered && <p className="rounded-md bg-warn-soft p-2.5 text-warn">{res.message}</p>}
                {res.evidence.map((e: any) => (
                  <div key={e.rule_code} className="rounded-md border border-line p-3">
                    <p className="flex flex-wrap items-center gap-2"><Badge tone={STATUS[e.verification_status]?.tone} title={STATUS[e.verification_status]?.help}>{STATUS[e.verification_status]?.label}</Badge><span className="text-[13px] text-muted">{e.rule_code}</span></p>
                    <p className="mt-1 font-medium">{e.title}</p><p className="mt-1">{e.statement}</p>
                    <dl className="mt-2 space-y-0.5 text-[13px] text-muted">
                      {e.source && <div>Source: {e.source.title} ({e.source.trust}) {e.source.url && <a className="inline-flex items-center gap-0.5 text-brand underline" href={e.source.url} target="_blank" rel="noreferrer noopener">open<ExternalLink className="h-3 w-3" aria-hidden /></a>}</div>}
                      <div>Section: {e.section_ref ?? 'not confirmed'}</div><div>Page: {e.page_ref ?? 'not shown in the excerpt'}{e.page_note ? `. ${e.page_note}` : ''}</div>
                    </dl>
                  </div>))}
                {res.caveats?.map((c: string, i: number) => <p key={i} className="rounded-md bg-warn-soft p-2 text-[13px] text-warn">{c}</p>)}
                <p className="text-xs text-muted">{res.disclaimer}</p>
                <div className="flex gap-2"><Button size="sm" onClick={() => { setRes(null); setQ(''); }}>Ask something else</Button><Link to="/rules" onClick={() => setOpen(false)} className="self-center text-[13px] text-brand underline">All sources and rules</Link></div>
              </div>)}
          </div>
          <form className="flex gap-2 border-t border-line p-3" onSubmit={e => { e.preventDefault(); ask(q); }}>
            <Input aria-label="Your question" value={q} onChange={e => setQ(e.target.value)} placeholder={mode === 'data' ? 'Ask about overdue cases, EVCs, leases…' : 'Ask about the handbook…'} maxLength={300} />
            <Button type="submit" variant="primary" busy={busy} aria-label="Send question"><Send className="h-4 w-4" /></Button>
          </form>
        </div>)}
    </>);
}
