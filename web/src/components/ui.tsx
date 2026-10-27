import { createContext, forwardRef, useCallback, useContext, useEffect, useId, useRef, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { AlertCircle, AlertTriangle, Check, CheckCircle2, ChevronLeft, ChevronRight, CircleDashed, Clock, Inbox, Info, Loader2, X, XCircle } from 'lucide-react';
import { errDetails, errMsg } from '../lib/api';
import type { Tone } from '../lib/format';

export const cx = (...a: (string | false | null | undefined)[]) => a.filter(Boolean).join(' ');

// ------------------------------------------------------------------ buttons
const BTN: Record<string, string> = {
  primary: 'bg-brand text-white hover:bg-brand-dark disabled:bg-brand/40 shadow-xs',
  secondary: 'bg-white text-ink border border-line hover:bg-paper disabled:text-muted/60 shadow-xs',
  ghost: 'text-brand hover:bg-brand-soft disabled:text-muted/60',
  danger: 'bg-bad text-white hover:bg-[#8f1c13] disabled:bg-bad/40 shadow-xs',
  teal: 'bg-teal text-white hover:bg-[#0b7173] disabled:bg-teal/40 shadow-xs',
};
type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: keyof typeof BTN; size?: 'sm' | 'md'; busy?: boolean };
export const Button = forwardRef<HTMLButtonElement, BtnProps>(({ variant = 'secondary', size = 'md', busy, className, children, disabled, type = 'button', ...p }, ref) => (
  <button ref={ref} type={type} disabled={disabled || busy} {...p}
    className={cx('btn-vibe inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition-colors duration-100 disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-teal focus-visible:outline-offset-2',
      size === 'sm' ? 'min-h-[32px] px-2.5 py-1 text-[13px]' : 'min-h-[40px] px-3.5 py-2 text-sm',
      BTN[variant], className)}>
    {busy && <Loader2 className="h-4 w-4 animate-spin shrink-0" aria-hidden />}{children}
  </button>
));

// ------------------------------------------------------------------ badges
const TONES: Record<Tone, string> = {
  neutral: 'bg-[#eaeef3] text-[#3b4a5c]', brand: 'bg-brand-soft text-brand-dark', good: 'bg-good-soft text-good',
  warn: 'bg-warn-soft text-warn', bad: 'bg-bad-soft text-bad', teal: 'bg-teal-soft text-[#0b6769]',
};
export const Badge = ({ tone = 'neutral', children, title }: { tone?: Tone; children: ReactNode; title?: string }) => {
  const Icon = tone === 'good' ? CheckCircle2 : tone === 'warn' ? AlertTriangle : tone === 'bad' ? AlertCircle : null;
  return (
    <span title={title} className={cx('inline-flex items-center gap-1 whitespace-nowrap rounded px-2 py-0.5 text-xs font-medium', TONES[tone])}>
      {Icon && <Icon className="h-3 w-3 shrink-0" aria-hidden />}
      {children}
    </span>
  );
};

// ------------------------------------------------------------------ layout bits
export const Card = ({ title, actions, children, className, pad = true }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; pad?: boolean }) => (
  <section className={cx('polished-card min-w-0 border border-line bg-white', className)}>
    {(title || actions) && (
      <header className="flex items-center justify-between gap-3 border-b border-line px-4 py-3 sm:px-5">
        <h2 className="text-[15px] font-semibold text-ink truncate">{title}</h2>
        <div className="flex shrink-0 items-center gap-2">{actions}</div>
      </header>)}
    <div className={pad ? 'p-4 sm:p-5' : ''}>{children}</div>
  </section>
);

export const PageHeader = ({ title, subtitle, actions }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode }) => (
  <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
    <div className="min-w-0 flex-1">
      <h1 className="text-xl sm:text-[22px] font-semibold text-ink leading-tight">{title}</h1>
      {subtitle && <p className="mt-1 max-w-3xl text-sm text-muted">{subtitle}</p>}
    </div>
    {actions && <div className="flex flex-wrap items-center gap-2 shrink-0">{actions}</div>}
  </div>
);

export const Spinner = ({ label = 'Loading' }: { label?: string }) => (
  <div role="status" className="flex items-center justify-center gap-2 p-8 text-sm text-muted">
    <Loader2 className="h-4 w-4 animate-spin text-brand shrink-0" aria-hidden />{label}…
  </div>
);

export const Empty = ({ title, hint, action }: { title: string; hint?: string; action?: ReactNode }) => (
  <div className="flex flex-col items-center justify-center gap-1.5 px-6 py-10 text-center">
    <div className="flex h-11 w-11 items-center justify-center rounded-full bg-paper text-muted/70 mb-1">
      <Inbox className="h-5 w-5" aria-hidden />
    </div>
    <p className="text-sm font-semibold text-ink">{title}</p>
    {hint && <p className="max-w-md text-xs sm:text-sm text-muted">{hint}</p>}
    {action && <div className="mt-2.5">{action}</div>}
  </div>
);

export function ErrorBox({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const d = errDetails(error);
  return (
    <div role="alert" className="flex items-start gap-2 rounded-md border border-bad/30 bg-bad-soft p-3 text-bad">
      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <div className="min-w-0 flex-1"><p className="font-medium">{errMsg(error)}</p>
        {d.length > 0 && <ul className="mt-1 list-disc pl-4 text-[13px]">{d.map((x, i) => <li key={i}>{x}</li>)}</ul>}</div>
      {onRetry && <Button size="sm" onClick={onRetry}>Try again</Button>}
    </div>);
}

export function Query({ q, children, empty }: { q: { isLoading: boolean; error: unknown; data: any; refetch: () => void }; children: (d: any) => ReactNode; empty?: ReactNode }) {
  if (q.isLoading) return <Spinner />;
  if (q.error) return <div className="p-4"><ErrorBox error={q.error} onRetry={() => q.refetch()} /></div>;
  if (q.data == null) return <>{empty}</>;
  return <>{children(q.data)}</>;
}

// ------------------------------------------------------------------ forms
export const inputCls = 'w-full rounded-md border border-line bg-white px-3.5 py-2 text-sm text-ink placeholder:text-muted/60 focus:border-teal focus-visible:outline-2 focus-visible:outline-teal focus-visible:outline-offset-2 disabled:bg-paper disabled:cursor-not-allowed aria-[invalid=true]:border-bad transition-colors duration-100 min-h-[40px]';
export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(({ className, ...p }, ref) => <input ref={ref} {...p} className={cx(inputCls, className)} />);
export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(({ className, children, ...p }, ref) => <select ref={ref} {...p} className={cx(inputCls, 'pr-8', className)}>{children}</select>);
export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(({ className, ...p }, ref) => <textarea ref={ref} rows={3} {...p} className={cx(inputCls, 'min-h-[80px]', className)} />);

export function Field({ label, error, hint, children, required }: { label: string; error?: string; hint?: string; children: (id: string, describedBy?: string) => ReactNode; required?: boolean }) {
  const id = useId(); const msgId = `${id}-msg`;
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="block text-[13px] font-medium text-ink">{label}{required && <span className="text-bad" aria-hidden> *</span>}</label>
      {children(id, error || hint ? msgId : undefined)}
      {error ? <p id={msgId} role="alert" className="text-[13px] text-bad">{error}</p> : hint ? <p id={msgId} className="text-[13px] text-muted">{hint}</p> : null}
    </div>);
}

// ------------------------------------------------------------------ modal
export function Modal({ title, onClose, children, wide, footer }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean; footer?: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null); const titleId = useId();
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const first = ref.current?.querySelector<HTMLElement>('input,select,textarea,button:not([data-close])');
    (first ?? ref.current)?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'Tab' && ref.current) {
        const f = [...ref.current.querySelectorAll<HTMLElement>('a[href],button:not([disabled]),input:not([disabled]),select,textarea,[tabindex]:not([tabindex="-1"])')];
        if (!f.length) return; const a = f[0], z = f[f.length - 1];
        if (e.shiftKey && document.activeElement === a) { e.preventDefault(); z.focus(); } else if (!e.shiftKey && document.activeElement === z) { e.preventDefault(); a.focus(); }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('keydown', onKey); prev?.focus(); };
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-ink/45 p-4 sm:p-10" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} className={cx('w-full rounded-lg bg-white shadow-xl', wide ? 'max-w-3xl' : 'max-w-lg')}>
        <header className="flex items-center justify-between border-b border-line px-5 py-3">
          <h2 id={titleId} className="text-base font-semibold">{title}</h2>
          <button data-close aria-label="Close dialog" onClick={onClose} className="rounded p-1 text-muted hover:bg-paper min-h-[40px] min-w-[40px] flex items-center justify-center"><X className="h-4 w-4" /></button>
        </header>
        <div className="space-y-4 p-5">{children}</div>
        {footer && <footer className="flex justify-end gap-2 border-t border-line px-5 py-3">{footer}</footer>}
      </div>
    </div>);
}

// ------------------------------------------------------------------ tables
// fluid=true: no min-width, no horizontal scroll (for narrow summary tables inside cards)
// fluid=false (default): min-w-[640px] with horizontal scroll wrapper for full data tables
export const Table = ({ children, className, fluid, label = 'Data table' }: { children: ReactNode; className?: string; fluid?: boolean; label?: string }) => (
  <div tabIndex={0} role="region" aria-label={label} className={cx('relative overflow-x-auto', fluid ? '' : 'table-scroll-x', className)}><table className={cx('w-full text-left', !fluid && 'min-w-[640px]')}>{children}</table></div>);

// Primary label for a document: its descriptive name, with the document ID (and reference number) as secondary text.
export const DocLabel = ({ name, code, reference, file }: { name?: string | null; code?: string | null; reference?: string | null; file?: string | null }) => (
  <span className="block"><span className="font-medium">{name?.trim() || 'Unnamed Document'}</span>
    <span className="block text-[13px] font-normal text-muted">{[code && `Document ID: ${code}`, reference && `Ref ${reference}`, file].filter(Boolean).join(' · ')}</span></span>);
export const Th = ({ children, sort, active, dir, onSort, className }: { children?: ReactNode; sort?: string; active?: boolean; dir?: string; onSort?: (k: string) => void; className?: string }) => (
  <th scope="col" aria-sort={active ? (dir === 'asc' ? 'ascending' : 'descending') : undefined} className={cx('border-b border-line bg-[#f8fafc] px-3.5 py-2.5 text-xs font-semibold text-muted uppercase tracking-wider', className)}>
    {sort && onSort ? <button className="-my-1.5 inline-flex min-h-[28px] items-center gap-1 hover:text-ink transition-colors" onClick={() => onSort(sort)}>{children}<span aria-hidden className="text-[10px]">{active ? (dir === 'asc' ? '▲' : '▼') : '↕'}</span></button> : children}
  </th>);
export const Td = ({ children, className, colSpan }: { children?: ReactNode; className?: string; colSpan?: number }) => <td colSpan={colSpan} className={cx('border-b border-line/70 px-3.5 py-3 align-top text-sm', className)}>{children}</td>;

export function Pager({ page, pages, total, onPage }: { page: number; pages: number; total: number; onPage: (p: number) => void }) {
  return (
    <nav aria-label="Pagination" className="flex items-center justify-between gap-3 border-t border-line px-3 py-2 text-[13px] text-muted">
      <span>{total} result{total === 1 ? '' : 's'}</span>
      <span className="flex items-center gap-1">
        <Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="Previous page"><ChevronLeft className="h-4 w-4" /></Button>
        <span aria-live="polite">Page {page} of {pages}</span>
        <Button size="sm" variant="secondary" disabled={page >= pages} onClick={() => onPage(page + 1)} aria-label="Next page"><ChevronRight className="h-4 w-4" /></Button>
      </span>
    </nav>);
}

export function Tabs({ tabs, value, onChange }: { tabs: { key: string; label: string; count?: number }[]; value: string; onChange: (k: string) => void }) {
  return (
    <div role="tablist" className="flex gap-1 overflow-x-auto border-b border-line">
      {tabs.map(t => (
        <button key={t.key} role="tab" aria-selected={value === t.key} onClick={() => onChange(t.key)}
          className={cx('whitespace-nowrap border-b-2 px-3.5 py-2.5 text-[14px] font-medium transition-colors duration-100', value === t.key ? 'border-brand text-brand' : 'border-transparent text-muted hover:text-ink')}>
          {t.label}{t.count != null && <span className="ml-1.5 rounded bg-paper px-1.5 text-xs text-muted">{t.count}</span>}
        </button>))}
    </div>);
}

// ------------------------------------------------------------------ toasts
type Toast = { id: number; kind: 'ok' | 'err'; text: string };
const ToastCtx = createContext<{ ok: (t: string) => void; err: (t: string) => void }>({ ok: () => {}, err: () => {} });
export const useToast = () => useContext(ToastCtx);
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const push = useCallback((kind: Toast['kind'], text: string) => {
    const id = Date.now() + Math.random(); setItems(x => [...x, { id, kind, text }]);
    setTimeout(() => setItems(x => x.filter(i => i.id !== id)), kind === 'err' ? 7000 : 3500);
  }, []);
  return (
    <ToastCtx.Provider value={{ ok: t => push('ok', t), err: t => push('err', t) }}>
      {children}
      <div aria-live="polite" className="fixed bottom-4 right-4 z-[60] flex max-w-sm flex-col gap-2">
        {items.map(t => (
          <div key={t.id} role={t.kind === 'err' ? 'alert' : 'status'} className={cx('flex items-start gap-2 rounded-md border px-3 py-2.5 shadow-lg', t.kind === 'ok' ? 'border-good/30 bg-white text-ink' : 'border-bad/30 bg-bad-soft text-bad')}>
            {t.kind === 'ok' ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-good" aria-hidden /> : <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />}<span>{t.text}</span>
          </div>))}
      </div>
    </ToastCtx.Provider>);
}

// ------------------------------------------------------------------ deadline meter (shows where an item sits between "entered stage" and "due")
export function DeadlineMeter({ daysInStage, daysToDue, status, due, compact }: { daysInStage: number; daysToDue: number | null; status: string; due?: string | null; compact?: boolean }) {
  if (status === 'none' || status === 'closed' || daysToDue == null) return <span className="text-muted">{status === 'closed' ? 'Closed' : 'No deadline'}</span>;
  const total = daysInStage + Math.max(daysToDue, 0);
  const pct = status === 'overdue' ? 100 : total <= 0 ? 100 : Math.min(100, Math.round((daysInStage / total) * 100));
  const color = status === 'overdue' ? 'bg-bad' : status === 'due_soon' ? 'bg-[#d97706]' : 'bg-teal';
  const text = daysToDue < 0 ? `${-daysToDue}d overdue` : daysToDue === 0 ? 'Due today' : `${daysToDue}d left`;
  return (
    <div className={cx('min-w-0', compact ? 'w-28' : 'w-40')} title={due ? `Deadline ${due}` : undefined}>
      <div className="h-1.5 overflow-hidden rounded-full bg-[#e3e9f0]" role="img" aria-label={`${text}, ${pct}% of the stage time used`}>
        <div className={cx('h-full rounded-full', color)} style={{ width: `${Math.max(pct, 4)}%` }} />
      </div>
      <p className={cx('mt-0.5 text-xs', status === 'overdue' ? 'font-medium text-bad' : status === 'due_soon' ? 'font-medium text-warn' : 'text-muted')}>{text}</p>
    </div>);
}

export const KV = ({ label, children }: { label: string; children: ReactNode }) => (
  <div><dt className="text-[13px] text-muted">{label}</dt><dd className="font-medium">{children}</dd></div>);

// ------------------------------------------------------------------ status badge: icon + text + colour, so meaning never depends on colour alone
const ICON: Record<Tone, any> = { good: Check, warn: AlertTriangle, bad: XCircle, brand: Clock, teal: Info, neutral: CircleDashed };
export const StatusBadge = ({ tone = 'neutral', children, title }: { tone?: Tone; children: ReactNode; title?: string }) => {
  const I = ICON[tone];
  return <span title={title} className={cx('inline-flex items-center gap-1 whitespace-nowrap rounded px-2 py-0.5 text-xs font-medium', TONES[tone])}><I className="h-3 w-3 shrink-0" aria-hidden />{children}</span>;
};

// ------------------------------------------------------------------ tooltip: shown on hover AND keyboard focus, and described to screen readers
export function Tip({ text, children, side = 'right' }: { text: string; children: ReactNode; side?: 'right' | 'bottom' }) {
  const id = useId(); const [show, setShow] = useState(false);
  return (
    <span className="relative inline-flex" onMouseEnter={() => setShow(true)} onMouseLeave={() => setShow(false)} onFocus={() => setShow(true)} onBlur={() => setShow(false)}>
      <span aria-describedby={show ? id : undefined} className="contents">{children}</span>
      {show && <span id={id} role="tooltip" className={cx('pointer-events-none absolute z-50 whitespace-nowrap rounded bg-ink px-2 py-1 text-[12px] text-white shadow-lg', side === 'right' ? 'left-full top-1/2 ml-2 -translate-y-1/2' : 'left-1/2 top-full mt-1.5 -translate-x-1/2')}>{text}</span>}
    </span>);
}

// ------------------------------------------------------------------ confirmation for consequential actions
export function ConfirmDialog({ title, body, confirmLabel, danger, onConfirm, onClose }: { title: string; body: ReactNode; confirmLabel: string; danger?: boolean; onConfirm: () => Promise<unknown>; onClose: () => void }) {
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<unknown>(null);
  const go = async () => { setBusy(true); setErr(null); try { await onConfirm(); onClose(); } catch (e) { setErr(e); } finally { setBusy(false); } };
  return (
    <Modal title={title} onClose={onClose} footer={<><Button onClick={onClose}>Cancel</Button><Button variant={danger ? 'danger' : 'primary'} busy={busy} onClick={go}>{confirmLabel}</Button></>}>
      <div>{body}</div>{!!err && <ErrorBox error={err} />}
    </Modal>);
}

// ------------------------------------------------------------------ stepper (progress through a long task)
export function Stepper({ steps, label = 'Progress' }: { steps: { label: string; state: 'done' | 'current' | 'todo'; hint?: string }[]; label?: string }) {
  return (
    <ol aria-label={label} className="flex flex-wrap gap-x-6 gap-y-2">
      {steps.map((s, i) => (
        <li key={s.label} aria-current={s.state === 'current' ? 'step' : undefined} className="flex items-center gap-2">
          <span className={cx('flex h-6 w-6 items-center justify-center rounded-full border text-[12px] font-semibold', s.state === 'done' ? 'border-good bg-good text-white' : s.state === 'current' ? 'border-brand bg-brand text-white' : 'border-line bg-white text-muted')}>{s.state === 'done' ? <Check className="h-3.5 w-3.5" aria-hidden /> : i + 1}</span>
          <span className={cx('text-[14px]', s.state === 'current' ? 'font-semibold' : s.state === 'todo' ? 'text-muted' : '')}>{s.label}{s.hint && <span className="block text-[12px] font-normal text-muted">{s.hint}</span>}</span>
          <span className="sr-only">{s.state === 'done' ? '(completed)' : s.state === 'current' ? '(current step)' : '(not started)'}</span>
        </li>))}
    </ol>);
}

// ------------------------------------------------------------------ skeleton, used only where a list will replace it
export const Skeleton = ({ rows = 4 }: { rows?: number }) => (
  <div role="status" aria-label="Loading" className="space-y-2 p-4">{Array.from({ length: rows }).map((_, i) => <div key={i} className="skeleton h-5" style={{ width: `${90 - i * 9}%` }} />)}<span className="sr-only">Loading…</span></div>);
