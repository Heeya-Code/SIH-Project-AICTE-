import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Plus } from 'lucide-react';
import { api, errMsg, qstr } from '../lib/api';
import { useLookupMaps } from '../lib/hooks';
import { fmtDate, fmtDateTime, pretty, ROLE_LABEL, toneFor } from '../lib/format';
import { Badge, Button, Card, ErrorBox, Field, Input, Modal, PageHeader, Pager, Query, Select, Table, Tabs, Td, Th, useToast } from '../components/ui';
import { ReasonDialog } from '../components/ReasonDialog';

const userSchema = z.object({ email: z.string().email('Enter a valid email'), name: z.string().trim().min(2, 'Enter a name'), role: z.string().min(1, 'Choose a role'), region_id: z.string().optional(), institution_id: z.string().optional(), password: z.string().min(10, 'Use at least 10 characters') });

function UserDialog({ onClose }: { onClose: () => void }) {
  const lk = useLookupMaps(); const qc = useQueryClient(); const toast = useToast(); const [err, setErr] = useState<unknown>(null); const [busy, setBusy] = useState(false);
  const { register, handleSubmit, watch, formState: { errors } } = useForm<z.infer<typeof userSchema>>({ resolver: zodResolver(userSchema) });
  const role = watch('role');
  const go = handleSubmit(async v => { setBusy(true); setErr(null); try { await api('/users', { body: { ...v, region_id: v.region_id ? Number(v.region_id) : null, institution_id: v.institution_id ? Number(v.institution_id) : null } }); toast.ok('User created'); qc.invalidateQueries({ queryKey: ['users'] }); onClose(); } catch (e) { setErr(e); } finally { setBusy(false); } });
  return (
    <Modal title="Add a user" onClose={onClose} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" busy={busy} onClick={go}>Create user</Button></>}>
      <form onSubmit={go} className="space-y-4" noValidate>
        <Field label="Name" required error={errors.name?.message}>{(id, d) => <Input id={id} aria-describedby={d} {...register('name')} />}</Field>
        <Field label="Email" required error={errors.email?.message}>{(id, d) => <Input id={id} aria-describedby={d} type="email" {...register('email')} />}</Field>
        <Field label="Role" required error={errors.role?.message}>{(id, d) => <Select id={id} aria-describedby={d} {...register('role')}><option value="">Choose…</option>{Object.entries(ROLE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>}</Field>
        {['regional_officer', 'evc_coordinator'].includes(role) && <Field label="Region" required>{id => <Select id={id} {...register('region_id')}><option value="">Choose…</option>{lk.regions.map((r: any) => <option key={r.id} value={r.id}>{r.name}</option>)}</Select>}</Field>}
        {role === 'institution' && <Field label="Institution" required>{id => <Select id={id} {...register('institution_id')}><option value="">Choose…</option>{lk.institutions.map((r: any) => <option key={r.id} value={r.id}>{r.name}</option>)}</Select>}</Field>}
        <Field label="Initial password" required error={errors.password?.message}>{(id, d) => <Input id={id} aria-describedby={d} type="password" autoComplete="new-password" {...register('password')} />}</Field>
        {!!err && <ErrorBox error={err} />}
      </form>
    </Modal>);
}

function Users() {
  const qc = useQueryClient(); const toast = useToast(); const [page, setPage] = useState(1); const [role, setRole] = useState(''); const [adding, setAdding] = useState(false);
  const q = useQuery({ queryKey: ['users', page, role], queryFn: () => api<any>(`/users${qstr({ page, pageSize: 12, role })}`), placeholderData: p => p });
  const patch = async (id: number, body: any) => { try { await api(`/users/${id}`, { method: 'PATCH', body }); toast.ok('Saved'); qc.invalidateQueries({ queryKey: ['users'] }); } catch (e) { toast.err(errMsg(e)); } };
  return (
    <Card pad={false} title="Users" actions={<Button variant="primary" size="sm" onClick={() => setAdding(true)}><Plus className="h-4 w-4" aria-hidden />Add user</Button>}>
      <div className="border-b border-line p-4"><div className="w-60"><Field label="Role">{id => <Select id={id} value={role} onChange={e => { setRole(e.target.value); setPage(1); }}><option value="">All</option>{Object.entries(ROLE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>}</Field></div></div>
      <Query q={q}>{(d: any) => (
        <><Table><thead><tr><Th>Name</Th><Th>Role</Th><Th>Scope</Th><Th>Status</Th><Th><span className="sr-only">Actions</span></Th></tr></thead>
          <tbody>{d.rows.map((u: any) => (
            <tr key={u.id}><Td>{u.name}<p className="text-[13px] text-muted">{u.email}</p></Td>
              <Td><Select aria-label={`Role for ${u.name}`} value={u.role} onChange={e => { if (confirm(`Change ${u.name} to ${ROLE_LABEL[e.target.value]}? This is recorded in the audit trail.`)) patch(u.id, { role: e.target.value, ...(['regional_officer', 'evc_coordinator'].includes(e.target.value) && !u.region_id ? { region_id: 1 } : {}) }); }}>{Object.entries(ROLE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Td>
              <Td>{u.institution_name ?? u.region_name ?? 'National'}</Td><Td><Badge tone={u.active ? 'good' : 'neutral'}>{u.active ? 'Active' : 'Deactivated'}</Badge></Td>
              <Td><Button size="sm" onClick={() => patch(u.id, { active: !u.active })}>{u.active ? 'Deactivate' : 'Reactivate'}</Button></Td></tr>))}</tbody></Table>
          <Pager page={d.page} pages={d.pages} total={d.total} onPage={setPage} /></>)}</Query>
      {adding && <UserDialog onClose={() => setAdding(false)} />}
    </Card>);
}

function Settings() {
  const qc = useQueryClient(); const toast = useToast(); const q = useQuery({ queryKey: ['settings'], queryFn: () => api<any[]>('/admin/settings') });
  const [edit, setEdit] = useState<Record<string, string>>({});
  const save = async (k: string) => { try { await api(`/admin/settings/${k}`, { method: 'PUT', body: { value: edit[k] } }); toast.ok('Setting saved'); setEdit(({ [k]: _, ...r }) => r); qc.invalidateQueries({ queryKey: ['settings'] }); } catch (e) { toast.err(errMsg(e)); } };
  return (
    <Card title="Deadline and reminder policy" pad={false}>
      <p className="border-b border-line bg-warn-soft px-4 py-2.5 text-warn">Demonstration values only. They are not AICTE rules. Set them from the applicable Approval Process Handbook.</p>
      <Query q={q}>{(rows: any[]) => <ul>{rows.filter(r => !r.key.startsWith('sim_')).map(r => (
        <li key={r.key} className="grid gap-2 border-b border-line/70 px-4 py-3 sm:grid-cols-[1fr_200px_auto] sm:items-center"><div><p className="font-medium">{r.key}</p><p className="text-[13px] text-muted">{r.description}</p></div>
          <Input aria-label={r.key} value={edit[r.key] ?? r.value} onChange={e => setEdit(x => ({ ...x, [r.key]: e.target.value }))} /><Button size="sm" disabled={edit[r.key] === undefined || edit[r.key] === r.value} onClick={() => save(r.key)}>Save</Button></li>))}</ul>}</Query>
    </Card>);
}

const ruleSchema = z.object({ name: z.string().trim().min(3), trigger_type: z.string(), applies_to_role: z.string().optional(), level: z.coerce.number().int().min(1).max(5), after_days: z.coerce.number().int().min(0).max(365), recipient_role: z.string(),
  repeat_every_days: z.string().optional(), max_repeats: z.coerce.number().int().min(0).max(10), active: z.boolean() });
function RuleDialog({ rule, onClose }: { rule: any | null; onClose: () => void }) {
  const qc = useQueryClient(); const toast = useToast(); const [err, setErr] = useState<unknown>(null); const [busy, setBusy] = useState(false);
  const { register, handleSubmit, formState: { errors } } = useForm<any>({ resolver: zodResolver(ruleSchema), defaultValues: rule ? { ...rule, applies_to_role: rule.applies_to_role ?? '', repeat_every_days: rule.repeat_every_days ? String(rule.repeat_every_days) : '', active: !!rule.active } : { name: '', trigger_type: 'task_overdue', applies_to_role: '', level: 1, after_days: 1, recipient_role: 'bureau_officer', repeat_every_days: '', max_repeats: 0, active: true } });
  const go = handleSubmit(async (v: any) => { setBusy(true); setErr(null); try { const body = { ...v, applies_to_role: v.applies_to_role || null, repeat_every_days: v.repeat_every_days ? Number(v.repeat_every_days) : null }; if (rule) await api(`/admin/escalation-rules/${rule.id}`, { method: 'PUT', body }); else await api('/admin/escalation-rules', { body }); toast.ok('Rule saved'); qc.invalidateQueries({ queryKey: ['rules'] }); onClose(); } catch (e) { setErr(e); } finally { setBusy(false); } });
  return (
    <Modal title={rule ? 'Edit escalation rule' : 'New escalation rule'} onClose={onClose} wide footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" busy={busy} onClick={go}>Save rule</Button></>}>
      <form onSubmit={go} className="grid gap-4 sm:grid-cols-2" noValidate>
        <div className="sm:col-span-2"><Field label="Name" error={errors.name?.message as string}>{(id, d) => <Input id={id} aria-describedby={d} {...register('name')} />}</Field></div>
        <Field label="Trigger">{id => <Select id={id} {...register('trigger_type')}><option value="task_overdue">Stage task overdue</option><option value="evc_overdue">EVC delayed</option><option value="undertaking_overdue">Obligation overdue</option><option value="document_expired">Document expired, not renewed</option></Select>}</Field>
        <Field label="Only for tasks owned by" hint="Applies to stage tasks only">{id => <Select id={id} {...register('applies_to_role')}><option value="">Any</option>{['institution', 'regional_officer', 'bureau_officer', 'competent_authority'].map(r => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}</Select>}</Field>
        <Field label="Level">{id => <Input id={id} type="number" min={1} max={5} {...register('level')} />}</Field>
        <Field label="Escalate after (days overdue)" error={errors.after_days?.message as string}>{id => <Input id={id} type="number" min={0} {...register('after_days')} />}</Field>
        <Field label="Escalate to" hint="Always limited to the entity's Region for regional roles">{id => <Select id={id} {...register('recipient_role')}>{['regional_officer', 'bureau_officer', 'competent_authority', 'evc_coordinator'].map(r => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}</Select>}</Field>
        <Field label="Repeat every (days)" hint="Leave empty for no repeat">{id => <Input id={id} type="number" min={1} {...register('repeat_every_days')} />}</Field>
        <Field label="Maximum repeats" hint="Required when repeating">{id => <Input id={id} type="number" min={0} max={10} {...register('max_repeats')} />}</Field>
        <label className="flex items-center gap-2 self-end"><input type="checkbox" {...register('active')} />Rule is active</label>
      </form>
      {!!err && <ErrorBox error={err} />}
    </Modal>);
}

function Rules() {
  const q = useQuery({ queryKey: ['rules'], queryFn: () => api<any[]>('/admin/escalation-rules') }); const [edit, setEdit] = useState<any | 'new' | null>(null);
  return (
    <Card title="Escalation rules" pad={false} actions={<Button size="sm" variant="primary" onClick={() => setEdit('new')}><Plus className="h-4 w-4" aria-hidden />New rule</Button>}>
      <Query q={q}>{(rows: any[]) => <Table><thead><tr><Th>Rule</Th><Th>Trigger</Th><Th>After</Th><Th>Escalates to</Th><Th>Repeat</Th><Th>State</Th><Th><span className="sr-only">Edit</span></Th></tr></thead>
        <tbody>{rows.map(r => <tr key={r.id}><Td>{r.name}<p className="text-[13px] text-muted">Level {r.level}{r.applies_to_role ? `, ${pretty(r.applies_to_role)} tasks` : ''}</p></Td><Td>{pretty(r.trigger_type)}</Td><Td>{r.after_days} day(s)</Td><Td>{ROLE_LABEL[r.recipient_role]}</Td>
          <Td>{r.repeat_every_days ? `Every ${r.repeat_every_days}d, up to ${r.max_repeats}×` : 'No'}</Td><Td><Badge tone={r.active ? 'good' : 'neutral'}>{r.active ? 'Active' : 'Off'}</Badge></Td><Td><Button size="sm" onClick={() => setEdit(r)}>Edit</Button></Td></tr>)}</tbody></Table>}</Query>
      {edit && <RuleDialog rule={edit === 'new' ? null : edit} onClose={() => setEdit(null)} />}
    </Card>);
}

function Templates() {
  const qc = useQueryClient(); const toast = useToast(); const q = useQuery({ queryKey: ['templates'], queryFn: () => api<any[]>('/admin/templates') }); const [t, setT] = useState<any>(null); const [err, setErr] = useState<unknown>(null);
  return (
    <Card title="Notification templates" pad={false}>
      <p className="border-b border-line px-4 py-2.5 text-muted">Use placeholders in braces, for example {'{ref}'}, {'{due}'}, {'{days}'}.</p>
      <Query q={q}>{(rows: any[]) => <Table><thead><tr><Th>Event</Th><Th>Title</Th><Th>Body</Th><Th><span className="sr-only">Edit</span></Th></tr></thead><tbody>{rows.map(r => <tr key={r.event}><Td className="font-medium">{r.event}</Td><Td>{r.title_tpl}</Td><Td className="max-w-[320px] text-[13px]">{r.body_tpl}</Td><Td><Button size="sm" onClick={() => { setT({ ...r }); setErr(null); }}>Edit</Button></Td></tr>)}</tbody></Table>}</Query>
      {t && <Modal title={`Edit template: ${t.event}`} onClose={() => setT(null)} footer={<><Button onClick={() => setT(null)}>Cancel</Button><Button variant="primary" onClick={async () => { try { await api(`/admin/templates/${t.event}`, { method: 'PUT', body: { title_tpl: t.title_tpl, body_tpl: t.body_tpl } }); toast.ok('Template saved'); qc.invalidateQueries({ queryKey: ['templates'] }); setT(null); } catch (e) { setErr(e); } }}>Save</Button></>}>
        <Field label="Title">{id => <Input id={id} value={t.title_tpl} onChange={e => setT({ ...t, title_tpl: e.target.value })} />}</Field>
        <Field label="Body">{id => <Input id={id} value={t.body_tpl} onChange={e => setT({ ...t, body_tpl: e.target.value })} />}</Field>{!!err && <ErrorBox error={err} />}</Modal>}
    </Card>);
}

function System() {
  const qc = useQueryClient(); const toast = useToast(); const sys = useQuery({ queryKey: ['system'], queryFn: () => api<any>('/admin/system') }); const jobs = useQuery({ queryKey: ['jobs'], queryFn: () => api<any[]>('/admin/jobs') });
  const [date, setDate] = useState(''); const [reset, setReset] = useState(false); const [busy, setBusy] = useState('');
  const refresh = () => { qc.invalidateQueries(); };
  const run = async (name: string, fn: () => Promise<any>, ok: string) => { setBusy(name); try { await fn(); toast.ok(ok); refresh(); } catch (e) { toast.err(errMsg(e)); } finally { setBusy(''); } };
  return (
    <div className="space-y-4">
      <Query q={sys}>{(s: any) => (
        <Card title="System status"><dl className="grid gap-3 sm:grid-cols-3">
          <div><dt className="text-muted">Environment</dt><dd className="font-medium">{s.environment}, Node {s.node}</dd></div><div><dt className="text-muted">Scheduler</dt><dd className="font-medium">Every {s.scheduler_interval_seconds}s, server-side</dd></div>
          <div><dt className="text-muted">Email</dt><dd className="font-medium">{s.email_adapter}</dd></div><div><dt className="text-muted">Audit chain</dt><dd className="font-medium">{s.audit_chain.ok ? `Intact (${s.audit_chain.checked} events)` : `Broken at ${s.audit_chain.brokenAtId}`}</dd></div>
          <div><dt className="text-muted">Records</dt><dd className="font-medium">{Object.entries(s.counts).map(([k, v]) => `${v} ${k.replace('_', ' ')}`).join(', ')}</dd></div><div><dt className="text-muted">Migrations</dt><dd className="font-medium">{s.migrations.length} applied</dd></div></dl></Card>)}</Query>
      <Card title="Background jobs" actions={<Button variant="primary" size="sm" busy={busy === 'run'} onClick={() => run('run', () => api('/admin/jobs/run', { body: {} }), 'Jobs ran')}>Run now</Button>} pad={false}>
        <Query q={jobs}>{(rows: any[]) => <Table><thead><tr><Th>Started</Th><Th>Trigger</Th><Th>Status</Th><Th>Result</Th></tr></thead><tbody>{rows.slice(0, 8).map(j => <tr key={j.id}><Td>{fmtDateTime(j.started_at)}</Td><Td>{j.trigger}{j.sim_date ? ` (simulated ${j.sim_date})` : ''}</Td><Td><Badge tone={j.status === 'ok' ? 'good' : toneFor('failed')}>{j.status}</Badge></Td><Td className="max-w-[360px] break-all text-[13px] text-muted">{j.error ?? (j.summary ?? '').slice(0, 140)}</Td></tr>)}</tbody></Table>}</Query>
      </Card>
      <Card title="Demo tools">
        <p className="mb-3 text-muted">Move the clock to see reminders, overdue status and escalations appear, then run the jobs. Available only while demo tools are enabled.</p>
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Simulated date">{id => <Input id={id} type="date" value={date} onChange={e => setDate(e.target.value)} />}</Field>
          <Button disabled={!date} onClick={() => run('set', () => api('/admin/clock', { body: { date } }), `Clock set to ${fmtDate(date)}`)}>Set date</Button>
          <Button onClick={() => run('adv', () => api('/admin/clock', { body: { advance_days: 7 } }), 'Moved forward 7 days')}>Advance 7 days</Button>
          <Button onClick={() => run('real', () => api('/admin/clock', { body: { date: null } }), 'Using real time')}>Use real time</Button>
          <Button variant="danger" onClick={() => setReset(true)}>Reset demo data</Button>
        </div>
      </Card>
      {reset && <ReasonDialog title="Reset demo data" danger submitLabel="Wipe and re-seed" required label='Type RESET to confirm' intro="This deletes every record, including the audit trail, and recreates the synthetic data." onSubmit={async r => { if (r !== 'RESET') throw new Error('Type RESET exactly to confirm'); await api('/admin/demo/reset', { body: { confirm: 'RESET' } }); toast.ok('Demo data reset. Please sign in again.'); setTimeout(() => location.reload(), 800); }} onClose={() => setReset(false)} />}
    </div>);
}

function DocumentRequirements() {
  const qc = useQueryClient(); const toast = useToast(); const q = useQuery({ queryKey: ['doc-requirements'], queryFn: () => api<any[]>('/admin/document-requirements') });
  const [edit, setEdit] = useState<Record<number, { reminder_days: string; auto_renewal: boolean }>>({});
  const save = async (row: any) => {
    const st = edit[row.id] || { reminder_days: row.reminder_days ?? '', auto_renewal: !!row.auto_renewal };
    try {
      await api(`/admin/document-requirements/${row.id}`, { method: 'PUT', body: { reminder_days: st.reminder_days, auto_renewal: st.auto_renewal } });
      toast.ok('Document requirement saved');
      setEdit(({ [row.id]: _, ...r }) => r);
      qc.invalidateQueries({ queryKey: ['doc-requirements'] });
    } catch (e) { toast.err(errMsg(e)); }
  };
  return (
    <Card title="Document reminder schedules & auto-renewal" pad={false}>
      <p className="border-b border-line bg-warn-soft px-4 py-2.5 text-warn">Configure per-document reminder schedules (JSON list of days) and whether an automatic renewal task is created when reminders fire.</p>
      <Query q={q}>{(rows: any[]) => <Table>
        <thead><tr><Th>Category</Th><Th>Document type</Th><Th>Reminder days (JSON)</Th><Th>Auto-renewal task</Th><Th><span className="sr-only">Save</span></Th></tr></thead>
        <tbody>{rows.map(row => {
          const st = edit[row.id] || { reminder_days: row.reminder_days ?? '', auto_renewal: !!row.auto_renewal };
          const changed = st.reminder_days !== (row.reminder_days ?? '') || st.auto_renewal !== !!row.auto_renewal;
          return (
            <tr key={row.id}>
              <Td><Badge tone="neutral">{row.category_code}</Badge></Td>
              <Td className="font-medium">{row.doc_type}</Td>
              <Td><Input aria-label={`Reminder days for ${row.doc_type}`} value={st.reminder_days} onChange={e => { const val = e.target.value; setEdit(x => ({ ...x, [row.id]: { ...st, reminder_days: val } })); }} placeholder="e.g. [180,90,30]" /></Td>
              <Td><label className="flex items-center gap-2"><input type="checkbox" checked={st.auto_renewal} onChange={e => { const checked = e.target.checked; setEdit(x => ({ ...x, [row.id]: { ...st, auto_renewal: checked } })); }} />Enable</label></Td>
              <Td><Button size="sm" disabled={!changed} onClick={() => save(row)}>Save</Button></Td>
            </tr>
          );
        })}</tbody>
      </Table>}</Query>
    </Card>);
}

export default function Admin() {
  const [tab, setTab] = useState('users');
  return (
    <>
      <PageHeader title="Administration" subtitle="Users and roles, deadline policies, escalation rules, notification templates and system status. Every change here is audited." />
      <Tabs value={tab} onChange={setTab} tabs={[{ key: 'users', label: 'Users' }, { key: 'settings', label: 'Policies' }, { key: 'documents', label: 'Document requirements' }, { key: 'rules', label: 'Escalation rules' }, { key: 'templates', label: 'Templates' }, { key: 'system', label: 'Jobs and demo tools' }]} />
      <div className="mt-4">{tab === 'users' && <Users />}{tab === 'settings' && <Settings />}{tab === 'documents' && <DocumentRequirements />}{tab === 'rules' && <Rules />}{tab === 'templates' && <Templates />}{tab === 'system' && <System />}</div>
    </>);
}
