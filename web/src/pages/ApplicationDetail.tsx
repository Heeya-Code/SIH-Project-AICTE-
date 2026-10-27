import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ArrowRight, Bell, CalendarClock, CheckCircle2, ClipboardList, Download, Eye, FileText, FileUp, GitCommitHorizontal, MessageSquare, Send, ShieldCheck, XCircle } from 'lucide-react';
import { api, download, errMsg } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useCrumb } from '../lib/pagemeta';
import { trackRecent } from '../lib/recent';
import { APP_STATUS, fmtDate, fmtDateTime, pretty, toneFor, ROLE_LABEL } from '../lib/format';
import { Badge, Button, Card, DeadlineMeter, DocLabel, Empty, ErrorBox, KV, Modal, PageHeader, Query, Skeleton, StatusBadge, Stepper, Table, Tabs, Td, Textarea, Th, useToast } from '../components/ui';
import { UploadDialog } from '../components/UploadDialog';
import { ReasonDialog } from '../components/ReasonDialog';
import { DocPreview } from '../components/DocPreview';
import { StageStepper } from '../components/StageStepper';

const lc = (x: string) => x.charAt(0).toLowerCase() + x.slice(1); // lowercase the first letter only, so acronyms such as EVC survive
const KIND_ICON: Record<string, any> = { deficiency: AlertTriangle, verification: ShieldCheck, stage: GitCommitHorizontal, observation: MessageSquare, evc: CalendarClock, document: FileText, compliance: ShieldCheck, reminder: Bell, escalation: AlertTriangle };
const DOC_STATE: Record<string, { label: string; tone: any }> = { missing: { label: 'Missing', tone: 'bad' }, returned: { label: 'Returned: needs correction', tone: 'bad' }, awaiting_verification: { label: 'Uploaded, awaiting verification', tone: 'warn' }, verified: { label: 'Verified by an officer', tone: 'good' } };
const RISK: Record<string, { label: string; tone: any }> = { confirmed_over: { label: '', tone: 'bad' }, confirmed_overdue: { label: 'Past the deadline (confirmed)', tone: 'bad' }, likely_late: { label: 'Likely to be late (forecast)', tone: 'warn' }, watch: { label: 'Close to the deadline', tone: 'warn' }, on_track: { label: 'On track', tone: 'good' } };

export default function ApplicationDetail() {
  const { id } = useParams(); const { user } = useAuth(); const qc = useQueryClient(); const toast = useToast();
  const [tab, setTab] = useState('overview'); const [dialog, setDialog] = useState<any>(null); const [upload, setUpload] = useState<{ defaultType?: string } | null>(null); const [summary, setSummary] = useState<string | null>(null); const [review, setReview] = useState(false); const [preview, setPreview] = useState<any>(null);
  const q = useQuery({ queryKey: ['application', id], queryFn: () => api<any>(`/applications/${id}`) });
  useCrumb(q.data?.application.ref); if (q.data) trackRecent(user!.id, { id: q.data.application.id, ref: q.data.application.ref, title: q.data.application.title });
  const refresh = () => { for (const k of ['application', 'timeline', 'case-notifs', 'case-audit']) qc.invalidateQueries({ queryKey: [k, id] }); for (const k of ['applications', 'dashboard', 'unread', 'queue', 'queue-summary']) qc.invalidateQueries({ queryKey: [k] }); };
  if (q.isLoading) return <Skeleton rows={8} />;
  if (q.error) return <ErrorBox error={q.error} onRetry={() => q.refetch()} />;
  const d = q.data, a = d.application, inst = user!.role === 'institution', staff = !inst, rd = d.readiness;
  const editableDocs = inst && ['draft', 'returned'].includes(a.status);
  const docOptions = d.required_documents.map((r: any) => ({ doc_type: r.doc_type, has_expiry: r.has_expiry, display_name: r.display_name }));
  const tabs = [{ key: 'overview', label: 'Overview' }, { key: 'documents', label: 'Documents', count: d.documents.filter((x: any) => x.is_current).length },
    { key: 'deficiencies', label: 'Deficiencies', count: d.deficiencies.filter((x: any) => x.status !== 'closed').length || undefined }, { key: 'timeline', label: 'Timeline' },
    ...(d.evc.length ? [{ key: 'evc', label: 'EVC' }] : []), ...(d.undertakings.length ? [{ key: 'obligations', label: 'Obligations', count: d.undertakings.length }] : []),
    { key: 'notifications', label: 'Notifications' }, ...(staff ? [{ key: 'audit', label: 'Audit history' }] : [])];
  const download_ = (text: string) => { const u = URL.createObjectURL(new Blob([text], { type: 'text/plain' })); const l = document.createElement('a'); l.href = u; l.download = `${a.ref}-summary.txt`; l.click(); setTimeout(() => URL.revokeObjectURL(u), 1000); };
  return (
    <>
      <PageHeader title={<span className="flex flex-wrap items-center gap-2">{a.ref}<Badge tone={APP_STATUS[a.status]?.tone}>{APP_STATUS[a.status]?.label}</Badge>{d.synthetic && <Badge tone="neutral" title="Generated demonstration data, not a genuine AICTE record">Synthetic</Badge>}</span>}
        subtitle={<>{a.title}<br /><span className="text-[13px]">{a.institution_name}, {a.region_name} · {a.category_name}</span></>}
        actions={<>
          <Button onClick={async () => { try { setSummary((await api(`/applications/${id}/summary`)).text); } catch (e) { toast.err(errMsg(e)); } }}><ClipboardList className="h-4 w-4" aria-hidden />Case summary</Button>
          {inst && a.status === 'draft' && <Button variant="primary" onClick={() => setReview(true)}><Send className="h-4 w-4" aria-hidden />Review and submit</Button>}</>} />

      <StageStepper stages={d.stages} currentStageKey={a.current_stage} status={a.status} stageDueDate={a.stage_due_date} />

      <StatusStrip d={d} />

      {a.status === 'draft' && inst && <DraftSteps d={d} />}
      {inst && ['draft', 'returned'].includes(a.status) && <ReadinessCard rd={rd} onUpload={t => setUpload({ defaultType: t })} editable={editableDocs} />}

      {d.available_actions.length > 0 && (
        <Card title="What you can do now" className="mb-4">
          <ul className="space-y-3">{d.available_actions.map((x: any) => {
            const unmet = x.prerequisites.filter((p: any) => !p.met);
            return (
              <li key={x.action} className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1"><p className="font-medium">{x.label}<span className="font-normal text-muted"> (moves to {x.to_stage_name})</span></p>
                  {x.prerequisites.length > 0 && <ul className="mt-1 space-y-0.5 text-[13px]">{x.prerequisites.map((p: any) => <li key={p.key} className={`flex items-center gap-1.5 ${p.met ? 'text-good' : 'text-muted'}`}>{p.met ? <CheckCircle2 className="h-3.5 w-3.5" aria-hidden /> : <XCircle className="h-3.5 w-3.5" aria-hidden />}<span className="sr-only">{p.met ? 'Done: ' : 'Not done: '}</span>{p.label}</li>)}</ul>}</div>
                <Button variant={['reject', 'withdraw'].includes(x.action) ? 'danger' : x.action === 'return' ? 'secondary' : 'primary'} disabled={unmet.length > 0} title={unmet.length ? `Not yet: ${unmet.map((u: any) => u.label).join('; ')}` : undefined} onClick={() => setDialog(x)}>{x.label}</Button>
              </li>); })}</ul>
        </Card>)}

      <Tabs tabs={tabs} value={tab} onChange={setTab} />
      <div className="mt-4">
        {tab === 'overview' && <Overview d={d} inst={inst} onChange={refresh} />}
        {tab === 'documents' && <DocumentsTab d={d} editable={editableDocs} inst={inst} onUpload={t => setUpload({ defaultType: t })} onPreview={setPreview} onChange={refresh} />}
        {tab === 'deficiencies' && <DeficienciesTab d={d} />}
        {tab === 'timeline' && <TimelineTab id={id!} d={d} />}
        {tab === 'evc' && <EvcTab d={d} />}
        {tab === 'obligations' && <ObligationsTab d={d} />}
        {tab === 'notifications' && <CaseNotifications id={id!} />}
        {tab === 'audit' && <AuditTab id={id!} />}
      </div>

      {dialog && <ReasonDialog title={dialog.label} required={dialog.requires_reason} danger={['reject', 'withdraw'].includes(dialog.action)} submitLabel={dialog.label}
        label={dialog.action === 'resubmit' ? 'Your response to the clarification request' : dialog.action === 'return' ? 'What does the institution need to clarify or correct?' : dialog.requires_reason ? 'Reason' : 'Note (optional)'}
        intro={<>This will move {a.ref} to <b>{dialog.to_stage_name}</b>. It is recorded in the case timeline and the audit trail and cannot be undone from here.</>}
        onSubmit={async reason => { await api(`/applications/${id}/transitions`, { body: { action: dialog.action, reason: reason || undefined, row_version: d.row_version } }); toast.ok(`${dialog.label}: done`); refresh(); }} onClose={() => setDialog(null)} />}
      {upload && <UploadDialog applicationId={Number(id)} options={docOptions} defaultType={upload.defaultType} onClose={() => setUpload(null)} />}
      {preview && <DocPreview id={preview.id} name={preview.display_name} fileName={preview.file_name} onClose={() => setPreview(null)} />}
      {review && <SubmitDialog d={d} onClose={() => setReview(false)} onDone={() => { toast.ok('Application submitted'); refresh(); }} />}
      {summary !== null && (
        <Modal title="Case summary" onClose={() => setSummary(null)} footer={<><Button onClick={() => { navigator.clipboard?.writeText(summary); toast.ok('Copied'); }}>Copy</Button><Button onClick={() => download_(summary)}><Download className="h-4 w-4" aria-hidden />Download</Button><Button variant="primary" onClick={() => setSummary(null)}>Close</Button></>}>
          <pre className="whitespace-pre-wrap rounded-md bg-paper p-3 text-[13px]">{summary}</pre></Modal>)}
    </>);
}

// ------------------------------------------------------------------------------------------------ status strip: where is it, who has it, what now, what next
function StatusStrip({ d }: { d: any }) {
  const a = d.application, s = d.stage_summary; const auto = d.next_steps.find((x: any) => x.automatic);
  const next = d.next_steps.filter((x: any) => !x.automatic)[0];
  return (
    <section aria-label="Where this case stands" className="mb-4 grid gap-px overflow-hidden rounded-lg border border-line bg-line sm:grid-cols-2 xl:grid-cols-4">
      <div className="bg-white p-4"><p className="text-[13px] text-muted">Stage</p><p className="text-[17px] font-semibold">{s?.name ?? pretty(a.status)}</p>{a.stage_due_date && a.status !== 'draft' && !s?.terminal && <div className="mt-1"><DeadlineMeter daysInStage={a.days_in_stage} daysToDue={a.days_to_due} status={a.due_status} due={a.stage_due_date} /></div>}</div>
      <div className="bg-white p-4"><p className="text-[13px] text-muted">Waiting on</p><p className="font-semibold">{s?.waiting_on ? (ROLE_LABEL[s.responsible_role] ?? s.waiting_on) : s?.terminal ? 'Nobody: finished' : 'Your institution'}</p>{s?.assignee && <p className="text-[13px] text-muted">Assigned to {s.assignee}</p>}{s && !s.terminal && !s.assignee && a.status !== 'draft' && s.responsible_role !== 'institution' && <p className="text-[13px] font-medium text-bad">Nobody is assigned yet</p>}</div>
      <div className="bg-white p-4"><p className="text-[13px] text-muted">What needs to happen now</p><p className="font-medium">{s?.pending_action ?? '–'}</p></div>
      <div className="bg-white p-4"><p className="text-[13px] text-muted">What happens next</p>
        {s?.terminal ? <p>The case is closed. It can only be reopened by a role the workflow allows.</p> : a.status === 'draft' ? <p>After you submit, the Region's scrutiny officer receives it. Nothing is sent until then.</p>
          : next ? <p>When done, the {(ROLE_LABEL[next.role] ?? next.role).toLowerCase()} can <b>{lc(next.label)}</b>, which moves it to <b>{next.to_stage_name}</b>.</p> : auto ? <p>It moves to <b>{auto.to_stage_name}</b> automatically once {auto.requirements.join(' and ').toLowerCase()}.</p> : <p>Waiting for the next action.</p>}</div>
    </section>);
}

function DraftSteps({ d }: { d: any }) {
  const rd = d.readiness; const done = rd.items.length - rd.missing;
  return (
    <Card className="mb-4"><Stepper label="Application progress" steps={[
      { label: 'Details', state: 'done', hint: 'Saved as a draft' },
      { label: 'Documents', state: rd.missing || rd.returned ? 'current' : 'done', hint: `${done} of ${rd.items.length} uploaded${rd.returned ? `, ${rd.returned} returned` : ''}` },
      { label: 'Review and submit', state: rd.can_submit ? 'current' : 'todo', hint: rd.can_submit ? 'Ready when you are' : 'Unlocks when all documents are uploaded' },
    ]} /></Card>);
}

function ReadinessCard({ rd, onUpload, editable }: { rd: any; onUpload: (t?: string) => void; editable: boolean }) {
  return (
    <Card title="Application readiness" className="mb-4" actions={<StatusBadge tone={rd.state === 'ready_to_submit' ? 'good' : rd.state === 'not_ready' ? 'bad' : 'brand'}>{rd.label}</StatusBadge>}>
      <ul className="divide-y divide-line/70">{rd.items.map((i: any) => (
        <li key={i.doc_type} className="flex flex-wrap items-center justify-between gap-2 py-2 first:pt-0 last:pb-0">
          <div className="min-w-0"><DocLabel name={i.display_name} code={i.doc_code} />{i.correction && <p className="mt-0.5 text-[13px] text-bad">Correction needed: {i.correction}</p>}{i.has_expiry && i.expiry_date && <p className="text-[13px] text-muted">Expires {fmtDate(i.expiry_date)}</p>}</div>
          <div className="flex items-center gap-2"><StatusBadge tone={DOC_STATE[i.state].tone}>{DOC_STATE[i.state].label}</StatusBadge>{editable && ['missing', 'returned'].includes(i.state) && <Button size="sm" variant="primary" onClick={() => onUpload(i.doc_type)}><FileUp className="h-3.5 w-3.5" aria-hidden />{i.state === 'missing' ? 'Upload' : 'Replace'}</Button>}</div>
        </li>))}</ul>
      <p className="mt-3 text-[13px] text-muted">{rd.note ?? 'A document is only verified when an officer decides so. Uploading does not verify it.'}{(rd.open_deficiencies > 0 || rd.outstanding_obligations > 0) && ` Open deficiencies: ${rd.open_deficiencies}. Obligations still to complete: ${rd.outstanding_obligations}.`}</p>
    </Card>);
}

// Final check before anything leaves the institution: a summary, what happens next, and an explicit confirmation.
function SubmitDialog({ d, onClose, onDone }: { d: any; onClose: () => void; onDone: () => void }) {
  const a = d.application, rd = d.readiness; const [ok, setOk] = useState(false); const [err, setErr] = useState<unknown>(null); const [busy, setBusy] = useState(false);
  const go = async () => { setBusy(true); setErr(null); try { await api(`/applications/${a.id}/submit`, { method: 'POST', body: {} }); onDone(); onClose(); } catch (e) { setErr(e); } finally { setBusy(false); } };
  return (
    <Modal title="Review and submit" wide onClose={onClose} footer={<><Button onClick={onClose}>Go back</Button><Button variant="primary" busy={busy} disabled={!rd.can_submit || !ok} onClick={go}>Submit application</Button></>}>
      <dl className="grid gap-3 sm:grid-cols-2"><KV label="Application">{a.ref}</KV><KV label="Category">{a.category_name}</KV><div className="sm:col-span-2"><KV label="Title">{a.title}</KV></div></dl>
      <div><p className="mb-1 font-medium">Documents</p><ul className="space-y-1">{rd.items.map((i: any) => <li key={i.doc_type} className="flex items-center justify-between gap-2"><span>{i.display_name}{i.doc_code ? ` (${i.doc_code})` : ''}</span><StatusBadge tone={DOC_STATE[i.state].tone}>{DOC_STATE[i.state].label}</StatusBadge></li>)}</ul></div>
      {!rd.can_submit && <p role="alert" className="rounded-md bg-bad-soft p-3 text-bad">This application is not ready. Upload the missing documents and replace any that were returned first.</p>}
      <div className="rounded-md bg-brand-soft p-3 text-[14px]"><p className="font-medium">What happens after you submit</p><p>It goes to the Region's scrutiny officer. Documents are then verified by an officer. You cannot edit it afterwards unless it is returned to you. Submitting does not mean it is approved.</p></div>
      <label className="flex items-start gap-2"><input type="checkbox" className="mt-1" checked={ok} onChange={e => setOk(e.target.checked)} />I confirm that the details and documents are correct and complete to the best of my knowledge.</label>
      {!!err && <ErrorBox error={err} onRetry={go} />}
    </Modal>);
}

// ------------------------------------------------------------------------------------------------ tabs
function Overview({ d, inst, onChange }: { d: any; inst: boolean; onChange: () => void }) {
  const a = d.application; const toast = useToast(); const [text, setText] = useState(''); const [err, setErr] = useState<unknown>(null); const { user } = useAuth();
  const add = useMutation({ mutationFn: () => api(`/applications/${a.id}/observations`, { body: { text } }), onSuccess: () => { setText(''); toast.ok('Observation recorded'); onChange(); }, onError: setErr });
  const canObserve = !inst && d.stage && d.stage.responsible_role === user!.role && !['approved', 'rejected', 'withdrawn', 'draft'].includes(a.status);
  const risk = d.deadline_risk;
  return (
    <div className="grid gap-4 lg:grid-cols-[1.2fr_1fr]">
      <div className="space-y-4">
        <Card title="What happens next in this workflow">
          {d.next_steps.length === 0 ? <p className="text-muted">{a.status === 'draft' ? 'The workflow starts when you submit.' : 'This is a final stage.'}</p> : (
            <ul className="space-y-2">{d.next_steps.map((s: any) => (
              <li key={s.action} className="flex items-start gap-2"><ArrowRight className="mt-1 h-4 w-4 shrink-0 text-brand" aria-hidden /><div><p><b>{ROLE_LABEL[s.role] ?? s.role}</b> {s.automatic ? 'is not needed: it moves on automatically' : `can ${lc(s.label)}`} <span className="text-muted">→ {s.to_stage_name}</span></p>
                {(s.requirements.length > 0 || s.requires_reason) && <p className="text-[13px] text-muted">Needs: {[...s.requirements, ...(s.requires_reason ? ['a written reason'] : [])].join('; ')}</p>}</div></li>))}</ul>)}
        </Card>
        <Card title="Case details"><dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
          <KV label="Workflow">{d.workflow ? `${d.workflow.name}, version ${d.workflow.version}` : 'Not started'}</KV><KV label="Submitted">{a.submitted_at ? fmtDateTime(a.submitted_at) : 'Not submitted'}</KV>
          <KV label="Total age">{a.submitted_at ? `${a.age_days} days` : '–'}</KV><KV label="Stage deadline">{fmtDate(a.stage_due_date)}</KV></dl>
          {a.summary && <p className="mt-4 rounded-md bg-paper p-3 text-[13px]">{a.summary}</p>}</Card>
        {risk && (
          <Card title="Deadline risk" actions={<StatusBadge tone={RISK[risk.risk].tone}>{RISK[risk.risk].label}</StatusBadge>}>
            <p className="mb-2 text-[13px] text-muted">{risk.risk === 'confirmed_overdue' ? 'This is a recorded fact: the deadline has passed.' : 'This is an estimate from the case\'s own dates and past stage durations, not a confirmed status.'} Confidence: {risk.confidence}.</p>
            <ul className="list-disc space-y-0.5 pl-5">{risk.factors.map((f: string, i: number) => <li key={i}>{f}</li>)}</ul></Card>)}
        {!inst && (
          <Card title="Observations">
            {canObserve && (
              <form className="mb-4 space-y-2" onSubmit={e => { e.preventDefault(); setErr(null); add.mutate(); }}>
                <Textarea aria-label="New observation" placeholder="Record what you found when reviewing this stage" value={text} onChange={e => setText(e.target.value)} />
                {!!err && <ErrorBox error={err} />}<Button type="submit" variant="primary" busy={add.isPending} disabled={text.trim().length < 3}>Add observation</Button></form>)}
            {d.observations.length === 0 ? <p className="text-muted">No observations recorded yet.</p> : <ul className="space-y-3">{d.observations.map((o: any) => <li key={o.id} className="border-l-2 border-teal pl-3"><p>{o.text}</p><p className="text-[13px] text-muted">{o.author_name}, {pretty(o.stage_key)}, {fmtDateTime(o.at)}</p></li>)}</ul>}</Card>)}
      </div>
      <div className="space-y-4">
        {!(inst && ['draft', 'returned'].includes(a.status)) && <ReadinessCard rd={d.readiness} onUpload={() => {}} editable={false} />}
        <Card title="Open tasks" pad={false}>{d.tasks.filter((t: any) => t.status === 'open').length === 0 ? <Empty title="No open tasks" /> : (
          <ul>{d.tasks.filter((t: any) => t.status === 'open').map((t: any) => <li key={t.id} className="border-b border-line/70 px-4 py-2.5 last:border-0"><p className="font-medium">{t.title}</p><p className="text-[13px] text-muted">{pretty(t.role)}{t.assigned_name ? `, ${t.assigned_name}` : ''}{t.due_date ? `, due ${fmtDate(t.due_date)}` : ''}</p></li>)}</ul>)}</Card>
        <Card title="Submissions" pad={false}>{d.submissions.length === 0 ? <Empty title="Not submitted yet" /> : <ul>{d.submissions.map((s: any) => (
          <li key={s.id} className="border-b border-line/70 px-4 py-2.5 last:border-0"><p className="font-medium">Version {s.version}, {s.kind === 'initial' ? 'initial submission' : 'resubmission'}</p><p className="text-[13px] text-muted">{fmtDateTime(s.submitted_at)}</p>{s.note && <p className="mt-1">{s.note}</p>}
            {s.documents?.length > 0 && <ul className="mt-1 list-disc pl-4 text-[13px]">{s.documents.map((x: any) => <li key={x.id}>{x.display_name} <span className="text-muted">({x.doc_code}, v{x.version})</span></li>)}</ul>}</li>))}</ul>}</Card>
      </div>
    </div>);
}

function DocumentsTab({ d, editable, inst, onUpload, onPreview, onChange }: { d: any; editable: boolean; inst: boolean; onUpload: (t?: string) => void; onPreview: (x: any) => void; onChange: () => void }) {
  const toast = useToast(); const [ret, setRet] = useState<any>(null); const { user } = useAuth(); const [versions, setVersions] = useState(false);
  const officer = ['regional_officer', 'bureau_officer'].includes(user!.role);
  const verify = async (doc: any, decision: string, note?: string) => { await api(`/documents/${doc.id}/verify`, { body: { decision, note } }); toast.ok(decision === 'verified' ? 'Document verified' : 'Document returned'); onChange(); };
  const shown = d.documents.filter((x: any) => versions || x.is_current);
  return (
    <Card title="Documents" pad={false} actions={<><label className="flex items-center gap-1.5 text-[13px]"><input type="checkbox" checked={versions} onChange={e => setVersions(e.target.checked)} />Show earlier versions</label>{editable && <Button variant="primary" size="sm" onClick={() => onUpload()}><FileUp className="h-4 w-4" aria-hidden />Upload document</Button>}</>}>
      {shown.length === 0 ? <Empty title="No documents uploaded yet" hint={editable ? 'Upload each required document, then review and submit.' : undefined} action={editable ? <Button variant="primary" onClick={() => onUpload()}>Upload document</Button> : undefined} /> : (
        <Table label="Documents of this application"><thead><tr><Th>Document</Th><Th>Version</Th><Th>Expiry</Th><Th>Verification</Th><Th>Uploaded</Th><Th><span className="sr-only">Actions</span></Th></tr></thead>
          <tbody>{shown.map((x: any) => (
            <tr key={x.id} className={x.is_current ? '' : 'text-muted'}>
              <Td><DocLabel name={x.display_name} code={x.doc_code} reference={x.reference_no} file={x.file_name} /></Td>
              <Td>v{x.version} {x.is_current ? <Badge tone="teal">Current</Badge> : <Badge>Earlier</Badge>}</Td><Td>{x.expiry_date ? fmtDate(x.expiry_date) : 'No expiry'}</Td>
              <Td><StatusBadge tone={toneFor(x.verification_status)}>{pretty(x.verification_status)}</StatusBadge>{x.verification_note && <p className="mt-0.5 max-w-[220px] text-[13px]">{x.verification_note}</p>}</Td><Td>{fmtDate(x.uploaded_at)}</Td>
              <Td className="whitespace-nowrap">
                <Button size="sm" variant="ghost" aria-label={`Preview ${x.display_name}`} onClick={() => onPreview(x)}><Eye className="h-4 w-4" aria-hidden /></Button>
                <Button size="sm" variant="ghost" aria-label={`Download ${x.display_name}`} onClick={() => download(`/documents/${x.id}/download`, x.file_name).catch(e => toast.err(e.message))}><Download className="h-4 w-4" aria-hidden /></Button>
                {editable && x.is_current && <Button size="sm" variant="ghost" onClick={() => onUpload(x.doc_type)}>Replace</Button>}
                {officer && x.is_current && x.verification_status === 'pending' && <><Button size="sm" variant="ghost" onClick={() => verify(x, 'verified').catch(e => toast.err(e.message))}>Verify</Button><Button size="sm" variant="ghost" onClick={() => setRet(x)}>Return</Button></>}</Td></tr>))}</tbody></Table>)}
      {ret && <ReasonDialog title={`Return ${ret.display_name}`} required label="What needs to be corrected?" submitLabel="Return document" onSubmit={r => verify(ret, 'returned', r)} onClose={() => setRet(null)} />}
      {inst && !editable && d.documents.length > 0 && <p className="border-t border-line px-4 py-2.5 text-[13px] text-muted">Documents can be changed while the application is a draft or has been returned to you.</p>}
    </Card>);
}

const DEF_TONE: Record<string, any> = { open: 'warn', responded: 'brand', closed: 'good' };
function DeficienciesTab({ d }: { d: any }) {
  return (
    <Card title="Deficiencies and corrective actions" pad={false}>
      <p className="border-b border-line px-4 py-2.5 text-[13px] text-muted">A deficiency is raised when the application is returned. The institution's response is recorded as the corrective action, and the reviewing officer closes it when accepted.</p>
      {d.deficiencies.length === 0 ? <Empty title="No deficiencies" hint="If an officer returns this application, the reasons will be listed here." /> : (
        <Table label="Deficiencies"><thead><tr><Th>Deficiency</Th><Th>Raised</Th><Th>Due</Th><Th>Status</Th><Th>Corrective action</Th></tr></thead>
          <tbody>{d.deficiencies.map((x: any) => (
            <tr key={x.id}><Td className="max-w-[300px]"><Badge>{pretty(x.category)}</Badge><p className="mt-1">{x.description}</p><p className="text-[13px] text-muted">At {pretty(x.stage_key)}{x.rule_code ? `, rule ${x.rule_code}` : ''}</p></Td>
              <Td>{fmtDate(x.raised_at.slice(0, 10))}<p className="text-[13px] text-muted">{x.raised_by_name}</p></Td><Td>{fmtDate(x.due_date)}</Td><Td><StatusBadge tone={DEF_TONE[x.status]}>{pretty(x.status)}</StatusBadge>{x.closed_at && <p className="text-[13px] text-muted">{fmtDate(x.closed_at.slice(0, 10))}</p>}</Td>
              <Td className="max-w-[300px]">{x.corrective_action ?? <span className="text-muted">Awaiting the institution's response</span>}{x.responded_at && <p className="text-[13px] text-muted">{fmtDate(x.responded_at.slice(0, 10))}</p>}</Td></tr>))}</tbody></Table>)}
    </Card>);
}

function TimelineTab({ id, d }: { id: string; d: any }) {
  const q = useQuery({ queryKey: ['timeline', id], queryFn: () => api<any[]>(`/applications/${id}/timeline`) });
  return (
    <div className="space-y-4">
      <Card title="How this case reached its current state">
        <Query q={q}>{(rows: any[]) => rows.length === 0 ? <Empty title="Nothing recorded yet" /> : (
          <ol className="relative ml-2 space-y-4 border-l border-line pl-6">{rows.map((e, i) => { const Icon = KIND_ICON[e.kind] ?? GitCommitHorizontal; return (
            <li key={i} className="relative"><span className="absolute -left-[37px] flex h-6 w-6 items-center justify-center rounded-full border border-line bg-white"><Icon className={`h-3.5 w-3.5 ${e.kind === 'escalation' || e.kind === 'deficiency' ? 'text-bad' : e.kind === 'reminder' ? 'text-warn' : 'text-brand'}`} aria-hidden /></span>
              <p className="font-medium"><span className="sr-only">{pretty(e.kind)}: </span>{e.title}</p>{e.detail && <p className="text-muted">{e.detail}</p>}<p className="text-[13px] text-muted">{fmtDateTime(e.at)}{e.actor ? `, ${e.actor}` : ''}</p></li>); })}</ol>)}</Query>
      </Card>
      <Card title="Stage changes" pad={false}>
        <Table label="Stage changes"><thead><tr><Th>When</Th><Th>Change</Th><Th>By</Th><Th>Reason</Th></tr></thead>
          <tbody>{d.history.map((h: any) => (<tr key={h.id}><Td className="whitespace-nowrap">{fmtDateTime(h.at)}</Td><Td>{h.from_stage ? `${pretty(h.from_stage)} to ${pretty(h.to_stage)}` : `Submitted to ${pretty(h.to_stage)}`}<p className="text-[13px] text-muted">{pretty(h.action)}{h.auto ? ' (automatic)' : ''}</p></Td><Td>{h.actor_label}</Td><Td className="max-w-[240px]">{h.reason ?? '–'}</Td></tr>))}</tbody></Table>
      </Card>
    </div>);
}

function EvcTab({ d }: { d: any }) {
  return (
    <Card title="Expert Visit Committee" pad={false}>
      <Table label="EVC records"><thead><tr><Th>State</Th><Th>Schedule by</Th><Th>Visit date</Th><Th>Committee</Th><Th>Completion deadline</Th><Th>Notes</Th></tr></thead>
        <tbody>{d.evc.map((e: any) => (
          <tr key={e.id}><Td><StatusBadge tone={toneFor(e.state)}>{pretty(e.state)}</StatusBadge>{e.reason && <p className="text-[13px] text-bad">{e.reason}</p>}{e.reschedule_count > 0 && <p className="text-[13px] text-muted">Rescheduled {e.reschedule_count}×</p>}</Td>
            <Td>{fmtDate(e.schedule_deadline)}</Td><Td>{fmtDate(e.visit_date ?? e.confirmed_date)}</Td><Td>{e.committee_name ?? '–'}</Td><Td>{fmtDate(e.completion_deadline)}</Td><Td className="max-w-[260px]">{e.visit_notes ?? '–'}</Td></tr>))}</tbody></Table>
    </Card>);
}

function ObligationsTab({ d }: { d: any }) {
  return (
    <Card title="Obligations created from this approval" pad={false}>
      <Table label="Obligations"><thead><tr><Th>Obligation</Th><Th>Due</Th><Th>Status</Th></tr></thead>
        <tbody>{d.undertakings.map((u: any) => <tr key={u.id}><Td><Link className="text-brand hover:underline" to="/compliance">{u.code}</Link><p>{u.condition_text}</p></Td><Td>{fmtDate(u.due_date)}</Td><Td><StatusBadge tone={toneFor(u.effective_status)}>{pretty(u.effective_status)}</StatusBadge></Td></tr>)}</tbody></Table>
    </Card>);
}

function CaseNotifications({ id }: { id: string }) {
  const q = useQuery({ queryKey: ['case-notifs', id], queryFn: () => api<any[]>(`/applications/${id}/notifications`) });
  return (
    <Card title="Notifications about this case (sent to you)" pad={false}><Query q={q}>{(rows: any[]) => rows.length === 0 ? <Empty title="No notifications yet" hint="Reminders, assignments and decisions about this case will appear here." /> : (
      <ul>{rows.map(n => <li key={n.id} className="border-b border-line/70 px-4 py-2.5 last:border-0"><p className="flex flex-wrap items-center gap-2 font-medium">{n.title}{n.ack_required && !n.acked_at ? <StatusBadge tone="warn">Needs acknowledgment</StatusBadge> : null}</p><p className="text-muted">{n.body}</p><p className="text-[13px] text-muted">{fmtDateTime(n.created_at)}</p></li>)}</ul>)}</Query></Card>);
}

function AuditTab({ id }: { id: string }) {
  const q = useQuery({ queryKey: ['case-audit', id], queryFn: () => api<any>(`/applications/${id}/audit`) });
  return (
    <Card title="Audit history" pad={false}><Query q={q}>{(d: any) => (
      <><p className="border-b border-line px-4 py-2.5 text-[13px] text-muted">{d.note}</p>
        <Table label="Audit history"><thead><tr><Th>When</Th><Th>Event</Th><Th>Actor</Th><Th>Detail</Th></tr></thead>
          <tbody>{d.rows.map((r: any) => <tr key={r.id}><Td className="whitespace-nowrap">{fmtDateTime(r.at)}</Td><Td className="font-medium">{r.event_type}</Td><Td>{r.actor_label}</Td><Td className="max-w-[320px] text-[13px]">{r.reason ?? ''}{r.new_state && <span className="block break-all text-muted">{r.new_state}</span>}</Td></tr>)}</tbody></Table></>)}</Query></Card>);
}
