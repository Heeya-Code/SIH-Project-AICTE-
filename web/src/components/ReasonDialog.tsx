import { useState, type ReactNode } from 'react';
import { Button, ErrorBox, Field, Modal, Textarea } from './ui';

// A confirmation dialog with an optional (or required) free-text reason. Used for returns, decisions, rescheduling and reviews.
export function ReasonDialog({ title, intro, label = 'Reason', required, submitLabel, danger, onSubmit, onClose }: {
  title: string; intro?: ReactNode; label?: string; required?: boolean; submitLabel: string; danger?: boolean; onSubmit: (reason: string) => Promise<unknown>; onClose: () => void;
}) {
  const [reason, setReason] = useState(''); const [err, setErr] = useState<unknown>(null); const [busy, setBusy] = useState(false); const [touched, setTouched] = useState(false);
  const missing = required && !reason.trim();
  async function go() {
    setTouched(true); if (missing) return;
    setBusy(true); setErr(null);
    try { await onSubmit(reason.trim()); onClose(); } catch (e) { setErr(e); } finally { setBusy(false); }
  }
  return (
    <Modal title={title} onClose={onClose} footer={<><Button onClick={onClose}>Cancel</Button><Button variant={danger ? 'danger' : 'primary'} busy={busy} onClick={go}>{submitLabel}</Button></>}>
      {intro && <div className="text-muted">{intro}</div>}
      <Field label={label} required={required} error={touched && missing ? 'This is required' : undefined}>{(id, d) => <Textarea id={id} aria-describedby={d} aria-invalid={touched && !!missing} value={reason} maxLength={2000} onChange={e => setReason(e.target.value)} />}</Field>
      {!!err && <ErrorBox error={err} />}
    </Modal>);
}
