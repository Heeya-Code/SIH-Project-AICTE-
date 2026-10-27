import { useEffect, useId, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { FileText, Search, ShieldCheck, Zap, History } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { getRecent } from '../lib/recent';
import { cx } from './ui';

type Opt = { id: string; group: string; primary: string; secondary?: string; link: string; icon: any };
const QUICK: Record<string, { label: string; link: string }[]> = {
  institution: [{ label: 'Start a new application', link: '/applications/new' }, { label: 'My compliance obligations', link: '/compliance' }, { label: 'Document expiry', link: '/documents?expiry=60' }],
  regional_officer: [{ label: 'Document verification queue', link: '/verification' }, { label: 'Overdue cases', link: '/applications?deadline=overdue&open=1' }, { label: 'Unassigned cases', link: '/applications?unassigned=1' }],
  bureau_officer: [{ label: 'Overdue cases', link: '/applications?deadline=overdue&open=1' }, { label: 'Analytics', link: '/analytics' }, { label: 'Alerts', link: '/alerts' }],
  evc_coordinator: [{ label: 'EVC visits to schedule', link: '/evc?status=queued' }, { label: 'EVC calendar', link: '/evc?view=calendar' }, { label: 'Delayed visits', link: '/evc?status=overdue' }],
  competent_authority: [{ label: 'Cases awaiting a decision', link: '/applications?stage=decision&open=1' }, { label: 'Escalations to me', link: '/escalations' }],
  admin: [{ label: 'Users and roles', link: '/admin' }, { label: 'Public data and imports', link: '/public-data' }, { label: 'Audit trail', link: '/audit' }],
};

export function GlobalSearch() {
  const { user } = useAuth(); const nav = useNavigate(); const listId = useId();
  const [q, setQ] = useState(''); const [open, setOpen] = useState(false); const [opts, setOpts] = useState<Opt[]>([]); const [active, setActive] = useState(0); const [state, setState] = useState<'idle' | 'loading' | 'error'>('idle');
  const input = useRef<HTMLInputElement>(null); const box = useRef<HTMLDivElement>(null);
  useEffect(() => { // Ctrl/Cmd+K or "/" focuses the search
    const h = (e: KeyboardEvent) => { const typing = ['INPUT', 'TEXTAREA', 'SELECT'].includes((e.target as HTMLElement).tagName); if (((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') || (e.key === '/' && !typing)) { e.preventDefault(); input.current?.focus(); setOpen(true); } };
    window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h);
  }, []);
  useEffect(() => { const h = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); }; document.addEventListener('mousedown', h); return () => document.removeEventListener('mousedown', h); }, []);
  useEffect(() => {
    if (q.trim().length < 2) {
      const recent = getRecent(user!.id).map<Opt>(r => ({ id: `r${r.id}`, group: 'Recently viewed', primary: r.ref, secondary: r.title, link: `/applications/${r.id}`, icon: History }));
      const quick = (QUICK[user!.role] ?? []).map<Opt>((x, i) => ({ id: `q${i}`, group: 'Quick actions', primary: x.label, link: x.link, icon: Zap }));
      setOpts([...recent, ...quick]); setState('idle'); setActive(0); return;
    }
    setState('loading'); const ctl = new AbortController();
    const t = setTimeout(async () => {
      try {
        const r = await api<any>(`/search?q=${encodeURIComponent(q.trim())}`);
        if (ctl.signal.aborted) return;
        setOpts([...r.applications.map((a: any) => ({ id: `a${a.id}`, group: 'Applications', primary: a.ref, secondary: `${a.title}. ${a.institution}`, link: a.link, icon: FileText })),
          ...r.documents.map((d: any) => ({ id: `d${d.id}`, group: 'Documents', primary: `${d.name} (${d.code})`, secondary: [d.institution, d.application_ref].filter(Boolean).join(', '), link: d.link, icon: FileText })),
          ...r.obligations.map((o: any) => ({ id: `o${o.id}`, group: 'Obligations', primary: o.code, secondary: `${o.title}. ${o.institution}`, link: o.link, icon: ShieldCheck }))]);
        setState('idle'); setActive(0);
      } catch { if (!ctl.signal.aborted) setState('error'); }
    }, 200);
    return () => { ctl.abort(); clearTimeout(t); };
  }, [q, user]);
  const go = (o: Opt) => { setOpen(false); setQ(''); input.current?.blur(); nav(o.link); };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setActive(a => Math.min(a + 1, opts.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(a => Math.max(a - 1, 0)); }
    else if (e.key === 'Enter' && open && opts[active]) { e.preventDefault(); go(opts[active]); }
    else if (e.key === 'Escape') { setOpen(false); }
  };
  const groups = opts.reduce<Record<string, Opt[]>>((g, o) => ((g[o.group] ??= []).push(o), g), {});
  let n = -1;
  return (
    <div ref={box} className="relative w-full max-w-md" role="search">
      <label htmlFor={`${listId}-in`} className="sr-only">Search applications, documents and obligations</label>
      <div className="relative"><Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted" aria-hidden />
        <input ref={input} id={`${listId}-in`} role="combobox" aria-expanded={open} aria-controls={listId} aria-autocomplete="list" aria-activedescendant={open && opts[active] ? `${listId}-${active}` : undefined} autoComplete="off"
          value={q} onChange={e => { setQ(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)} onKeyDown={onKey} placeholder="Search cases, documents" className="w-full rounded-md border border-line bg-paper py-2 pl-8 pr-14 placeholder:text-muted focus:border-teal focus:bg-white" />
        <kbd className="pointer-events-none absolute right-2 top-2 hidden rounded border border-line bg-white px-1.5 text-[11px] text-muted sm:block" aria-hidden>Ctrl K</kbd></div>
      {open && (
        <div id={listId} role="listbox" aria-label="Search results" className="absolute left-0 right-0 top-full z-40 mt-1 max-h-[70vh] overflow-y-auto rounded-lg border border-line bg-white p-1 shadow-xl">
          {state === 'loading' && <p role="status" className="px-3 py-2 text-muted">Searching…</p>}
          {state === 'error' && <p role="alert" className="px-3 py-2 text-bad">Search is unavailable right now. Try again in a moment.</p>}
          {state === 'idle' && q.trim().length >= 2 && opts.length === 0 && <p role="status" className="px-3 py-3 text-muted">Nothing found for “{q.trim()}”. Try a case reference such as AF-2026-00012, an institution name or a document name.</p>}
          {Object.entries(groups).map(([g, list]) => (
            <div key={g} role="group" aria-label={g}><p className="px-3 pb-0.5 pt-2 text-[12px] font-semibold text-muted" aria-hidden>{g}</p>
              {list.map(o => { n++; const i = n; const I = o.icon; return (
                <div key={o.id} id={`${listId}-${i}`} role="option" aria-selected={i === active} onMouseEnter={() => setActive(i)} onMouseDown={e => { e.preventDefault(); go(o); }}
                  className={cx('flex cursor-pointer items-start gap-2 rounded px-3 py-2', i === active ? 'bg-brand-soft' : '')}><I className="mt-0.5 h-4 w-4 shrink-0 text-muted" aria-hidden /><span className="min-w-0"><span className="block truncate font-medium">{o.primary}</span>{o.secondary && <span className="block truncate text-[13px] text-muted">{o.secondary}</span>}</span></div>); })}
            </div>))}
        </div>)}
    </div>);
}
