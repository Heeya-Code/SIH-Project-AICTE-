import { useCallback, useEffect, useMemo, useState } from 'react';
import { Background, Controls, Handle, MarkerType, Position, ReactFlow, addEdge, useEdgesState, useNodesState, type Connection, type Edge, type Node, type NodeProps } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, errMsg } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useLookups } from '../lib/hooks';
import { ROLE_LABEL } from '../lib/format';
import { Badge, Button, Card, ErrorBox, Field, Input, PageHeader, Query, Select, useToast, cx } from '../components/ui';

type Stage = any; type Trans = any;
const stageNode = (s: Stage, i: number): Node => ({ id: s.key, type: 'stage', position: { x: s.pos_x ?? (i % 4) * 230, y: s.pos_y ?? Math.floor(i / 4) * 150 }, data: { ...s } });
const transEdge = (t: Trans, i: number): Edge => ({
  id: `e${i}-${t.from_key}-${t.action}`, source: t.from_key, target: t.to_key, label: `${t.auto ? 'auto: ' : ''}${t.action}`, markerEnd: { type: MarkerType.ArrowClosed },
  style: { stroke: t.auto ? '#0f8b8d' : t.requires_reason ? '#a74b07' : '#1d5fa8', strokeDasharray: t.auto ? '5 4' : undefined }, labelStyle: { fontSize: 11 }, data: { ...t },
});

function StageNode({ data, selected }: NodeProps) {
  const d: any = data;
  return (
    <div className={cx('w-[190px] rounded-lg border-2 bg-white px-3 py-2 shadow-sm', selected ? 'border-brand' : d.is_terminal ? 'border-[#9fb3cc]' : 'border-line')}>
      <Handle type="target" position={Position.Left} />
      <p className="font-semibold leading-tight">{d.name}</p>
      <p className="text-[12px] text-muted">{ROLE_LABEL[d.responsible_role]}</p>
      <p className="mt-1 flex flex-wrap gap-1 text-[11px]">
        {d.is_initial ? <Badge tone="teal">Start</Badge> : null}{d.is_terminal ? <Badge tone={d.terminal_status === 'approved' ? 'good' : d.terminal_status === 'rejected' ? 'bad' : 'neutral'}>{d.terminal_status}</Badge> : null}
        {d.is_evc ? <Badge tone="brand">EVC</Badge> : null}{d.deadline_days != null && <Badge>{d.deadline_days}d {d.day_mode === 'working' ? 'working' : ''}</Badge>}
      </p>
      <Handle type="source" position={Position.Right} />
    </div>);
}
const nodeTypes = { stage: StageNode };

export default function WorkflowDesigner() {
  const { user } = useAuth(); const canEdit = user!.role === 'admin'; const toast = useToast(); const qc = useQueryClient();
  const lk = useLookups();
  const wfs = useQuery({ queryKey: ['workflows'], queryFn: () => api<any[]>('/workflows') });
  const [wfId, setWfId] = useState<number | null>(null); const [verId, setVerId] = useState<number | null>(null);
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]); const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [sel, setSel] = useState<{ kind: 'node' | 'edge'; id: string } | null>(null);
  const [report, setReport] = useState<any>(null); const [sim, setSim] = useState<any>(null); const [err, setErr] = useState<unknown>(null);
  const [activate, setActivate] = useState(true); const [note, setNote] = useState(''); const [busy, setBusy] = useState('');
  const wf = wfs.data?.find(w => w.id === wfId);
  useEffect(() => { if (wfs.data?.length && wfId === null) { setWfId(wfs.data[0].id); } }, [wfs.data, wfId]);
  useEffect(() => { if (wf && (verId === null || !wf.versions.some((v: any) => v.id === verId))) setVerId((wf.versions.find((v: any) => v.active) ?? wf.versions[0]).id); }, [wf, verId]);
  const ver = useQuery({ queryKey: ['wf-version', verId], enabled: verId !== null, queryFn: () => api<any>(`/workflows/versions/${verId}`) });
  useEffect(() => {
    if (!ver.data) return;
    setNodes(ver.data.definition.stages.map(stageNode)); setEdges(ver.data.definition.transitions.map(transEdge)); setSel(null); setReport(ver.data.validation); setSim(null); setErr(null);
  }, [ver.data, setNodes, setEdges]);

  const onConnect = useCallback((c: Connection) => {
    if (!canEdit) return;
    setEdges(es => { const n = es.filter(e => e.source === c.source).length + 1; const action = `action_${n}`; return addEdge(transEdge({ from_key: c.source, to_key: c.target, action, requires_reason: 0, auto: 0, allowed_role: null, prerequisites: [] }, es.length), es); });
  }, [canEdit, setEdges]);

  const definition = () => ({
    stages: nodes.map(n => ({ ...(n.data as any), pos_x: Math.round(n.position.x), pos_y: Math.round(n.position.y) })),
    transitions: edges.map(e => { const d: any = e.data; return { ...d, from_key: e.source, to_key: e.target }; }),
  });
  const updNode = (id: string, patch: any) => {
    setNodes(ns => ns.map(n => (n.id === id ? { ...n, id: patch.key ?? n.id, data: { ...n.data, ...patch } } : n)));
    if (patch.key && patch.key !== id) { setEdges(es => es.map(e => ({ ...e, source: e.source === id ? patch.key : e.source, target: e.target === id ? patch.key : e.target, data: { ...(e.data as any), from_key: e.source === id ? patch.key : (e.data as any).from_key, to_key: e.target === id ? patch.key : (e.data as any).to_key } }))); setSel({ kind: 'node', id: patch.key }); }
  };
  const updEdge = (id: string, patch: any) => setEdges(es => es.map(e => { if (e.id !== id) return e; const d = { ...(e.data as any), ...patch }; return { ...transEdge(d, 0), id: e.id, source: e.source, target: e.target, data: d }; }));
  const addStage = () => { let i = nodes.length + 1; while (nodes.some(n => n.id === `stage_${i}`)) i++; const s = { key: `stage_${i}`, name: `New stage ${i}`, responsible_role: 'regional_officer', deadline_days: 7, day_mode: 'calendar', is_initial: 0, is_terminal: 0, terminal_status: null, is_evc: 0, evc_schedule_days: null }; setNodes(ns => [...ns, { ...stageNode(s, ns.length), position: { x: 40 + ns.length * 20, y: 380 } }]); setSel({ kind: 'node', id: s.key }); };
  const remove = () => { if (!sel) return; if (sel.kind === 'node') { setNodes(ns => ns.filter(n => n.id !== sel.id)); setEdges(es => es.filter(e => e.source !== sel.id && e.target !== sel.id)); } else setEdges(es => es.filter(e => e.id !== sel.id)); setSel(null); };

  const guard = async (name: string, fn: () => Promise<void>) => { setBusy(name); setErr(null); try { await fn(); } catch (e) { setErr(e); } finally { setBusy(''); } };
  const validate = () => guard('v', async () => { setReport((await api('/workflows/validate', { body: { definition: definition() } }))); });
  const simulate = () => guard('s', async () => {
    const v = await api('/workflows/validate', { body: { definition: definition() } }); setReport(v);
    const path = v.paths?.[0]; if (!path) throw new Error('No complete route from the start stage to an outcome exists yet.');
    setSim(await api('/workflows/simulate', { body: { definition: definition(), steps: path.actions.map((a: string) => ({ action: a, after_days: 5 })) } }));
  });
  const save = () => guard('save', async () => {
    const r = await api<any>(`/workflows/${wfId}/versions`, { body: { definition: definition(), activate, note: note || undefined } });
    toast.ok(`Saved as version ${r.version}${activate ? ' and activated for new applications' : ''}. Existing applications stay on their version.`);
    await qc.invalidateQueries({ queryKey: ['workflows'] }); setVerId(r.id);
  });

  const selNode: any = sel?.kind === 'node' ? nodes.find(n => n.id === sel.id)?.data : null;
  const selEdge = sel?.kind === 'edge' ? edges.find(e => e.id === sel.id) : null; const ed: any = selEdge?.data;
  const roles = Object.entries(ROLE_LABEL).filter(([k]) => k !== 'admin');
  const isActive = wf?.versions.find((v: any) => v.id === verId)?.active;
  const usage = ver.data?.applications_using;
  const prereqs: any[] = lk.data?.prerequisites ?? [];

  return (
    <>
      <PageHeader title="Workflow designer" subtitle={canEdit ? 'Stages and transitions you save here become a new workflow version that drives real routing for new applications.' : 'Read-only view of the configured workflows. Only administrators can change them.'} />
      <Query q={wfs}>{() => (
        <div className="space-y-4">
          <Card><div className="flex flex-wrap items-end gap-3">
            <div className="w-64"><Field label="Workflow">{id => <Select id={id} value={wfId ?? ''} onChange={e => { setWfId(Number(e.target.value)); setVerId(null); }}>{wfs.data!.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}</Select>}</Field></div>
            <div className="w-56"><Field label="Version">{id => <Select id={id} value={verId ?? ''} onChange={e => setVerId(Number(e.target.value))}>{wf?.versions.map((v: any) => <option key={v.id} value={v.id}>v{v.version}{v.active ? ' (active)' : ''}, {v.applications} application(s)</option>)}</Select>}</Field></div>
            {wf && <p className="pb-2 text-muted">Used by: {wf.categories.map((c: any) => c.name).join(', ') || 'no category'}</p>}
            {isActive ? <Badge tone="good">Active version</Badge> : <Badge>Not active</Badge>}
          </div>
          {usage ? <p className="mt-2 text-[13px] text-muted">{usage} application(s) are running on this version. Saving creates a new version; those applications are not changed.</p> : null}</Card>

          <div className="grid gap-4 xl:grid-cols-[1fr_320px]">
            <div className="h-[520px] overflow-hidden rounded-lg border border-line bg-white" aria-label="Workflow graph">
              <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} onNodesChange={canEdit ? onNodesChange : undefined} onEdgesChange={canEdit ? onEdgesChange : undefined} onConnect={onConnect} nodesConnectable={canEdit} nodesDraggable={canEdit}
                onNodeClick={(_, n) => setSel({ kind: 'node', id: n.id })} onEdgeClick={(_, e) => setSel({ kind: 'edge', id: e.id })} onPaneClick={() => setSel(null)} fitView minZoom={0.3}>
                <Background gap={18} color="#e6ebf1" /><Controls showInteractive={false} /></ReactFlow>
            </div>
            <Card title={selNode ? 'Stage' : selEdge ? 'Transition' : 'Properties'}>
              {!sel && <p className="text-muted">Select a stage or a transition to see its properties.{canEdit && ' Drag from a stage’s right handle to another stage to add a transition.'}</p>}
              {selNode && (
                <fieldset disabled={!canEdit} className="space-y-3">
                  <Field label="Key" hint="Lowercase letters, digits, underscore">{id => <Input id={id} value={selNode.key} onChange={e => updNode(sel!.id, { key: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '') })} />}</Field>
                  <Field label="Name">{id => <Input id={id} value={selNode.name} onChange={e => updNode(sel!.id, { name: e.target.value })} />}</Field>
                  <Field label="Responsible role">{id => <Select id={id} value={selNode.responsible_role} onChange={e => updNode(sel!.id, { responsible_role: e.target.value })}>{roles.map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>}</Field>
                  <div className="grid grid-cols-2 gap-2">
                    <Field label="Deadline (days)">{id => <Input id={id} type="number" min={0} value={selNode.deadline_days ?? ''} onChange={e => updNode(sel!.id, { deadline_days: e.target.value === '' ? null : Number(e.target.value) })} />}</Field>
                    <Field label="Counted as">{id => <Select id={id} value={selNode.day_mode} onChange={e => updNode(sel!.id, { day_mode: e.target.value })}><option value="calendar">Calendar days</option><option value="working">Working days</option></Select>}</Field></div>
                  <label className="flex items-center gap-2"><input type="checkbox" checked={!!selNode.is_initial} onChange={e => { if (e.target.checked) setNodes(ns => ns.map(n => ({ ...n, data: { ...n.data, is_initial: n.id === sel!.id ? 1 : 0 } }))); else updNode(sel!.id, { is_initial: 0 }); }} />Start stage</label>
                  <label className="flex items-center gap-2"><input type="checkbox" checked={!!selNode.is_evc} onChange={e => updNode(sel!.id, { is_evc: e.target.checked ? 1 : 0 })} />Expert visit stage (joins the EVC queue)</label>
                  {!!selNode.is_evc && <Field label="Schedule within (days)">{id => <Input id={id} type="number" min={1} value={selNode.evc_schedule_days ?? ''} onChange={e => updNode(sel!.id, { evc_schedule_days: e.target.value === '' ? null : Number(e.target.value) })} />}</Field>}
                  <label className="flex items-center gap-2"><input type="checkbox" checked={!!selNode.is_terminal} onChange={e => updNode(sel!.id, { is_terminal: e.target.checked ? 1 : 0, terminal_status: e.target.checked ? selNode.terminal_status ?? 'approved' : null })} />Final outcome</label>
                  {!!selNode.is_terminal && <Field label="Outcome">{id => <Select id={id} value={selNode.terminal_status ?? 'approved'} onChange={e => updNode(sel!.id, { terminal_status: e.target.value })}><option value="approved">Approved</option><option value="rejected">Rejected</option><option value="withdrawn">Withdrawn</option></Select>}</Field>}
                </fieldset>)}
              {selEdge && ed && (
                <fieldset disabled={!canEdit} className="space-y-3">
                  <p className="text-[13px] text-muted">{selEdge.source} to {selEdge.target}</p>
                  <Field label="Action key">{id => <Input id={id} value={ed.action} onChange={e => updEdge(selEdge.id, { action: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '') })} />}</Field>
                  <Field label="Button label">{id => <Input id={id} value={ed.label ?? ''} onChange={e => updEdge(selEdge.id, { label: e.target.value })} />}</Field>
                  <Field label="Who can do it" hint="Empty means the stage’s responsible role">{id => <Select id={id} value={ed.allowed_role ?? ''} onChange={e => updEdge(selEdge.id, { allowed_role: e.target.value || null })}><option value="">Stage owner</option>{roles.map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>}</Field>
                  <label className="flex items-center gap-2"><input type="checkbox" checked={!!ed.requires_reason} onChange={e => updEdge(selEdge.id, { requires_reason: e.target.checked ? 1 : 0 })} />A reason is required</label>
                  <label className="flex items-center gap-2"><input type="checkbox" checked={!!ed.auto} onChange={e => updEdge(selEdge.id, { auto: e.target.checked ? 1 : 0 })} />Moves automatically when requirements are met</label>
                  <div><p className="mb-1 text-[13px] font-medium">Requirements before this can happen</p>{prereqs.map(p => (
                    <label key={p.key} className="flex items-start gap-2 text-[13px]"><input type="checkbox" className="mt-1" checked={ed.prerequisites.includes(p.key)} onChange={e => updEdge(selEdge.id, { prerequisites: e.target.checked ? [...ed.prerequisites, p.key] : ed.prerequisites.filter((x: string) => x !== p.key) })} />{p.label}</label>))}</div>
                </fieldset>)}
              {canEdit && sel && <Button variant="danger" size="sm" className="mt-4" onClick={remove}>Delete {sel.kind === 'node' ? 'stage' : 'transition'}</Button>}
            </Card>
          </div>

          <Card title="Check and save" actions={canEdit ? <Button size="sm" onClick={addStage}>Add stage</Button> : undefined}>
            <div className="flex flex-wrap items-end gap-3">
              <Button onClick={validate} busy={busy === 'v'}>Validate</Button>
              <Button onClick={simulate} busy={busy === 's'}>Simulate a path</Button>
              {canEdit && <><div className="w-64"><Field label="Note for this version">{id => <Input id={id} value={note} onChange={e => setNote(e.target.value)} maxLength={300} />}</Field></div>
                <label className="flex items-center gap-2 pb-2"><input type="checkbox" checked={activate} onChange={e => setActivate(e.target.checked)} />Activate for new applications</label>
                <Button variant="primary" busy={busy === 'save'} onClick={save}>Save as new version</Button></>}
            </div>
            {!!err && <div className="mt-3"><ErrorBox error={err} /></div>}
            {report && (
              <div className="mt-4 space-y-2">
                <p className={report.valid ? 'font-medium text-good' : 'font-medium text-bad'}>{report.valid ? 'This workflow is valid.' : 'This workflow has problems and cannot be saved.'}</p>
                {report.errors.length > 0 && <ul className="list-disc pl-5 text-bad">{report.errors.map((e: string, i: number) => <li key={i}>{e}</li>)}</ul>}
                {report.warnings.length > 0 && <ul className="list-disc pl-5 text-warn">{report.warnings.map((e: string, i: number) => <li key={i}>{e}</li>)}</ul>}
                {report.paths?.length > 0 && <details><summary className="cursor-pointer text-brand">{report.paths.length} route(s) from start to an outcome</summary><ul className="mt-1 text-[13px]">{report.paths.map((p: any, i: number) => <li key={i}>{p.stages.join(' → ')}</li>)}</ul></details>}
              </div>)}
            {sim && (
              <div className="mt-4"><p className="mb-1 font-medium">Simulation on synthetic data (nothing is saved)</p>
                {!sim.ok ? <ErrorBox error={new Error(sim.errors.join(' '))} /> : <ol className="space-y-1 text-[13px]">{sim.timeline.map((t: any) => <li key={t.step}><b>{t.stage_name}</b> from {t.entered}{t.due ? `, due ${t.due}` : ''}{t.reminders.length ? `; reminders ${t.reminders.join(', ')}` : ''}{t.escalations.length ? `; escalation L${t.escalations.map((e: any) => `${e.level} on ${e.on}`).join(', L')}` : ''}</li>)}</ol>}</div>)}
          </Card>
        </div>)}</Query>
      <span className="hidden">{errMsg(null)}</span>
    </>);
}
