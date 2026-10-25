import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderApp, renderAuthed, mockApi } from './utils';
import { tokenStore } from '../lib/api';
import PublicData, { QualityReport } from '../pages/PublicData';
import Verification from '../pages/Verification';

beforeEach(() => { vi.unstubAllGlobals(); tokenStore.set('t'); });
const user = (role: string) => ({ id: 1, name: 'Tester', email: 't@demo.local', role, role_label: role, region_id: 1, institution_id: null, region_name: 'Northern Region', institution_name: null });
const source = (o: any = {}) => ({ id: 1, code: 'AIKOSH-AISHE-COLLEGES', name: 'All Colleges as per AISHE Dashboard (republished dataset)', publisher: 'AIKosh', url: 'https://aikosh.indiaai.gov.in/x', kind: 'institution_directory', licence: null, licence_note: 'Confirm on the dataset page.', dataset_date: null, field_definitions_ref: 'Fields: AISHE Code, Name', access_status: 'requires_manual_download', access_checked_on: '2026-10-23', access_note: 'Not downloaded.', usable_for_import: 1, imported_batches: 0, ...o });
const base = (role: string, extra: Record<string, any> = {}) => ({ '/api/auth/me': () => [200, { user: user(role) }], '/api/public-data/summary': () => [200, { institutions: 0, batches: 0, open_conflicts: 0, states: 0, note: 'No public data has been imported yet. Sources are registered, but no file has been downloaded or validated.' }], '/api/public-data/sources': () => [200, [source()]], ...extra });

describe('public data page', () => {
  it('is honest that nothing has been imported and that the licence is missing', async () => {
    mockApi(base('bureau_officer') as any); renderAuthed(<PublicData />);
    expect(await screen.findByText(/No public data has been imported yet/)).toBeInTheDocument();
    expect(await screen.findByText('Needs a manual download')).toBeInTheDocument(); expect(screen.getByText(/Not recorded. Imports are blocked until it is/)).toBeInTheDocument();
    expect(screen.getByText('Public import')).toBeInTheDocument(); expect(screen.getByText('Synthetic demo')).toBeInTheDocument(); expect(screen.getByText('Admin-configured')).toBeInTheDocument();
  });
  it('offers import and provenance editing to administrators only', async () => {
    mockApi(base('bureau_officer') as any); const a = renderAuthed(<PublicData />);
    await screen.findByText('Needs a manual download'); expect(screen.queryByRole('tab', { name: 'Import' })).not.toBeInTheDocument(); expect(screen.queryByRole('button', { name: 'Edit provenance' })).not.toBeInTheDocument(); a.unmount();
    vi.unstubAllGlobals(); mockApi(base('admin') as any); renderAuthed(<PublicData />);
    expect(await screen.findByRole('tab', { name: 'Import' })).toBeInTheDocument(); expect(await screen.findByRole('button', { name: 'Edit provenance' })).toBeInTheDocument();
  });
  it('renders a data-quality report with rejects, duplicates, conflicts and missing fields', () => {
    const r = { status: 'completed_with_warnings', dry_run: false, source: 'AIKOSH-AISHE-COLLEGES', academic_year: '2023-24', retrieved_on: '2026-03-02', file: 'colleges.csv', rows_read: 11, imported: { new: 6, filled_blank: 1, unchanged: 0 }, rejected: { count: 3, by_reason: { missing_state: 1, missing_name: 1, 'unrecognised_state: Atlantis': 1 } },
      duplicates: { in_file_identical: 1, in_file_conflicting: 1, possible_near: 0 }, conflicts: { opened: 7, note: 'Existing values were kept. Each conflict waits for a person to choose.' }, warnings: { year_out_of_range: 1 }, completeness_pct: 71.5,
      missing_fields: { aishe_code: { count: 2, pct: 25 }, district: { count: 0, pct: 0 } }, columns: { mapped: { 'AISHE Code': 'aishe_code' }, unmapped_columns: [], fields_without_a_column: [] }, limits: ['Inclusion in an AISHE list does not mean AICTE approval.'] };
    renderApp(<QualityReport r={r} />);
    return screen.findByText('Completed with warnings').then(() => {
      expect(screen.getByText('Rows read').nextSibling).toHaveTextContent('11'); expect(screen.getByText(/missing state: 1/)).toBeInTheDocument(); expect(screen.getByText(/unrecognised state: Atlantis: 1/)).toBeInTheDocument();
      expect(screen.getByText(/Existing values were kept/)).toBeInTheDocument(); expect(screen.getByText('71.5%')).toBeInTheDocument(); expect(screen.getByText(/does not mean AICTE approval/)).toBeInTheDocument();
    });
  });
  it('shows a blocked import with exactly what is missing', () => {
    renderApp(<QualityReport r={{ status: 'blocked_provenance', message: 'The import was not run because provenance is incomplete.', missing: ['licence (record it on the source after checking the dataset page)'] }} />);
    return screen.findByText(/provenance is incomplete/).then(() => expect(screen.getByText(/licence \(record it/)).toBeInTheDocument());
  });
  it('requires a written reason before a conflict is resolved, and sends the decision', async () => {
    const calls = mockApi(base('admin', { '/api/public-data/conflicts': () => [200, { rows: [{ id: 5, institution_id: 1, institution_name: 'Delta Test College', aishe_code: 'C-40001', state: 'Goa', field: 'management', existing_value: 'Government', incoming_value: 'Private', status: 'open', batch_id: 2, row_number: 2 }], total: 1, page: 1, pages: 1, pageSize: 10 }], '/api/public-data/conflicts/5/resolve': () => [200, { ok: true }] }) as any);
    renderAuthed(<PublicData />); await userEvent.click(await screen.findByRole('tab', { name: 'Conflicts' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Use incoming' }));
    await userEvent.click(screen.getByRole('button', { name: 'Record decision' })); expect(await screen.findByText('This is required')).toBeInTheDocument(); expect(calls.some(c => c.includes('/resolve'))).toBe(false);
    await userEvent.type(screen.getByLabelText(/What did you check/), 'Confirmed on the directory page'); await userEvent.click(screen.getByRole('button', { name: 'Record decision' }));
    await waitFor(() => expect(calls.some(c => c.includes('POST /api/public-data/conflicts/5/resolve'))).toBe(true));
  });
});

describe('verification queue', () => {
  const row = { id: 7, display_name: 'Lease Agreement', doc_code: 'DOC-0007', reference_no: 'SYN-1', file_name: 'Lease Agreement.pdf', version: 1, institution_name: 'Aravalli Institute (Demo)', region_name: 'Northern Region', application_id: 3, application_ref: 'AF-2026-00003', app_status: 'in_progress', waiting_days: 10, expiry_date: '2026-11-20', expiry_state: 'expiring_soon', days_to_expiry: 28 };
  const routes = (calls?: string[]) => ({ '/api/auth/me': () => [200, { user: user('regional_officer') }], '/api/lookups': () => [200, { regions: [{ id: 1, name: 'Northern Region' }], doc_types: ['Lease Deed'], doc_type_names: { 'Lease Deed': 'Lease Agreement' }, clock: { today: '2026-10-23' } }],
    '/api/documents/queue-summary': () => [200, { pending: 4, waiting_over_7_days: 2, expiring_within_30_days: 1, already_expired: 0, returned_awaiting_institution: 3 }], '/api/documents/7/verify': () => [200, { ok: true }], '/api/documents': () => [200, { rows: [row], total: 1, page: 1, pages: 1, pageSize: 12 }] }) as any;
  it('lists waiting documents with their descriptive names and how long each has waited', async () => {
    mockApi(routes()); renderAuthed(<Verification />);
    expect((await screen.findAllByText('Lease Agreement')).length).toBeGreaterThan(0); expect(screen.getByText(/Document ID: DOC-0007/)).toBeInTheDocument(); expect(screen.getByText('10 days')).toBeInTheDocument(); expect(screen.getByText('Waiting over 7 days')).toBeInTheDocument();
    expect(screen.getByText(/nothing here is verified automatically/i)).toBeInTheDocument();
  });
  it('verifies on a click, but returning a document needs a reason', async () => {
    const calls = mockApi(routes()); renderAuthed(<Verification />);
    await userEvent.click(await screen.findByRole('button', { name: 'Return' }));
    await userEvent.click(screen.getByRole('button', { name: 'Return document' })); expect(await screen.findByText('This is required')).toBeInTheDocument(); expect(calls.some(c => c.includes('/verify'))).toBe(false);
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' })); await userEvent.click(screen.getByRole('button', { name: 'Verify' }));
    await waitFor(() => expect(calls.some(c => c.startsWith('POST /api/documents/7/verify'))).toBe(true));
  });
});
