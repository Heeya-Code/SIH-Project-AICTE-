// Controllable clock. Production uses the real time; the demo/test tooling can pin or shift it so
// that deadline, reminder and escalation behaviour can be exercised deterministically.
let pinned: Date | null = null;

export const clock = {
  now(): Date { return pinned ? new Date(pinned.getTime()) : new Date(); },
  iso(): string { return this.now().toISOString(); },
  today(): string { return istDate(this.now()); },
  set(d: Date | string | null) { pinned = d === null ? null : new Date(d); },
  isPinned(): boolean { return pinned !== null; },
};

// India has a fixed UTC+05:30 offset (no DST), so a fixed shift is exact.
const IST_OFFSET_MS = 5.5 * 3600 * 1000;
export function istDate(d: Date): string {
  return new Date(d.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
}
// A date-only value (YYYY-MM-DD, IST) at 10:00 IST - used when simulating events "on" a day.
export function atIstMorning(date: string): Date {
  return new Date(`${date}T10:00:00+05:30`);
}
