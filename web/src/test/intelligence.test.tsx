import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderAuthed, mockApi } from './utils';
import { tokenStore } from '../lib/api';
import Analytics from '../pages/Analytics';
import Rules from '../pages/Rules';
import { Assistant } from '../components/Assistant';

beforeEach(() => { vi.unstubAllGlobals(); tokenStore.set('t'); });
const me = { id: 1, name: 'Bhavesh', email: 'bureau@demo.local', role: 'bureau_officer', role_label: 'Bureau officer', region_id: null, institution_id: null, region_name: null, institution_name: null };
const lookups = { regions: [{ id: 1, name: 'Northern Region' }], institutions: [], categories: [{ code: 'EXT', name: 'Extension' }], stages: [], officers: [], doc_types: [], clock: { today: '2026-06-15', simulated: false } };

describe('analytics page', () => {
  const data = { generated_at: '2026-06-15T05:00:00Z', today: '2026-06-15', data_origin: 'All records in this view are synthetic demonstration data.', kinds: { calculated: 'Computed from stored records.' },
    totals: { applications: 120, drafts: 4, open: 40, completed: 70, overdue_open: 12, due_soon_open: 3, unassigned_open: 5, stalled_open: 6, synthetic: 124 },
    by_status: [{ key: 'approved', label: 'approved', value: 60, drill: { status: 'approved' } }], by_category: [], by_region: [], by_stage: [{ key: 'scrutiny', label: 'Scrutiny', value: 20, drill: { stage: 'scrutiny', open: '1' } }],
    stage_time: [], overdue_actions: { stage_tasks: 3, evc: 1, obligations: 2, expired_documents: 4 }, upcoming_deadlines: [], documents: { expired: 4, within_30: 5, within_60: 1, within_90: 2 }, evc: { queued: 2, scheduled: 3, rescheduled: 0, completed: 9, overdue: 1 },
    workload: { officers: [], unassigned_open: 5, imbalance: null, note: 'Not enough officers in scope to compare workload.' }, processing_time: [],
    bottlenecks: { kind: 'calculated', method: 'Score = demonstration weights.', rows: [{ key: 'scrutiny', label: 'Scrutiny', score: 0.71, level: 'high', open: 20, overdue: 9, overdue_share: 45, avg_open_age_days: 18, median_completed_days: 6, explanation: ['9 of 20 open case(s) at this stage are past their deadline (45%).', 'Open cases have waited 18 days on average.', 'This stage holds 50% of all open cases.'], drill: { stage: 'scrutiny', open: '1' } }] },
    forecast: { kind: 'forecast', notice: 'Forecast based on historical (synthetic) stage durations. "Likely late" is an estimate, not a confirmed overdue status.', likely_late: 4, watch: 2, confirmed_overdue: 12 } };
  const routes: Record<string, () => [number, any]> = { '/api/auth/me': () => [200, { user: me }], '/api/lookups': () => [200, lookups], '/api/analytics': () => [200, data] };

  it('shows calculated figures, labels the forecast as illustrative, and explains a bottleneck from its data', async () => {
    mockApi(routes); renderAuthed(<Analytics />);
    expect(await screen.findByText('Submitted applications')).toBeInTheDocument();
    expect(screen.getByText('120')).toBeInTheDocument(); expect(screen.getByText(/synthetic demonstration data/)).toBeInTheDocument();
    expect(screen.getAllByText('Calculated').length).toBeGreaterThan(3);
    expect(screen.getByText('Illustrative, not a confirmed status')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Why' }));
    expect(screen.getByText(/9 of 20 open case\(s\)/)).toBeInTheDocument(); expect(screen.getByText(/Score = demonstration weights/)).toBeInTheDocument();
  });
  it('passes filters to the server', async () => {
    const calls = mockApi(routes); renderAuthed(<Analytics />);
    await screen.findByText('Submitted applications');
    await userEvent.selectOptions(screen.getByLabelText('Category'), 'EXT');
    await waitFor(() => expect(calls.some(c => c.includes('/api/analytics?category=EXT'))).toBe(true));
  });
});

describe('regulatory rules page', () => {
  it('separates verification levels, shows source, section and page note, and warns that the original was not retrieved', async () => {
    const rule = (o: any) => ({ id: 1, code: 'R-EVC-01', kind: 'regulatory_rule', title: 'Scrutiny and EVC for any increase in intake', statement: 'A scrutiny and an EVC are carried out.', verification_status: 'verified_excerpt', flagged_for_review: 0, section_ref: '2.6 Increase in Intake', page_ref: null, page_note: 'Printed page not confirmed.', source_title: 'APH copy', source_url: 'https://example.org/aph.pdf', source_trust: 'secondary', version_label: 'APH 2024-27', last_reviewed_on: null, ...o });
    mockApi({ '/api/auth/me': () => [200, { user: me }], '/api/regulatory/summary': () => [200, { sources: 10, rules: 25, verified_excerpt: 11, needs_review: 9, assumptions: 5, reviewed_by_admin: 0 }],
      '/api/regulatory/rules': () => [200, { rows: [rule({}), rule({ id: 2, code: 'A-DL-01', kind: 'configurable_assumption', title: 'Stage deadlines used in the demonstration', verification_status: 'assumption', source_title: null, section_ref: 'Workflow stages' }), rule({ id: 3, code: 'R-DOC-01', verification_status: 'unverified', flagged_for_review: 1, title: 'Fire safety certificate on checklists' })], total: 3, page: 1, pages: 1, pageSize: 12 }] });
    renderAuthed(<Rules />);
    expect(await screen.findByText(/could not be downloaded automatically/)).toBeInTheDocument();
    expect(await screen.findByText('Read in a source excerpt', { selector: 'span' })).toBeInTheDocument(); expect(screen.getByText('Demo assumption', { selector: 'span' })).toBeInTheDocument(); expect(screen.getByText('Unverified', { selector: 'span' })).toBeInTheDocument();
    expect(screen.getByText('Flagged for review')).toBeInTheDocument();
    await userEvent.click(screen.getAllByRole('button', { name: 'Details' })[0]);
    expect(screen.getByText('2.6 Increase in Intake')).toBeInTheDocument(); expect(screen.getByText('Printed page not confirmed.')).toBeInTheDocument(); expect(screen.getByText('Not shown in the excerpt')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Record a review' })).not.toBeInTheDocument();      // reviewing is admin-only
  });
});

describe('handbook assistant', () => {
  const setup = (answer: any) => { mockApi({ '/api/auth/me': () => [200, { user: me }], '/api/lookups': () => [200, lookups], '/api/reference/ask': () => [200, answer] }); renderAuthed(<Assistant />); };
  const ask = async (text: string) => { await userEvent.click(await screen.findByRole('button', { name: 'Open the assistant' })); await userEvent.click(screen.getByRole('tab', { name: 'AICTE handbook' })); await userEvent.type(screen.getByLabelText('Your question'), text); await userEvent.click(screen.getByRole('button', { name: 'Send question' })); };
  it('shows evidence with source, section, page note and verification status, and caveats unverified material', async () => {
    setup({ answered: true, message: 'Found 1 relevant excerpt(s) in the indexed sources.', evidence: [{ rule_code: 'R-EVC-01', title: 'Scrutiny and EVC', statement: 'A scrutiny and an EVC are carried out for any increase in intake.', verification_status: 'verified_excerpt', section_ref: '2.6', page_ref: null, page_note: 'Printed page not confirmed.', source: { title: 'APH copy', trust: 'secondary', url: 'https://example.org' } }], caveats: ['None of these has been checked against the official handbook by an administrator yet.'], disclaimer: 'Paraphrased from excerpts. This tool cannot decide an approval.' });
    await ask('EVC for increase in intake?');
    expect(await screen.findByText('Section: 2.6')).toBeInTheDocument(); expect(screen.getByText(/Printed page not confirmed/)).toBeInTheDocument(); expect(screen.getByText(/APH copy/)).toBeInTheDocument();
    expect(screen.getByText(/not .*checked against the official handbook|None of these has been checked/)).toBeInTheDocument(); expect(screen.getByText(/cannot decide an approval/)).toBeInTheDocument();
  });
  it('says plainly when there is not enough evidence instead of answering', async () => {
    setup({ answered: false, reason: 'insufficient_evidence', message: 'The indexed excerpts do not contain enough evidence to answer this. Nothing has been guessed.', evidence: [], disclaimer: 'Not legal advice.' });
    await ask('pharmacy faculty ratio');
    expect(await screen.findByText('No answer from the indexed sources')).toBeInTheDocument(); expect(screen.getByText(/Nothing has been guessed/)).toBeInTheDocument();
    expect(within(screen.getByRole('dialog')).queryByText(/Section:/)).not.toBeInTheDocument();
  });
});
