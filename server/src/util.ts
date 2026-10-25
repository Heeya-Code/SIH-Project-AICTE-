import crypto from 'node:crypto';
import type { DB } from './db';

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown) { super(message); }
}
export const badRequest = (m: string, d?: unknown) => new ApiError(400, 'BAD_REQUEST', m, d);
export const forbidden = (m = 'You do not have permission to do this') => new ApiError(403, 'FORBIDDEN', m);
export const notFound = (m = 'Not found') => new ApiError(404, 'NOT_FOUND', m);
export const conflict = (m: string, d?: unknown) => new ApiError(409, 'CONFLICT', m, d);
export const unprocessable = (m: string, d?: unknown) => new ApiError(422, 'PRECONDITION_FAILED', m, d);

const DAY = 86400000;
const toUtc = (s: string) => { const [y, m, d] = s.split('-').map(Number); return Date.UTC(y, m - 1, d); };
export const daysBetween = (from: string, to: string) => Math.round((toUtc(to) - toUtc(from)) / DAY);
export const addCalendarDays = (date: string, n: number) => new Date(toUtc(date) + n * DAY).toISOString().slice(0, 10);
const isWeekend = (date: string) => { const w = new Date(toUtc(date)).getUTCDay(); return w === 0 || w === 6; };

export function holidaySet(db: DB): Set<string> {
  return new Set((db.prepare('SELECT date FROM holidays').all() as any[]).map(r => r.date));
}
// Working days: Mon-Fri excluding rows in the `holidays` table. No official calendar is bundled.
export function addWorkingDays(date: string, n: number, holidays: Set<string>) {
  let d = date, left = n;
  while (left > 0) {
    d = addCalendarDays(d, 1);
    if (!isWeekend(d) && !holidays.has(d)) left--;
  }
  return d;
}
export function addDays(db: DB, date: string, n: number, mode: 'calendar' | 'working') {
  return mode === 'working' ? addWorkingDays(date, n, holidaySet(db)) : addCalendarDays(date, n);
}

export function getSetting(db: DB, key: string, fallback: string): string {
  const r = db.prepare('SELECT value FROM settings WHERE key=?').get(key) as any;
  return r ? r.value : fallback;
}
export function getNumberSetting(db: DB, key: string, fallback: number) {
  const n = Number(getSetting(db, key, String(fallback)));
  return Number.isFinite(n) ? n : fallback;
}
export function getDaysSetting(db: DB, key: string, fallback: number[]): number[] {
  try {
    const v = JSON.parse(getSetting(db, key, JSON.stringify(fallback)));
    return Array.isArray(v) ? v.map(Number).filter(n => Number.isFinite(n) && n >= 0).sort((a, b) => a - b) : fallback;
  } catch { return fallback; }
}
// Smallest configured threshold that is >= days remaining. Using a "bucket" (not an exact match) means a
// reminder still goes out, exactly once, if the scheduler was down on the exact day.
export function reminderBucket(daysLeft: number, thresholds: number[]): number | null {
  if (daysLeft < 0) return null;
  for (const t of [...thresholds].sort((a, b) => a - b)) if (daysLeft <= t) return t;
  return null;
}

export const uuid = () => crypto.randomUUID();
export const sha256 = (s: string) => crypto.createHash('sha256').update(s).digest('hex');
export function median(nums: number[]) {
  if (!nums.length) return 0;
  const s = [...nums].sort((a, b) => a - b), m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
export const round1 = (n: number) => Math.round(n * 10) / 10;
export const isDate = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));
