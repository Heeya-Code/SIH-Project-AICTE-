import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Bell, CalendarClock, CheckCircle2, Circle, ClipboardList, Download, FileText, FileUp, GitCommitHorizontal, MessageSquare, ShieldCheck, XCircle } from 'lucide-react';
import { api, download, errMsg } from '../lib/api';
import { useAuth } from '../lib/auth';
import { APP_STATUS, fmtDate, fmtDateTime, pretty, toneFor } from '../lib/format';
import { Badge, Button, Card, DeadlineMeter, DocLabel, Empty, ErrorBox, KV, Modal, PageHeader, Query, Table, Tabs, Td, Textarea, Th, useToast } from '../components/ui';
import { UploadDialog } from '../components/UploadDialog';
import { ReasonDialog } from '../components/ReasonDialog';
import { StageStepper } from '../components/StageStepper';

const KIND_ICON: Record<string, any> = { deficiency: AlertTriangle, verification: ShieldCheck, stage: GitCommitHorizontal, observation: MessageSquare, evc: CalendarClock, document: FileText, compliance: ShieldCheck, reminder: Bell, escalation: AlertTriangle };

export default function ApplicationDetail() {
  const { id } = useParams(); const { user } = useAuth(); const qc = useQueryClient(); const toast = useToast();
  const [tab, setTab] = useState('overview');
  const [dialog, setDialog] = useState<any>(null);
  const [upload, setUpload] = useState<{ defaultType?: string } | null>(null);
  const [summary, setSummary] = useState<string | null>(null);
  const q = useQuery({ queryKey: ['application', id], queryFn: () => api<any>(`/applications/${id}`) });
  const refresh = () => { qc.invalidateQueries({ queryKey: ['application', id] }); qc.invalidateQueries({ queryKey: ['timeline', id] }); qc.invalidateQueries({ queryKey: ['applications'] }); qc.invalidateQueries({ queryKey: ['dashboard'] }); qc.invalidateQueries({ queryKey: ['unread'] }); };
  const submit = useMutation({ mutationFn: () => api(`/applications/${id}/submit`, { method: 'POST', body: {} }), onSuccess: () => { toast.ok('Application submitted'); refresh(); }, onError: e => toast.err(errMsg(e)) });

  return (
    <Query q={q}>{(d: any) => {
      const a = d.application, inst = user!.role === 'institution';
      const editableDocs = inst && ['draft', 'returned'].includes(a.status);
      const docOptions = d.required_documents.map((r: any) => ({ doc_type: r.doc_type, has_expiry: r.has_expiry, display_name: r.display_name }));
      const missing = d.required_documents.filter((r: any) => !r.uploaded);
      const tabs = [{ key: 'overview', label: 'Overview' }, { key: 'documents', label: 'Documents', count: d.documents.filter((x: any) => x.is_current).length }, { key: 'timeline', label: 'Timeline' },
        ...(d.evc.length ? [{ key: 'evc', label: 'EVC' }] : []), ...(d.deficiencies?.length ? [{ key: 'deficiencies', label: 'Deficiencies', count: d.deficiencies.length }] : []), ...(d.undertakings.length ? [{ key: 'obligations', label: 'Obligations', count: d.undertakings.length }] : []), { key: 'history', label: 'History' }];
      return (
        <>
          <PageHeader title={<span className="flex flex-wrap items-center gap-2">{a.ref}<Badge tone={APP_STATUS[a.status]?.tone}>{APP_STATUS[a.status]?.label}</Badge>{d.synthetic && <Badge tone="neutral" title="Generated demonstration data, not a genuine AICTE record">Synthetic</Badge>}</span>}
            subtitle={<>{a.title}<br /><span className="text-[13px]">{a.institution_name}, {a.region_name}</span></>}
            actions={<>
              <Button onClick={async () => { try { setSummary((await api(`/applications/${id}/summary`)).text); } catch (e) { toast.err(errMsg(e)); } }}><ClipboardList className="h-4 w-4" aria-hidden />Summary</Button>
              {inst && a.status === 'draft' && <Button variant="primary" busy={submit.isPending} disabled={missing.length > 0} title={missing.length ? `Upload: ${missing.map((m: any) => m.display_name).join(', ')}` : undefined} onClick={() => submit.mutate()}>Submit application</Button>}</>} />

          {inst && a.status === 'draft' && missing.length > 0 && (
            <div className="mb-4 flex items-start gap-2 rounded-md border border-warn/30 bg-warn-soft p-3 text-warn"><FileUp className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              <p>Upload {missing.map((m: any) => m.display_name).join(', ')} before you can submit.</p></div>)}

          <StageStepper stages={d.stages} currentStageKey={a.current_stage} status={a.status} stageDueDate={a.stage_due_date} />

          {d.available_actions.length > 0 && (
            <Card title="What you can do now" className="mb-4">
              <ul className="space-y-3">{d.available_actions.map((x: any) => {
                const unmet = x.prerequisites.filter((p: any) => !p.met);
                return (
                  <li key={x.action} className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="font-medium">{x.label}<span className="text-muted"> (moves to {x.to_stage_name})</span></p>
                      {x.prerequisites.length > 0 && <ul className="mt-1 space-y-0.5 text-[13px]">{x.prerequisites.map((p: any) => (
                        <li key={p.key} className={`flex items-center gap-1.5 ${p.met ? 'text-good' : 'text-muted'}`}>{p.met ? <CheckCircle2 className="h-3.5 w-3.5" aria-hidden /> : <Circle className="h-3.5 w-3.5" aria-hidden />}{p.label}</li>))}</ul>}
                    </div>
                    <Button variant={['reject', 'withdraw'].includes(x.action) ? 'danger' : x.action === 'return' ? 'secondary' : 'primary'} disabled={unmet.length > 0} title={unmet.length ? `Not yet: ${unmet.map((u: any) => u.label).join('; ')}` : undefined}
                      onClick={() => setDialog(x)}>{x.label}</Button>
                  </li>);
              })}</ul>
            </Card>)}

          <Tabs tabs={tabs} value={tab} onChange={setTab} />
          <div className="mt-4">
            {tab === 'overview' && <Overview d={d} inst={inst} onChange={refresh} />}
            {tab === 'documents' && <DocumentsTab d={d} editable={editableDocs} inst={inst} onUpload={t => setUpload({ defaultType: t })} onChange={refresh} />}
            {tab === 'timeline' && <TimelineTab id={id!} />}
            {tab === 'evc' && <EvcTab d={d} />}
            {tab === 'deficiencies' && <DeficienciesTab d={d} />}
            {tab === 'obligations' && <ObligationsTab d={d} />}
            {tab === 'history' && <HistoryTab d={d} />}
          </div>

          {dialog && <ReasonDialog title={dialog.label} required={dialog.requires_reason} danger={['reject', 'withdraw'].includes(dialog.action)} submitLabel={dialog.label}
            label={dialog.action === 'resubmit' ? 'Your response to the clarification request' : dialog.action === 'return' ? 'What does the institution need to clarify or correct?' : dialog.requires_reason ? 'Reason' : 'Note (optional)'}
            intro={<>This will move {a.ref} to <b>{dialog.to_stage_name}</b>. It is recorded in the application history and the audit trail.</>}
            onSubmit={async reason => { await api(`/applications/${id}/transitions`, { body: { action: dialog.action, reason: reason || undefined, row_version: d.row_version } }); toast.ok(`${dialog.label}: done`); refresh(); }}
            onClose={() => setDialog(null)} />}
          {upload && <UploadDialog applicationId={Number(id)} options={docOptions} defaultType={upload.defaultType} onClose={() => setUpload(null)} />}
          {summary !== null && (
            <Modal title="Application summary" onClose={() => setSummary(null)} footer={<><Button onClick={() => { navigator.clipboard?.writeText(summary); toast.ok('Copied'); }}>Copy</Button><Button variant="primary" onClick={() => setSummary(null)}>Close</Button></>}>
              <pre className="whitespace-pre-wrap rounded-md bg-paper p-3 text-[13px]">{summary}</pre></Modal>)}
        </>);
    }}</Query>);
}

const RISK: Record<string, { label: string; tone: any }> = { confirmed_overdue: { label: 'Past the deadline (confirmed)', tone: 'bad' }, likely_late: { label: 'Likely to be late (forecast)', tone: 'warn' }, watch: { label: 'Close to the deadline', tone: 'warn' }, on_track: { label: 'On track', tone: 'good' } };

function Overview({ d, inst, onChange }: { d: any; inst: boolean; onChange: () => void }) {
  const a = d.application; const toast = useToast(); const [text, setText] = useState(''); const [err, setErr] = useState<unknown>(null);
  const add = useMutation({ mutationFn: () => api(`/applications/${a.id}/observations`, { body: { text } }), onSuccess: () => { setText(''); toast.ok('Observation recorded'); onChange(); }, onError: setErr });
  const { user } = useAuth();
  const canObserve = !inst && d.stage && d.stage.responsible_role === user!.role && !['approved', 'rejected', 'withdrawn', 'draft'].includes(a.status);
  return (
    <div className="grid gap-4 lg:grid-cols-[1.2fr_1fr]">
      <div className="space-y-4">
        <Card title="Current stage">
          {a.status === 'draft' ? <p className="text-muted">This is a draft. Nothing is routed until you submit it.</p> : (
            <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
              <KV label="Stage">{d.stage?.name ?? pretty(a.status)}</KV>
              <KV label="Responsible">{d.stage ? pretty(d.stage.responsible_role) : '–'}{a.assigned_name ? `, ${a.assigned_name}` : ''}</KV>
              <KV label="Deadline">{fmtDate(a.stage_due_date)}</KV>
              <div><dt className="text-[13px] text-muted">Time in stage</dt><dd><DeadlineMeter daysInStage={a.days_in_stage} daysToDue={a.days_to_due} status={a.due_status} due={a.stage_due_date} /></dd></div>
              <KV label="Total age">{a.age_days} days</KV>
              <KV label="Workflow">{d.workflow ? `${d.workflow.name}, version ${d.workflow.version}` : '–'}</KV>
              <KV label="Submitted">{fmtDateTime(a.submitted_at)}</KV>
              <KV label="Category">{a.category_name}</KV>
            </dl>)}
          {a.summary && <p className="mt-4 rounded-md bg-paper p-3 text-[13px]">{a.summary}</p>}
        </Card>
        {d.deadline_risk && (
          <Card title="Deadline risk" actions={<Badge tone={RISK[d.deadline_risk.risk].tone}>{RISK[d.deadline_risk.risk].label}</Badge>}>
            <p className="mb-2 text-[13px] text-muted">{d.deadline_risk.risk === 'confirmed_overdue' ? 'This is a recorded fact: the deadline has passed.' : 'This is an estimate from the case\'s own dates and past stage durations, not a confirmed status.'} Confidence: {d.deadline_risk.confidence}.</p>
            <ul className="list-disc space-y-0.5 pl-5">{d.deadline_risk.factors.map((f: string, i: number) => <li key={i}>{f}</li>)}</ul>
          </Card>)}
        {!inst && (
          <Card title="Observations">
            {canObserve && (
              <form className="mb-4 space-y-2" onSubmit={e => { e.preventDefault(); setErr(null); add.mutate(); }}>
                <Textarea aria-label="New observation" placeholder="Record what you found when reviewing this stage" value={text} onChange={e => setText(e.target.value)} />
                {!!err && <ErrorBox error={err} />}
                <Button type="submit" variant="primary" busy={add.isPending} disabled={text.trim().length < 3}>Add observation</Button>
              </form>)}
            {d.observations.length === 0 ? <p className="text-muted">No observations recorded yet.</p> : (
              <ul className="space-y-3">{d.observations.map((o: any) => <li key={o.id} className="border-l-2 border-teal pl-3"><p>{o.text}</p><p className="text-[13px] text-muted">{o.author_name}, {pretty(o.stage_key)}, {fmtDateTime(o.at)}</p></li>)}</ul>)}
          </Card>)}
      </div>
      <div className="space-y-4">
        <Card title="Required documents" pad={false}>
          {d.required_documents.length === 0 ? <Empty title="No documents are required for this category" /> : (
            <ul>{d.required_documents.map((r: any) => (
              <li key={r.doc_type} className="flex items-center justify-between gap-2 border-b border-line/70 px-4 py-2.5 last:border-0">
                <span className="flex items-start gap-2">{r.uploaded ? <CheckCircle2 className="mt-1 h-4 w-4 shrink-0 text-good" aria-hidden /> : <XCircle className="mt-1 h-4 w-4 shrink-0 text-bad" aria-hidden />}<DocLabel name={r.display_name} code={r.document_id ? `DOC-${String(r.document_id).padStart(4, '0')}` : null} /></span>
                <span className="text-[13px]">{r.uploaded ? <Badge tone={toneFor(r.verification_status)}>{pretty(r.verification_status)}</Badge> : <span className="text-bad">Missing</span>}</span>
              </li>))}</ul>)}
        </Card>
        <Card title="Open tasks" pad={false}>
          {d.tasks.filter((t: any) => t.status === 'open').length === 0 ? <Empty title="No open tasks" /> : (
            <ul>{d.tasks.filter((t: any) => t.status === 'open').map((t: any) => <li key={t.id} className="border-b border-line/70 px-4 py-2.5 last:border-0"><p className="font-medium">{t.title}</p><p className="text-[13px] text-muted">{pretty(t.role)}{t.assigned_name ? `, ${t.assigned_name}` : ''}{t.due_date ? `, due ${fmtDate(t.due_date)}` : ''}</p></li>)}</ul>)}
        </Card>
      </div>
    </div>);
}

function DocumentsTab({ d, editable, inst, onUpload, onChange }: { d: any; editable: boolean; inst: boolean; onUpload: (t?: string) => void; onChange: () => void }) {
  const toast = useToast(); const [ret, setRet] = useState<any>(null); const { user } = useAuth();
  const officer = ['regional_officer', 'bureau_officer'].includes(user!.role);
  const verify = async (doc: any, decision: string, note?: string) => { await api(`/documents/${doc.id}/verify`, { body: { decision, note } }); toast.ok(decision === 'verified' ? 'Document verified' : 'Document returned'); onChange(); };
  return (
    <Card title="Documents" pad={false} actions={editable ? <Button variant="primary" size="sm" onClick={() => onUpload()}><FileUp className="h-4 w-4" aria-hidden />Upload document</Button> : undefined}>
      {d.documents.length === 0 ? <Empty title="No documents uploaded yet" hint={editable ? 'Upload each required document, then submit the application.' : undefined} action={editable ? <Button variant="primary" onClick={() => onUpload()}>Upload document</Button> : undefined} /> : (
        <Table><thead><tr><Th>Document</Th><Th>Version</Th><Th>Expiry</Th><Th>Verification</Th><Th>Uploaded</Th><Th><span className="sr-only">Actions</span></Th></tr></thead>
          <tbody>{d.documents.map((x: any) => (
            <tr key={x.id} className={x.is_current ? '' : 'text-muted'}>
              <Td><DocLabel name={x.display_name} code={x.doc_code} reference={x.reference_no} file={x.file_name} /></Td>
              <Td>v{x.version} {x.is_current ? <Badge tone="teal">Current</Badge> : <Badge>Earlier</Badge>}</Td>
              <Td>{x.expiry_date ? fmtDate(x.expiry_date) : 'No expiry'}</Td>
              <Td><Badge tone={toneFor(x.verification_status)}>{pretty(x.verification_status)}</Badge>{x.verification_note && <p className="mt-0.5 max-w-[220px] text-[13px]">{x.verification_note}</p>}</Td>
              <Td>{fmtDate(x.uploaded_at)}</Td>
              <Td className="whitespace-nowrap">
                <Button size="sm" variant="ghost" aria-label={`Download ${x.file_name}`} onClick={() => download(`/documents/${x.id}/download`, x.file_name).catch(e => toast.err(e.message))}><Download className="h-4 w-4" /></Button>
                {editable && x.is_current && <Button size="sm" variant="ghost" onClick={() => onUpload(x.doc_type)}>Replace</Button>}
                {officer && x.is_current && x.verification_status === 'pending' && <><Button size="sm" variant="ghost" onClick={() => verify(x, 'verified').catch(e => toast.err(e.message))}>Verify</Button><Button size="sm" variant="ghost" onClick={() => setRet(x)}>Return</Button></>}
              </Td>
            </tr>))}</tbody></Table>)}
      {ret && <ReasonDialog title={`Return ${ret.display_name}`} required label="What needs to be corrected?" submitLabel="Return document" onSubmit={r => verify(ret, 'returned', r)} onClose={() => setRet(null)} />}
      {inst && !editable && d.documents.length > 0 && <p className="border-t border-line px-4 py-2.5 text-[13px] text-muted">Documents can be changed while the application is a draft or has been returned to you.</p>}
    </Card>);
}

function TimelineTab({ id }: { id: string }) {
  const q = useQuery({ queryKey: ['timeline', id], queryFn: () => api<any[]>(`/applications/${id}/timeline`) });
  return (
    <Card title="Everything that has happened, in order">
      <Query q={q}>{(rows: any[]) => rows.length === 0 ? <Empty title="Nothing recorded yet" /> : (
        <ol className="relative ml-2 space-y-4 border-l border-line pl-6">
          {rows.map((e, i) => { const Icon = KIND_ICON[e.kind] ?? GitCommitHorizontal; return (
            <li key={i} className="relative">
              <span className="absolute -left-[37px] flex h-6 w-6 items-center justify-center rounded-full border border-line bg-white"><Icon className={`h-3.5 w-3.5 ${e.kind === 'escalation' ? 'text-bad' : e.kind === 'reminder' ? 'text-warn' : 'text-brand'}`} aria-hidden /></span>
              <p className="font-medium capitalize-first">{e.title}</p>
              {e.detail && <p className="text-muted">{e.detail}</p>}
              <p className="text-[13px] text-muted">{fmtDateTime(e.at)}{e.actor ? `, ${e.actor}` : ''}</p>
            </li>); })}</ol>)}</Query>
    </Card>);
}

function EvcTab({ d }: { d: any }) {
  return (
    <Card title="Expert Visit Committee" pad={false}>
      <Table><thead><tr><Th>State</Th><Th>Schedule by</Th><Th>Visit date</Th><Th>Committee</Th><Th>Completion deadline</Th><Th>Notes</Th></tr></thead>
        <tbody>{d.evc.map((e: any) => (
          <tr key={e.id}><Td><Badge tone={toneFor(e.state)}>{pretty(e.state)}</Badge>{e.reason && <p className="text-[13px] text-bad">{e.reason}</p>}{e.reschedule_count > 0 && <p className="text-[13px] text-muted">Rescheduled {e.reschedule_count}×</p>}</Td>
            <Td>{fmtDate(e.schedule_deadline)}</Td><Td>{fmtDate(e.visit_date ?? e.confirmed_date)}</Td><Td>{e.committee_name ?? '–'}</Td><Td>{fmtDate(e.completion_deadline)}</Td><Td className="max-w-[260px]">{e.visit_notes ?? '–'}</Td></tr>))}</tbody></Table>
    </Card>);
}

function ObligationsTab({ d }: { d: any }) {
  return (
    <Card title="Obligations created from this approval" pad={false}>
      <Table><thead><tr><Th>Obligation</Th><Th>Due</Th><Th>Status</Th></tr></thead>
        <tbody>{d.undertakings.map((u: any) => <tr key={u.id}><Td><Link className="text-brand hover:underline" to="/compliance">{u.code}</Link><p>{u.condition_text}</p></Td><Td>{fmtDate(u.due_date)}</Td><Td><Badge tone={toneFor(u.effective_status)}>{pretty(u.effective_status)}</Badge></Td></tr>)}</tbody></Table>
    </Card>);
}

function HistoryTab({ d }: { d: any }) {
  return (
    <div className="grid gap-4 lg:grid-cols-[1.6fr_1fr]">
      <Card title="Stage history" pad={false}>
        <Table><thead><tr><Th>When</Th><Th>Change</Th><Th>By</Th><Th>Reason</Th></tr></thead>
          <tbody>{d.history.map((h: any) => (
            <tr key={h.id}><Td className="whitespace-nowrap">{fmtDateTime(h.at)}</Td><Td>{h.from_stage ? `${pretty(h.from_stage)} to ${pretty(h.to_stage)}` : `Submitted to ${pretty(h.to_stage)}`}<p className="text-[13px] text-muted">{pretty(h.action)}{h.auto ? ' (automatic)' : ''}</p></Td><Td>{h.actor_label}</Td><Td className="max-w-[240px]">{h.reason ?? '–'}</Td></tr>))}</tbody></Table>
      </Card>
      <Card title="Submissions" pad={false}>
        {d.submissions.length === 0 ? <Empty title="Not submitted yet" /> : <ul>{d.submissions.map((s: any) => <li key={s.id} className="border-b border-line/70 px-4 py-2.5 last:border-0"><p className="font-medium">Version {s.version}, {s.kind === 'initial' ? 'initial submission' : 'resubmission'}</p><p className="text-[13px] text-muted">{fmtDateTime(s.submitted_at)}</p>{s.note && <p className="mt-1">{s.note}</p>}{s.documents?.length > 0 && <ul className="mt-1 list-disc pl-4 text-[13px]">{s.documents.map((x: any) => <li key={x.id}>{x.display_name} <span className="text-muted">({x.doc_code}, v{x.version})</span></li>)}</ul>}</li>)}</ul>}
      </Card>
    </div>);
}

const DEF_TONE: Record<string, any> = { open: 'warn', responded: 'brand', closed: 'good' };
function DeficienciesTab({ d }: { d: any }) {
  return (
    <Card title="Deficiencies and corrective actions" pad={false}>
      <p className="border-b border-line px-4 py-2.5 text-[13px] text-muted">A deficiency is raised when the application is returned. The institution's response is recorded as the corrective action, and the reviewing officer closes it when accepted.</p>
      <Table><thead><tr><Th>Deficiency</Th><Th>Raised</Th><Th>Due</Th><Th>Status</Th><Th>Corrective action</Th></tr></thead>
        <tbody>{d.deficiencies.map((x: any) => (
          <tr key={x.id}><Td className="max-w-[300px]"><Badge>{pretty(x.category)}</Badge><p className="mt-1">{x.description}</p><p className="text-[13px] text-muted">At {pretty(x.stage_key)}{x.rule_code ? `, rule ${x.rule_code}` : ''}</p></Td>
            <Td>{fmtDate(x.raised_at.slice(0, 10))}<p className="text-[13px] text-muted">{x.raised_by_name}</p></Td><Td>{fmtDate(x.due_date)}</Td><Td><Badge tone={DEF_TONE[x.status]}>{pretty(x.status)}</Badge>{x.closed_at && <p className="text-[13px] text-muted">{fmtDate(x.closed_at.slice(0, 10))}</p>}</Td>
            <Td className="max-w-[300px]">{x.corrective_action ?? <span className="text-muted">Awaiting the institution's response</span>}{x.responded_at && <p className="text-[13px] text-muted">{fmtDate(x.responded_at.slice(0, 10))}</p>}</Td></tr>))}</tbody></Table>
    </Card>);
}
