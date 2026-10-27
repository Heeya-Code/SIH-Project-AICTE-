import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderApp, renderAuthed, mockApi } from './utils';
import Login from '../pages/Login';
import Dashboard from '../pages/Dashboard';
import { ApplicationList } from '../pages/Applications';
import { DeadlineMeter } from '../components/ui';
import { ReasonDialog } from '../components/ReasonDialog';
import { tokenStore } from '../lib/api';
import { fmtDate, daysLabel } from '../lib/format';

beforeEach(() => { vi.unstubAllGlobals(); });

const me = { id: 2, name: 'Neha Rawat', email: 'ro.nr@demo.local', role: 'regional_officer', role_label: 'Regional officer', region_id: 1, institution_id: null, region_name: 'Northern Region', institution_name: null };

describe('login form', () => {
  it('validates fields before calling the server', async () => {
    const calls = mockApi({});
    renderApp(<Login />);
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText('Enter your email')).toBeInTheDocument();
    expect(screen.getByText('Enter your password')).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Email address'), 'not-an-email');
    await userEvent.type(screen.getByLabelText('Password'), 'x');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText('Enter a valid email address')).toBeInTheDocument();
    expect(calls).toHaveLength(0);
  });
  it('shows the server error for wrong credentials', async () => {
    mockApi({ '/api/auth/login': () => [401, { error: { code: 'INVALID_CREDENTIALS', message: 'Email or password is incorrect' } }] });
    renderApp(<Login />);
    await userEvent.type(screen.getByLabelText('Email address'), 'ro.nr@demo.local');
    await userEvent.type(screen.getByLabelText('Password'), 'wrong');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Email or password is incorrect');
  });
  it('fills the demo credentials from the quick-pick buttons', async () => {
    renderApp(<Login />);
    await userEvent.click(screen.getByRole('button', { name: /Bureau officer/ }));
    expect(screen.getByLabelText('Email address')).toHaveValue('bureau@demo.local');
  });
});

describe('dashboard', () => {
  const dash = { role: 'regional_officer', today: '2026-03-02', cards: [{ key: 'a', label: 'Overdue cases', value: 7, tone: 'bad' }, { key: 'b', label: 'Awaiting scrutiny', value: 12 }], charts: [{ key: 'c', title: 'Pending by stage', type: 'bar', data: [{ name: 'Scrutiny', value: 12 }] }],
    lists: [{ key: 'l', title: 'Overdue cases', columns: [{ key: 'ref', label: 'Application' }], rows: [], empty: 'No overdue cases in your Region.' }] };
  async function renderDash() {
    tokenStore.set('t');
    mockApi({ '/api/auth/me': () => [200, { user: me }], '/api/dashboard': () => [200, dash] });
    renderAuthed(<Dashboard />);
  }
  it('renders values returned by the backend, and an empty state for empty lists', async () => {
    await renderDash();
    const card = await screen.findByText('Overdue cases', { selector: 'p' });
    expect(within(card.closest('div')!.parentElement!).getByText('7')).toBeInTheDocument();
    expect(screen.getByText('12')).toBeInTheDocument();
    expect(screen.getByText('No overdue cases in your Region.')).toBeInTheDocument();
  });
  it('shows a loading state, then an error with retry when the request fails', async () => {
    tokenStore.set('t');
    let fail = true;
    mockApi({ '/api/auth/me': () => [200, { user: me }], '/api/dashboard': () => (fail ? [500, { error: { message: 'Something went wrong on our side' } }] : [200, dash]) });
    renderAuthed(<Dashboard />);
    expect(await screen.findByRole('status')).toHaveTextContent(/Loading/);
    expect(await screen.findByRole('alert')).toHaveTextContent('Something went wrong on our side');
    fail = false;
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Awaiting scrutiny')).toBeInTheDocument();
  });
});

describe('applications table', () => {
  const row = (n: number) => ({ id: n, ref: `AF-2026-0000${n}`, title: `Title ${n}`, institution_name: 'Aravalli Institute (Demo)', region_name: 'Northern Region', current_stage: 'scrutiny', status: 'in_progress', stage_due_date: '2026-03-16', days_in_stage: 3, days_to_due: 11, due_status: 'on_track', assigned_name: 'Neha Rawat', submitted_at: '2026-03-02T05:00:00Z', age_days: 3 });
  it('sends filters, sort and page to the server and renders the result', async () => {
    tokenStore.set('t');
    const calls = mockApi({
      '/api/auth/me': () => [200, { user: me }],
      '/api/lookups': () => [200, { regions: [{ id: 1, name: 'Northern Region' }], institutions: [], categories: [{ code: 'EXT', name: 'Extension' }], stages: [{ key: 'scrutiny', name: 'Scrutiny' }], officers: [], clock: { today: '2026-03-02', simulated: false } }],
      '/api/applications': url => [200, { rows: url.includes('deadline=overdue') ? [] : [row(1), row(2)], total: url.includes('deadline=overdue') ? 0 : 31, page: 1, pages: 3, pageSize: 15 }],
    });
    renderAuthed(<ApplicationList />, '/applications');
    expect(await screen.findByText('AF-2026-00001')).toBeInTheDocument();
    expect(screen.getByText('31 results')).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText('Deadline'), 'overdue');
    expect(await screen.findByText('No applications match')).toBeInTheDocument();
    expect(calls.some(c => c.includes('deadline=overdue'))).toBe(true);
    await userEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(await screen.findByText('AF-2026-00001')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Application/ }));
    await waitFor(() => expect(calls.some(c => c.includes('sort=ref') && c.includes('order=asc'))).toBe(true));
    await userEvent.click(screen.getByRole('button', { name: 'Next page' }));
    await waitFor(() => expect(calls.some(c => c.includes('page=2'))).toBe(true));
  });
});

describe('components and formatting', () => {
  it('labels deadline meters accessibly for overdue, due soon and on-track items', () => {
    const { rerender } = renderApp(<DeadlineMeter daysInStage={20} daysToDue={-4} status="overdue" />);
    expect(screen.getByRole('img')).toHaveAccessibleName(/4d overdue/);
    rerender(<DeadlineMeter daysInStage={5} daysToDue={2} status="due_soon" />);
    expect(screen.getByRole('img')).toHaveAccessibleName(/2d left/);
  });
  it('requires a reason before submitting a return', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    renderApp(<ReasonDialog title="Return for clarification" required submitLabel="Return" onSubmit={onSubmit} onClose={() => {}} />);
    await userEvent.click(screen.getByRole('button', { name: 'Return' }));
    expect(await screen.findByText('This is required')).toBeInTheDocument(); expect(onSubmit).not.toHaveBeenCalled();
    await userEvent.type(screen.getByLabelText(/Reason/), 'Lease unclear');
    await userEvent.click(screen.getByRole('button', { name: 'Return' }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith('Lease unclear'));
  });
  it('formats IST dates without a timezone shift', () => {
    expect(fmtDate('2026-03-02')).toBe('2 Mar 2026'); expect(fmtDate(null)).toBe('–');
    expect(daysLabel(-3)).toBe('3 days overdue'); expect(daysLabel(0)).toBe('due today'); expect(daysLabel(1)).toBe('1 day left');
  });
});
