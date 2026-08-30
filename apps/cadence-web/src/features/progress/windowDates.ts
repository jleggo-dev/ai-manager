import type { ProgressWindow } from '@cadence/shared';

const DAY_MS = 86_400_000;
const iso = (d: Date) => d.toISOString().slice(0, 10);

function trailing(days: number): { from: string; to: string } {
  const now = new Date();
  return { from: iso(new Date(now.getTime() - (days - 1) * DAY_MS)), to: iso(now) };
}

/**
 * Client-side [from, to] for the date-ranged reads. Mirrors the server's own window mapping
 * (services/window-range.ts) — 'all' floors at the epoch so callers never branch on null.
 */
export function windowDates(window: ProgressWindow): { from: string; to: string } {
  if (window === 'all') return { from: '1970-01-01', to: iso(new Date()) };
  return trailing(window === 'week' ? 7 : 30);
}

/**
 * The rhythm widget's own range: `GET /progress/history` rejects spans over 400 days, and a
 * wall of every week ever is not a rhythm anyone can read — 'all' means the last 26 weeks here.
 * 'week' still fetches two weeks so the current week has last week beside it for contrast.
 */
export function rhythmDates(window: ProgressWindow): { from: string; to: string } {
  return trailing(window === 'week' ? 14 : window === 'month' ? 35 : 182);
}
