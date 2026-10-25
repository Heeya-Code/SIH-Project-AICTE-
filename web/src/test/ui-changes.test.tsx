import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import { renderApp, renderAuthed, mockApi } from './utils';
import { DocLabel } from '../components/ui';
import Dashboard from '../pages/Dashboard';
import { Shell } from '../components/Shell';
import { tokenStore } from '../lib/api';

beforeEach(() => { vi.unstubAllGlobals(); });
const me = { id: 5, name: 'Rep', email: 'inst1@demo.local', role: 'institution', role_label: 'Institution representative', region_id: 1, institution_id: 1, region_name: 'Northern Region', institution_name: 'Aravalli (Demo)' };

describe('document labels', () => {
  it('shows the descriptive name first and keeps the document ID, reference and file as secondary text', () => {
    renderApp(<DocLabel name="Lease Agreement" code="DOC-0042" reference="SYN-1-2" file="Lease Agreement.pdf" />);
    expect(screen.getByText('Lease Agreement')).toHaveClass('font-medium');
    expect(screen.getByText('Document ID: DOC-0042 · Ref SYN-1-2 · Lease Agreement.pdf')).toBeInTheDocument();
  });
  it('falls back to a meaningful label instead of a bare number', () => {
    renderApp(<DocLabel name={null} code="DOC-0007" />);
    expect(screen.getByText('Unnamed Document')).toBeInTheDocument(); expect(screen.getByText('Document ID: DOC-0007')).toBeInTheDocument();
  });
});

describe('dashboard scrollbars', () => {
  it('hides the scrollbar only on Submission history and Upcoming deadlines', async () => {
    tokenStore.set('t');
    const list = (key: string, title: string) => ({ key, title, columns: [{ key: 'a', label: 'Item' }], rows: [{ a: `${title} row` }], empty: 'none' });
    mockApi({ '/api/auth/me': () => [200, { user: me }], '/api/dashboard': () => [200, { role: 'institution', today: '2026-03-02', cards: [], charts: [], lists: [list('actions', 'Pending actions'), list('deadlines', 'Upcoming deadlines'), list('subs', 'Submission history')] }] });
    renderAuthed(<Dashboard />);
    const wrapper = async (text: string) => (await screen.findByText(`${text} row`)).closest('.overflow-x-auto')!;
    expect(await wrapper('Upcoming deadlines')).toHaveClass('no-scrollbar'); expect(await wrapper('Submission history')).toHaveClass('no-scrollbar');
    expect(await wrapper('Pending actions')).not.toHaveClass('no-scrollbar');
    expect(await wrapper('Upcoming deadlines')).not.toHaveClass('max-h-[360px]');         // expands with the page: nothing is clipped
  });
});

describe('sidebar', () => {
  it('is sticky and viewport-high on large screens, with its own scrolling navigation', async () => {
    tokenStore.set('t');
    mockApi({ '/api/auth/me': () => [200, { user: me }], '/api/lookups': () => [200, { clock: { today: '2026-03-02', simulated: false } }], '/api/notifications/unread-count': () => [200, { unread: 0, pending_ack: 0 }] });
    const { container } = renderAuthed(<Shell />);
    const aside = await vi.waitFor(() => { const a = container.querySelector('aside'); if (!a) throw new Error('no sidebar'); return a; });
    for (const c of ['lg:sticky', 'lg:top-0', 'lg:h-dvh']) expect(aside).toHaveClass(c);
    expect(aside.querySelector('nav')).toHaveClass('overflow-y-auto');
    expect(screen.getAllByRole('link', { name: /Dashboard/ })[0]).toBeInTheDocument();
  });
});
