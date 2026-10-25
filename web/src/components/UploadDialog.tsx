import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { Button, ErrorBox, Field, Input, Modal, Select, useToast } from './ui';

export type DocOption = { doc_type: string; has_expiry: boolean; display_name?: string };
const schema = z.object({
  doc_type: z.string().min(1, 'Choose a document type'), reference_no: z.string().max(100).optional(),
  issue_date: z.string().optional(), expiry_date: z.string().optional(), expiryRequired: z.boolean(),
  file: z.custom<FileList>().refine(f => f && f.length === 1, 'Attach a file'),
}).superRefine((v, ctx) => {
  if (v.expiryRequired && !v.expiry_date) ctx.addIssue({ code: 'custom', path: ['expiry_date'], message: 'This document needs an expiry date' });
  if (v.issue_date && v.expiry_date && v.expiry_date < v.issue_date) ctx.addIssue({ code: 'custom', path: ['expiry_date'], message: 'Expiry cannot be before the issue date' });
  const f = v.file?.[0];
  if (f && f.size > 5 * 1024 * 1024) ctx.addIssue({ code: 'custom', path: ['file'], message: 'The file is larger than 5 MB' });
  if (f && !/\.(pdf|png|jpe?g)$/i.test(f.name)) ctx.addIssue({ code: 'custom', path: ['file'], message: 'Use a PDF, PNG or JPEG file' });
});
type F = z.infer<typeof schema>;

export function UploadDialog({ applicationId, options, renewOf, defaultType, onClose }: { applicationId?: number; options?: DocOption[]; renewOf?: { id: number; doc_type: string; display_name?: string; has_expiry?: boolean }; defaultType?: string; onClose: () => void }) {
  const qc = useQueryClient(); const toast = useToast();
  const [error, setError] = useState<unknown>(null);
  const opts = renewOf ? [{ doc_type: renewOf.doc_type, display_name: renewOf.display_name, has_expiry: true }] : (options ?? []);
  const { register, handleSubmit, watch, formState: { errors } } = useForm<F>({ resolver: zodResolver(schema), defaultValues: { doc_type: renewOf?.doc_type ?? defaultType ?? '', expiryRequired: false } });
  const type = watch('doc_type');
  const hasExpiry = !!opts.find(o => o.doc_type === type)?.has_expiry || !!renewOf;
  const m = useMutation({
    mutationFn: async (v: F) => {
      const fd = new FormData();
      fd.set('doc_type', v.doc_type); if (applicationId) fd.set('application_id', String(applicationId)); if (renewOf) fd.set('renew_of', String(renewOf.id));
      if (v.reference_no) fd.set('reference_no', v.reference_no); if (v.issue_date) fd.set('issue_date', v.issue_date); if (v.expiry_date) fd.set('expiry_date', v.expiry_date);
      fd.set('file', v.file[0]);
      return api('/documents', { form: fd });
    },
    onSuccess: () => { toast.ok(renewOf ? 'Renewed document uploaded as a new version' : 'Document uploaded'); qc.invalidateQueries(); onClose(); },
    onError: setError,
  });
  const submit = handleSubmit(v => { setError(null); m.mutate({ ...v, expiryRequired: hasExpiry }); });
  return (
    <Modal title={renewOf ? `Renew ${renewOf.display_name ?? renewOf.doc_type}` : 'Upload a document'} onClose={onClose}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" busy={m.isPending} onClick={submit}>Upload</Button></>}>
      <form onSubmit={submit} className="space-y-4" noValidate>
        {renewOf && <p className="rounded-md bg-brand-soft p-3 text-[13px]">The earlier version is kept for reference. The new file becomes the current version and goes back to the reviewer for verification.</p>}
        <Field label="Document type" error={errors.doc_type?.message} required>{(id, d) => (
          <Select id={id} aria-describedby={d} disabled={!!renewOf} {...register('doc_type')}><option value="">Choose…</option>{opts.map(o => <option key={o.doc_type} value={o.doc_type}>{o.display_name ?? o.doc_type}</option>)}</Select>)}</Field>
        <Field label="Reference number" error={errors.reference_no?.message}>{(id, d) => <Input id={id} aria-describedby={d} {...register('reference_no')} />}</Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Issue date" error={errors.issue_date?.message}>{(id, d) => <Input id={id} aria-describedby={d} type="date" {...register('issue_date')} />}</Field>
          <Field label="Expiry date" error={errors.expiry_date?.message} required={hasExpiry} hint={hasExpiry ? undefined : 'Leave empty if this document does not expire.'}>{(id, d) => <Input id={id} aria-describedby={d} aria-invalid={!!errors.expiry_date} type="date" {...register('expiry_date')} />}</Field>
        </div>
        <Field label="File (PDF, PNG or JPEG, up to 5 MB)" error={errors.file?.message as string} required>{(id, d) => <Input id={id} aria-describedby={d} aria-invalid={!!errors.file} type="file" accept=".pdf,.png,.jpg,.jpeg" {...register('file')} />}</Field>
        {!!error && <ErrorBox error={error} />}
      </form>
    </Modal>);
}
