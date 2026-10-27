import { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Bot, ExternalLink, Loader2, RotateCw, Send, X } from 'lucide-react';
import { api, errMsg } from '../lib/api';
import { Badge, Button, Input, cx } from './ui';
import { STATUS } from '../pages/Rules';

const DATA_Q = ['Which applications are overdue?', 'Which EVCs need scheduling?', 'Which leases are expiring soon?', 'Which stage has the largest backlog?', 'Which compliance deadlines are coming up?'];
const BOOK_Q = ['Is an EVC visit needed for an increase in intake?', 'How long must a land lease be?', 'Who prepares the building plan?', 'When can I apply for a change of site?', 'What happens if a document is fraudulent?'];

function AnswerText({ text }: { text: string }) {
  const blocks = text.split(/\n\s*\n/).map(x => x.trim()).filter(Boolean);
  return <div className="space-y-2 rounded-md bg-brand-soft/60 p-3 leading-relaxed">
    {blocks.map((block, i) => {
      const lines = block.split('\n').map(x => x.trim()).filter(Boolean);
      if (lines.every(line => /^[-*]\s/.test(line))) return <ul key={i} className="list-disc space-y-1 pl-5">{lines.map((line, j) => <li key={j}>{line.replace(/^[-*]\s/, '')}</li>)}</ul>;
      if (lines.every(line => /^\d+[.)]\s/.test(line))) return <ol key={i} className="list-decimal space-y-1 pl-5">{lines.map((line, j) => <li key={j}>{line.replace(/^\d+[.)]\s/, '')}</li>)}</ol>;
      if (lines.length === 1 && /^#{1,3}\s/.test(lines[0])) return <h3 key={i} className="font-semibold text-ink">{lines[0].replace(/^#{1,3}\s/, '')}</h3>;
      return <p key={i} className="whitespace-pre-wrap">{block}</p>;
    })}
  </div>;
}

export function Assistant() {
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<'data' | 'book'>('data');
  const [q, setQ] = useState(''); const [busy, setBusy] = useState(false); const [res, setRes] = useState<any>(null); const [err, setErr] = useState('');
  const [history, setHistory] = useState<{ question: string; answer: string }[]>([]);
  const modelStatus = useQuery({ queryKey: ['assistant-status'], queryFn: () => api<any>('/assistant/status'), enabled: open, staleTime: 60_000 });
  const model = res?.model ?? modelStatus.data?.model;
  const suggestions = mode === 'data'
    ? pathname.startsWith('/applications/') ? ['What stage is this application at?', 'What is waiting on this case?', 'What can I do next?'] : DATA_Q
    : pathname === '/documents' ? ['Show me an example of a lease document', 'What should a faculty list contain?', 'Are sample certificates official?'] : BOOK_Q;
  async function ask(text: string) {
    if (text.trim().length < 3) return;
    setBusy(true); setErr('');
    try {
      const answer = await api<any>(mode === 'data' ? '/assistant/ask' : '/reference/ask', { body: { question: text, history: history.slice(-6) } });
      setRes(answer);
      const summary = answer.answer || (mode === 'data' ? [...(answer.facts ?? []), ...(answer.suggestions ?? [])].join('\n') : answer.message);
      setHistory(current => [...current, { question: text, answer: String(summary ?? '').slice(0, 1200) }].slice(-6));
    } catch (e) { setErr(errMsg(e)); } finally { setBusy(false); }
  }
  const switchMode = (m: 'data' | 'book') => { setMode(m); setRes(null); setErr(''); setHistory([]); };
  return (
    <>
      <button aria-label="Ask the assistant" title="Ask the assistant" onClick={() => setOpen(o => !o)} className="fixed bottom-4 left-4 z-40 flex items-center gap-2 rounded-full bg-ink px-4 py-2.5 text-white shadow-lg hover:bg-ink-2 lg:left-auto lg:right-4">
        {open ? <X className="h-4 w-4" /> : <Bot className="h-4 w-4" />}<span className="hidden 2xl:inline">Ask the assistant</span>
      </button>
      {open && (
        <div role="dialog" aria-label="Assistant" className="fixed bottom-16 left-4 right-4 z-40 flex max-h-[78vh] flex-col rounded-lg border border-line bg-white shadow-xl sm:left-auto sm:w-[420px] lg:right-4">
          <div className="border-b border-line px-4 pt-3">
            <div role="tablist" className="flex gap-1">
              {([['data', 'My case data'], ['book', 'AICTE handbook']] as const).map(([k, l]) => <button key={k} role="tab" aria-selected={mode === k} onClick={() => switchMode(k)} className={cx('border-b-2 px-3 py-2 text-[14px] font-medium', mode === k ? 'border-brand text-brand' : 'border-transparent text-muted')}>{l}</button>)}
            </div>
            <p className="py-2 text-[13px] text-muted">{modelStatus.isLoading && !model ? 'Checking assistant configuration…' : modelStatus.error && !model ? 'Model configuration could not be checked. Each reply will report its source and any provider failure.' : mode === 'data'
              ? model?.configured ? `Connected to ${model.model}. Live facts are permission-scoped; the assistant never changes records.`
                : 'No language model is configured. Live answers use permission-scoped system data; nothing is changed.'
              : model?.configured ? `Retrieves indexed excerpts, then uses ${model.model} to explain them. Sources and verification caveats are shown.`
                : 'No language model is configured. This mode retrieves indexed, paraphrased excerpts and shows their sources; it never invents an answer.'}</p>
          </div>
          <div className="flex-1 space-y-3 overflow-y-auto p-4">
            {!res && <div className="flex flex-wrap gap-1.5">{suggestions.map(s => <button key={s} onClick={() => { setQ(s); ask(s); }} className="rounded-full border border-line px-2.5 py-1 text-[13px] hover:bg-paper">{s}</button>)}</div>}
            {history.length > 0 && !busy && <p className="text-[12px] text-muted">Recent questions are kept for follow-ups in this chat.</p>}
            {err && <div role="alert" className="flex items-center justify-between gap-2 rounded-md bg-bad-soft p-2 text-[13px] text-bad"><span>{err}</span><Button size="sm" onClick={() => ask(q)}><RotateCw className="h-3.5 w-3.5" aria-hidden />Retry</Button></div>}
            {busy && <p role="status" className="flex items-center gap-2 text-muted"><Loader2 className="h-4 w-4 animate-spin" aria-hidden />Thinking and checking sources…</p>}
            {res && !busy && mode === 'data' && (
              <div className="space-y-2">
                <p className="font-semibold">{res.title}</p>
                {res.answer && <AnswerText text={res.answer} />}
                <ul className="list-disc space-y-1 pl-4">{res.facts.map((f: string, i: number) => <li key={i}>{f}</li>)}</ul>
                {res.sample_documents?.map((sample: any) => <Link key={sample.doc_type} to={sample.link} onClick={() => setOpen(false)} className="inline-flex items-center gap-1 rounded-full border border-brand/30 px-3 py-1.5 text-[13px] font-medium text-brand hover:bg-brand-soft">Preview {sample.display_name}<ExternalLink className="h-3.5 w-3.5" aria-hidden /></Link>)}
                {res.evidence?.map((e: any, i: number) => <p key={i} className="rounded-md border border-line p-2 text-[13px]"><strong>Source:</strong> {e.source ?? 'Indexed excerpt'} · {e.title}{e.section ? ` · Section ${e.section}` : ''}{e.page ? ` · Page ${e.page}` : ''} <span className="text-muted">({e.status})</span></p>)}
                {res.suggestions.length > 0 && <div className="rounded-md bg-teal-soft p-2.5"><p className="text-[13px] font-medium text-[#0b6769]">Suggestion (not a recorded fact)</p>{res.suggestions.map((s: string, i: number) => <p key={i} className="text-[13px]">{s}</p>)}</div>}
                {res.references.length > 0 && <p className="flex flex-wrap gap-x-3 gap-y-1 text-[13px]">{res.references.slice(0, 12).map((r: any) => <Link key={`${r.type}${r.id}`} className="text-brand underline" to={r.link} onClick={() => setOpen(false)}>{r.label}</Link>)}</p>}
                {res.model?.configured && <p className="text-xs text-muted">Generated with {res.model.model}; live facts above come from records you may access.</p>}
                <p className="text-xs text-muted">{res.notice}</p>
                <Button size="sm" onClick={() => { setRes(null); setQ(''); }}>Ask something else</Button>
              </div>)}
            {res && !busy && mode === 'book' && (
              <div className="space-y-3">
                {res.answer ? <AnswerText text={res.answer} /> : <p className="font-semibold">{res.answered ? res.message : 'No answer from the indexed sources'}</p>}
                {!res.answered && <p className="rounded-md bg-warn-soft p-2.5 text-warn">{res.message}</p>}
                {res.sample_documents?.map((sample: any) => <Link key={sample.doc_type} to={sample.link} onClick={() => setOpen(false)} className="inline-flex items-center gap-1 rounded-full border border-brand/30 px-3 py-1.5 text-[13px] font-medium text-brand hover:bg-brand-soft">Preview {sample.display_name}<ExternalLink className="h-3.5 w-3.5" aria-hidden /></Link>)}
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
                {res.model?.configured && <p className="text-xs text-muted">Generated with {res.model.model}; source excerpts and their verification status are shown below.</p>}
                <p className="text-xs text-muted">{res.disclaimer}</p>
                <div className="flex gap-2"><Button size="sm" onClick={() => { setRes(null); setQ(''); }}>Ask something else</Button><Link to="/rules" onClick={() => setOpen(false)} className="self-center text-[13px] text-brand underline">All sources and rules</Link></div>
              </div>)}
          </div>
          <form className="flex gap-2 border-t border-line p-3" onSubmit={e => { e.preventDefault(); ask(q); }}>
            <Input aria-label="Your question" value={q} onChange={e => setQ(e.target.value)} placeholder={mode === 'data' ? 'Ask about cases, deadlines, or this page…' : 'Ask about a rule, document, or general topic…'} maxLength={300} />
            <Button type="submit" variant="primary" busy={busy} aria-label="Send question"><Send className="h-4 w-4" /></Button>
          </form>
        </div>)}
    </>);
}
