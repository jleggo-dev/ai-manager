import type { ClockUnit } from '@cadence/shared';

/**
 * Clock times, written the way the person chose (Settings → Units → Clock).
 *
 * Storage is always "HH:MM" 24-hour — the trail, the planner, and every schedule field agree on
 * that. This is the one boundary where it becomes words on a screen, so the choice lives in one
 * place: the owner's plan said "06:00" while the header beside it said "quiet at 9:00", two
 * dialects on one screen (2026-09-01). Word times ("morning", "after work") are not clock times
 * and pass through untouched.
 */

/** "06:00" → "06:00" (24h) or "6:00 am" (12h). Anything that isn't a clock time comes back as is. */
export function formatClock(timeOfDay: string | null | undefined, unit: ClockUnit): string {
  const raw = (timeOfDay ?? '').trim();
  const m = /^(\d{1,2}):(\d{2})$/.exec(raw);
  if (!m) return raw;
  const h = Number(m[1]);
  const mm = m[2]!;
  if (h > 23 || Number(mm) > 59) return raw;
  return minutesToClock(h * 60 + Number(mm), unit);
}

/** Minutes past midnight → "21:30" or "9:30 pm". Wraps, so 1470 is 00:30 and -30 is 23:30. */
export function minutesToClock(minutes: number, unit: ClockUnit): string {
  const m = ((Math.trunc(minutes) % 1440) + 1440) % 1440;
  const h24 = Math.floor(m / 60);
  const mm = String(m % 60).padStart(2, '0');
  if (unit === '24h') return `${String(h24).padStart(2, '0')}:${mm}`;
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${mm} ${h24 < 12 ? 'am' : 'pm'}`;
}

/** Type guard for what the units endpoint resolves — anything else means "not chosen yet". */
export function asClockUnit(value: unknown): ClockUnit | null {
  return value === '24h' || value === '12h' ? value : null;
}
