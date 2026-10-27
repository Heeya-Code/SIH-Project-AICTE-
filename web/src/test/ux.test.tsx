import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes, useLocation } from 'react-router-dom';
import { renderApp, renderAuthed, mockApi } from './utils';
import { tokenStore } from '../lib/api';
import { Shell } from '../components/Shell';
import { AttentionPanel } from '../components/Attention';
import ApplicationDetail from '../pages/ApplicationDetail';
import { ApplicationList } from '../pages/Applications';
import { ConfirmDialog, Stepper, StatusBadge, Tip } from '../components/ui';

beforeEach(() => { vi.unstubAllGlobals(); localStorage.clear(); tokenStore.set('t'); });
const me = (role = 'regional_officer') => ({ id: 2, name: 'Neha Rawat', email: 'ro.nr@demo.local', role, role_label: role === 'institution' ? 'Institution representative' : 'Regional officer', region_id: 1, institution_id: role === 'institution' ? 1 : null, region_name: 'Northern Region', institution_name: role === 'institution' ? 'Aravalli Institute (Demo)' : null });
const shellRoutes = (role = 'regional_officer', extra: Record<string, any> = {}) => ({ '/api/auth/me': () => [200, { user: me(role) }], '/api/lookups': () => [200, { clock: { today: '2026-03-02', simulated: false }, regions: [], categories: [], stages: [], officers: [], doc_types: [] }], '/api/notifications/unread-count': () => [200, { unread: 2, pending_ack: 1 }], ...extra }) as any;
const Where = () => <p data-testid="where">{useLocation().pathname}{useLocation().search}</p>;
const withShell = (route = '/') => renderAuthed(<Routes><Route element={<Shell />}><Route path="*" element={<Where />} /></Route></Routes>, route);

describe('application shell', () => {
  it('groups navigation, shows breadcrumbs, sets a page title and keeps the sidebar and header separate', async () => {
    mockApi(shellRoutes()); withShell('/applications/new');
    const main = await screen.findByRole('navigation', { name: 'Main' });
    for (const g of ['Work', 'Compliance', 'Insights', 'Configure']) expect(within(main).getByText(g)).toBeInTheDocument();
    expect(within(main).getByRole('link', { name: /Document verification/ })).toBeInTheDocument(); expect(within(main).queryByRole('link', { name: /Administration/ })).not.toBeInTheDocument();
    const crumbs = screen.getByRole('navigation', { name: 'Breadcrumb' }); expect(within(crumbs).getByText('Applications')).toBeInTheDocument(); expect(within(crumbs).getByText('New application')).toHaveAttribute('aria-current', 'page');
    await waitFor(() => expect(document.title).toBe('New application · ApprovalFlow (demo)'));
    expect(screen.getByRole('banner')).toBeInTheDocument();
  });
  it('searches as a combobox, groups results, supports the keyboard, and shows recents and quick actions when empty', async () => {
    localStorage.setItem('af_recent_2', JSON.stringify([{ id: 9, ref: 'AF-2026-00009', title: 'Earlier case' }]));
    const calls = mockApi(shellRoutes('regional_officer', { '/api/search': () => [200, { applications: [{ id: 3, ref: 'AF-2026-00003', title: 'Extension', institution: 'Aravalli (Demo)', link: '/applications/3' }], documents: [{ id: 4, name: 'Lease Agreement', code: 'DOC-0004', institution: 'Aravalli (Demo)', application_ref: 'AF-2026-00003', link: '/applications/3' }], obligations: [] }] })); withShell('/');
    const box = (await screen.findAllByRole('combobox'))[0]; await userEvent.click(box);
    expect(await screen.findByText('AF-2026-00009')).toBeInTheDocument(); expect(screen.getByText('Document verification queue')).toBeInTheDocument();
    await userEvent.type(box, 'lease');
    expect(await screen.findByRole('option', { name: /Lease Agreement \(DOC-0004\)/ })).toBeInTheDocument(); expect(screen.getByRole('group', { name: 'Documents' })).toBeInTheDocument(); expect(calls.some(c => c.includes('/api/search?q=lease'))).toBe(true);
    await userEvent.keyboard('{ArrowDown}{Enter}'); await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/applications/3'));
  });
  it('says clearly when a search finds nothing', async () => {
    mockApi(shellRoutes('regional_officer', { '/api/search': () => [200, { applications: [], documents: [], obligations: [] }] })); withShell('/'); await userEvent.type((await screen.findAllByRole('combobox'))[0], 'zzzz');
    expect(await screen.findByText(/Nothing found for “zzzz”/)).toBeInTheDocument();
  });
  it('opens a notification centre grouped by urgency that marks an item read and goes to the record', async () => {
    const n = (id: number, urgency: string, title: string) => ({ id, urgency, title, related: 'AF-2026-00003', created_at: '2026-03-02T05:00:00Z', read_at: null, link: '/applications/3' });
    const calls = mockApi(shellRoutes('institution', { '/api/notifications/5/read': () => [200, { ok: true }], '/api/notifications': () => [200, { rows: [n(5, 'action', 'Action needed: respond'), n(6, 'urgent', 'Lease expired'), n(7, 'update', 'Application submitted')], total: 3, page: 1, pages: 1, pageSize: 12 }] })); withShell('/');
    await userEvent.click(await screen.findByRole('button', { name: 'Notifications, 2 unread' }));
    for (const g of ['Action needed', 'Urgent', 'Updates']) expect(await screen.findByRole('group', { name: g })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Action needed: respond/ }));
    await waitFor(() => expect(calls.some(c => c.startsWith('POST /api/notifications/5/read'))).toBe(true)); await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/applications/3'));
  });
  it('opens contextual help with the meaning of each status', async () => {
    mockApi(shellRoutes()); withShell('/'); await userEvent.click(await screen.findByRole('button', { name: 'Help' }));
    expect(await screen.findByText(/On this page: Dashboard/)).toBeInTheDocument(); expect(screen.getByText(/Nobody at AICTE can see it yet/)).toBeInTheDocument(); expect(screen.getByText(/Only authorised people can record statutory decisions/)).toBeInTheDocument();
  });
});

describe('priority list', () => {
  const a = { items: [{ key: 'k1', rank: 1, rank_label: 'Overdue', title: 'Respond to the request on AF-2026-00003', why: ['Your response was due 3 days ago (2026-03-09)', 'The officer asked: Lease unclear'], link: '/applications/3', action: 'Respond and resubmit', due: '2026-03-09' }, { key: 'k2', rank: 4, rank_label: 'Missing or unresolved', title: 'Finish your draft AF-2026-00005', why: ['Missing: Lease Agreement'], link: '/applications/5', action: 'Upload the missing documents' }], total: 2, ordering: 'Within a rank, cases assigned to you come first.', criteria: [{ rank: 1, label: 'Overdue', help: 'A deadline has already passed.' }, { rank: 2, label: 'Deadline approaching', help: 'x' }] };
  it('lists ranked items with the reason for each, flags the first step for an institution and explains the ordering', async () => {
    renderApp(<AttentionPanel a={a} role="institution" />);
    expect(screen.getByText('Your next step')).toBeInTheDocument(); expect(screen.getByText(/The officer asked: Lease unclear/)).toBeInTheDocument(); expect(screen.getAllByRole('list', { name: 'Why this is here' })).toHaveLength(2);
    expect(screen.getAllByText('Overdue')[0]).toBeInTheDocument(); expect(screen.getByRole('link', { name: /Respond and resubmit/ })).toHaveAttribute('href', '/applications/3');
    await userEvent.click(screen.getByRole('button', { name: 'How is this ordered?' })); expect(await screen.findByText(/A deadline has already passed/)).toBeInTheDocument(); expect(screen.getByText(/assigned to you come first/)).toBeInTheDocument();
  });
  it('shows a helpful empty state with a next action', () => {
    renderApp(<AttentionPanel a={{ ...a, items: [], total: 0 }} role="institution" />); expect(screen.getByText('Nothing needs your attention right now')).toBeInTheDocument(); expect(screen.getByRole('button', { name: 'Start an application' })).toBeInTheDocument();
  });
});

describe('case page', () => {
  const detail = (over: any = {}) => ({
    application: { id: 5, ref: 'AF-2026-00005', title: 'Readiness test', status: 'draft', institution_name: 'Aravalli (Demo)', region_name: 'Northern Region', category_name: 'Extension of approval', age_days: 0, days_in_stage: 0, days_to_due: null, due_status: 'none', stage_due_date: null, summary: null },
    row_version: 1, workflow: null, stage: null, available_actions: [], required_documents: [{ doc_type: 'Lease Deed', display_name: 'Lease Agreement', has_expiry: true }, { doc_type: 'Annual Self-Disclosure', display_name: 'Annual Self-Disclosure Declaration', has_expiry: false }],
    documents: [], tasks: [], evc: [], undertakings: [], deficiencies: [], observations: [], submissions: [], history: [], synthetic: true, stages: [],
    stage_summary: { name: 'Draft', responsible_role: 'institution', pending_action: 'Finish the details, upload every required document, then review and submit.', waiting_on: 'your institution' }, next_steps: [], deadline_risk: null,
    readiness: { state: 'not_ready', label: 'Not ready to submit', can_submit: false, missing: 1, returned: 0, awaiting_verification: 1, verified: 0, open_deficiencies: 0, outstanding_obligations: 0, note: null,
      items: [{ doc_type: 'Lease Deed', display_name: 'Lease Agreement', state: 'missing', doc_code: null }, { doc_type: 'Annual Self-Disclosure', display_name: 'Annual Self-Disclosure Declaration', state: 'awaiting_verification', doc_code: 'DOC-0007', correction: null }] }, ...over });
  const open = (d: any, calls?: string[]) => { const c = mockApi({ '/api/auth/me': () => [200, { user: me('institution') }], '/api/lookups': () => [200, { clock: { today: '2026-03-02' } }], '/api/applications/5/submit': () => [200, { ok: true }], '/api/applications/5': () => [200, d] }); return c; };
  it('shows where the case stands, what is needed now, and distinguishes missing from awaiting verification', async () => {
    open(detail()); renderAuthed(<Routes><Route path="/applications/:id" element={<ApplicationDetail />} /></Routes>, '/applications/5');
    const strip = await screen.findByRole('region', { name: 'Where this case stands' });
    expect(within(strip).getByText('Draft')).toBeInTheDocument(); expect(within(strip).getByText(/Finish the details, upload every required document/)).toBeInTheDocument(); expect(within(strip).getByText(/Nothing is sent until then/)).toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'Application progress' })).toBeInTheDocument(); expect(screen.getByText('Missing')).toBeInTheDocument(); expect(screen.getByText('Uploaded, awaiting verification')).toBeInTheDocument(); expect(screen.getByText('Not ready to submit')).toBeInTheDocument();
    expect(screen.queryByText('Verified by an officer')).not.toBeInTheDocument();
  });
  it('blocks submission until the application is ready, then needs an explicit confirmation before it is sent', async () => {
    const calls = open(detail()); const { unmount } = renderAuthed(<Routes><Route path="/applications/:id" element={<ApplicationDetail />} /></Routes>, '/applications/5');
    await userEvent.click(await screen.findByRole('button', { name: 'Review and submit' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/not ready/); expect(screen.getByRole('button', { name: 'Submit application' })).toBeDisabled(); unmount(); vi.unstubAllGlobals();
    const ready = detail({ readiness: { ...detail().readiness, state: 'ready_to_submit', can_submit: true, missing: 0, label: 'Ready to submit. Nothing has been sent yet.', items: detail().readiness.items.map((i: any) => ({ ...i, state: 'awaiting_verification' })) } });
    const c2 = open(ready); renderAuthed(<Routes><Route path="/applications/:id" element={<ApplicationDetail />} /></Routes>, '/applications/5');
    await userEvent.click(await screen.findByRole('button', { name: 'Review and submit' })); const submit = await screen.findByRole('button', { name: 'Submit application' });
    expect(submit).toBeDisabled(); expect(screen.getByText(/Submitting does not mean it is approved/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('checkbox', { name: /I confirm that the details and documents are correct/ })); expect(submit).toBeEnabled(); expect(c2.some(c => c.includes('/submit'))).toBe(false);
    await userEvent.click(submit); await waitFor(() => expect(c2.some(c => c.startsWith('POST /api/applications/5/submit'))).toBe(true)); void calls;
  });
  it('does not announce success when the server refuses the submission', async () => {
    const ready = detail({ readiness: { ...detail().readiness, state: 'ready_to_submit', can_submit: true, missing: 0, items: detail().readiness.items.map((i: any) => ({ ...i, state: 'awaiting_verification' })) } });
    mockApi({ '/api/auth/me': () => [200, { user: me('institution') }], '/api/lookups': () => [200, { clock: { today: '2026-03-02' } }], '/api/applications/5/submit': () => [422, { error: { code: 'PRECONDITION_FAILED', message: 'Upload all required documents before submitting' } }], '/api/applications/5': () => [200, ready] });
    renderAuthed(<Routes><Route path="/applications/:id" element={<ApplicationDetail />} /></Routes>, '/applications/5');
    await userEvent.click(await screen.findByRole('button', { name: 'Review and submit' })); await userEvent.click(await screen.findByRole('checkbox')); await userEvent.click(screen.getByRole('button', { name: 'Submit application' }));
    expect(await screen.findByText('Upload all required documents before submitting')).toBeInTheDocument(); expect(screen.queryByText('Application submitted')).not.toBeInTheDocument();
  });
  it('shows the next steps and the audit tab to officers only', async () => {
    const d = detail({ application: { ...detail().application, status: 'in_progress', age_days: 3, days_in_stage: 3, days_to_due: 11, due_status: 'on_track', stage_due_date: '2026-03-16' }, stage_summary: { name: 'Scrutiny', responsible_role: 'regional_officer', assignee: 'Nikhil Rana', pending_action: 'Scrutiny: AF-2026-00005', waiting_on: 'regional officer' },
      next_steps: [{ action: 'complete_scrutiny', label: 'Complete scrutiny and send for EVC', role: 'regional_officer', automatic: false, requires_reason: false, to_stage_name: 'Authorised decision', requirements: ['At least one observation has been recorded for this stage'] }], readiness: { ...detail().readiness, state: 'submitted', label: 'Submitted and being processed' } });
    mockApi({ '/api/auth/me': () => [200, { user: me('regional_officer') }], '/api/lookups': () => [200, { clock: { today: '2026-03-02' } }], '/api/applications/5': () => [200, d] });
    renderAuthed(<Routes><Route path="/applications/:id" element={<ApplicationDetail />} /></Routes>, '/applications/5');
    const strip = await screen.findByRole('region', { name: 'Where this case stands' }); expect(strip).toHaveTextContent(/can complete scrutiny and send for EVC, which moves it to Authorised decision/); expect(within(strip).getByText('Assigned to Nikhil Rana')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Audit history' })).toBeInTheDocument(); expect(screen.getByRole('tab', { name: 'Notifications' })).toBeInTheDocument();
    expect(screen.getByText(/At least one observation has been recorded/)).toBeInTheDocument();
  });
});

describe('saved filters', () => {
  it('saves the current filters under a name, applies them again, and deletes them', async () => {
    mockApi({ '/api/auth/me': () => [200, { user: me() }], '/api/lookups': () => [200, { regions: [{ id: 1, name: 'Northern Region' }], categories: [], stages: [{ key: 'scrutiny', name: 'Scrutiny' }], officers: [], clock: { today: '2026-03-02' } }], '/api/applications': () => [200, { rows: [], total: 0, page: 1, pages: 1, pageSize: 15 }] });
    renderAuthed(<ApplicationList />, '/applications?deadline=overdue&stage=scrutiny');
    await userEvent.click(await screen.findByRole('button', { name: 'Save these filters' })); await userEvent.type(screen.getByLabelText('Name for this filter'), 'Overdue scrutiny'); await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    const group = await screen.findByRole('group', { name: 'Saved filters' }); expect(within(group).getByText('Overdue scrutiny')).toBeInTheDocument(); expect(JSON.parse(localStorage.getItem('af_presets_2')!)[0].query).toContain('deadline=overdue');
    await userEvent.click(within(group).getByRole('button', { name: 'Delete saved filter Overdue scrutiny' })); await waitFor(() => expect(screen.queryByRole('group', { name: 'Saved filters' })).not.toBeInTheDocument());
  });
});

describe('design-system parts', () => {
  it('status badges carry text and an icon, a stepper marks the current step, confirmations run the action only after a click', async () => {
    const { container } = renderApp(<><StatusBadge tone="bad">Overdue</StatusBadge><Stepper steps={[{ label: 'One', state: 'done' }, { label: 'Two', state: 'current' }, { label: 'Three', state: 'todo' }]} /></>);
    expect(screen.getByText('Overdue').querySelector('svg')).toHaveAttribute('aria-hidden', 'true'); expect(container.querySelector('[aria-current="step"]')).toHaveTextContent('Two'); expect(screen.getByText('(completed)')).toBeInTheDocument();
    const go = vi.fn().mockResolvedValue(undefined); const close = vi.fn(); renderApp(<ConfirmDialog title="Cancel EVC" body="Sure?" confirmLabel="Cancel the visit" danger onConfirm={go} onClose={close} />);
    expect(go).not.toHaveBeenCalled(); await userEvent.click(screen.getByRole('button', { name: 'Cancel the visit' })); await waitFor(() => expect(go).toHaveBeenCalled()); await waitFor(() => expect(close).toHaveBeenCalled());
  });
  it('keeps a confirmation open and shows the error when the action fails', async () => {
    const close = vi.fn(); renderApp(<ConfirmDialog title="Publish" body="Sure?" confirmLabel="Publish" onConfirm={() => Promise.reject(new Error('The server said no'))} onClose={close} />);
    await userEvent.click(screen.getByRole('button', { name: 'Publish' })); expect(await screen.findByRole('alert')).toHaveTextContent('The server said no'); expect(close).not.toHaveBeenCalled();
  });
  it('shows a tooltip on keyboard focus too, not only on hover', async () => {
    renderApp(<Tip text="Applications"><button>icon</button></Tip>); screen.getByRole('button').focus(); expect(await screen.findByRole('tooltip')).toHaveTextContent('Applications');
  });
});
