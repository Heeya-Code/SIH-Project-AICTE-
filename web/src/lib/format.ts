const TZ = 'Asia/Kolkata';
const dateFmt = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: TZ });
const dtFmt = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: TZ });

// "YYYY-MM-DD" is an IST calendar date: format it without any timezone shift.
export const fmtDate = (d?: string | null) => {
  if (!d) return '–';
  if (/^\d{4}-\d{2}-\d{2}$/.test(d)) { const [y, m, day] = d.split('-').map(Number); return dateFmt.format(new Date(Date.UTC(y, m - 1, day, 6))); }
  return dateFmt.format(new Date(d));
};
export const fmtDateTime = (d?: string | null) => (d ? `${dtFmt.format(new Date(d))} IST` : '–');
export const pretty = (s?: string | null) => (s ? s.replace(/_/g, ' ').replace(/^./, c => c.toUpperCase()) : '–');
export const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;
export const daysLabel = (d: number | null | undefined) => (d == null ? '' : d < 0 ? `${plural(-d, 'day')} overdue` : d === 0 ? 'due today' : `${plural(d, 'day')} left`);

export const APP_STATUS: Record<string, { label: string; tone: Tone }> = {
  draft: { label: 'Draft', tone: 'neutral' }, in_progress: { label: 'In progress', tone: 'brand' }, returned: { label: 'Needs response', tone: 'warn' },
  approved: { label: 'Approved', tone: 'good' }, rejected: { label: 'Rejected', tone: 'bad' }, withdrawn: { label: 'Withdrawn', tone: 'neutral' },
};
export type Tone = 'neutral' | 'brand' | 'good' | 'warn' | 'bad' | 'teal';
export const toneFor = (s?: string): Tone => {
  switch (s) {
    case 'overdue': case 'expired': case 'rejected': case 'failed': case 'abandoned': case 'returned_for_correction': return 'bad';
    case 'due_soon': case 'expiring_soon': case 'returned': case 'warn': case 'queued': case 'pending': case 'under_verification': case 'submitted': return 'warn';
    case 'verified': case 'closed': case 'completed': case 'approved': case 'valid': case 'on_track': case 'acknowledged': case 'simulated_sent': case 'sent': return 'good';
    case 'scheduled': case 'rescheduled': case 'in_progress': case 'upcoming': case 'open': return 'brand';
    default: return 'neutral';
  }
};
export const ROLE_LABEL: Record<string, string> = {
  institution: 'Institution representative', regional_officer: 'Regional officer', bureau_officer: 'Bureau officer',
  evc_coordinator: 'EVC coordinator', competent_authority: 'Competent authority', admin: 'Administrator',
};
