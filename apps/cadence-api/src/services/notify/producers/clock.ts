import { localDate, localMinutes } from '../policy.ts';

/**
 * Timezone arithmetic the producers share.
 *
 * Every producer asks the same two questions — "what day is it where they are?" and "is this a
 * reasonable hour for them?" — and both are the kind of thing that looks right when you are in
 * the same zone as your test data and is quietly wrong for everyone else. Doing it once, here,
 * means a fix lands for all of them.
 *
 * All of it goes through `Intl` rather than cached offsets, for the same reason `policy.ts` does:
 * an offset held across a DST boundary turns a 9am rule into an 8am one twice a year.
 */

const DAY_MS = 86_400_000;

/** Shift a YYYY-MM-DD by whole days. Pure date arithmetic — no zone involved, and none needed. */
export function addDays(dateIso: string, days: number): string {
  const [y, m, d] = dateIso.split('-').map(Number);
  if (!y || !m || !d) return dateIso;
  return new Date(Date.UTC(y, m - 1, d) + days * DAY_MS).toISOString().slice(0, 10);
}

/** Whole days between two YYYY-MM-DD dates (`to - from`). */
export function daysBetween(fromIso: string, toIso: string): number {
  const parse = (s: string): number => {
    const [y, m, d] = s.split('-').map(Number);
    return y && m && d ? Date.UTC(y, m - 1, d) : NaN;
  };
  const a = parse(fromIso);
  const b = parse(toIso);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return NaN;
  return Math.round((b - a) / DAY_MS);
}

/** The user's local calendar date, or null when their zone is unknown (caller must then hold). */
export function userToday(now: Date, timezone: string | null | undefined): string | null {
  return localDate(now, timezone);
}

/**
 * The morning window a "yesterday" notification may land in: from 07:00 to noon, local.
 *
 * Bounded at BOTH ends on purpose. The lower bound is why `freeze_save` is never a same-night
 * buzz — a 23:59 message saying a day off was fine is the thing that makes the day off not fine.
 * The upper bound is because a note about yesterday stops being an offer and starts being a
 * verdict somewhere around lunchtime.
 */
export function inMorningWindow(now: Date, timezone: string | null | undefined): boolean {
  const mins = localMinutes(now, timezone);
  if (mins == null) return false; // unknown zone → we cannot prove it is morning, so we hold
  return mins >= 7 * 60 && mins < 12 * 60;
}

/**
 * Minutes a zone is ahead of UTC at a given instant.
 *
 * Works by formatting the instant in the target zone and reading the wall clock back as if it were
 * UTC; the difference is the offset. It is the standard trick, and it is here rather than in a
 * dependency because it is six lines and a date library is not worth carrying for them.
 */
function zoneOffsetMinutes(at: Date, timezone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(at);
  const get = (type: string): number => Number(parts.find((p) => p.type === type)?.value);
  const asIfUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour') % 24, get('minute'), get('second'));
  return (asIfUtc - at.getTime()) / 60_000;
}

/**
 * A local wall-clock time in `timezone` → the UTC instant it happens at.
 *
 * Two passes, deliberately. The offset depends on the instant, and the instant is what we are
 * solving for, so the first pass uses the offset at the naive guess and the second corrects it —
 * which matters exactly once or twice a year, on the days a session sits near a DST change and a
 * single-pass answer is an hour out. Returns null for an unknown zone rather than falling back to
 * UTC: a weather nudge an hour wrong is worse than no weather nudge.
 */
export function zonedTimeToUtc(
  dateIso: string,
  hour: number,
  minute: number,
  timezone: string | null | undefined,
): Date | null {
  const tz = timezone?.trim();
  if (!tz) return null;
  const [y, m, d] = dateIso.split('-').map(Number);
  if (!y || !m || !d) return null;
  try {
    const naive = Date.UTC(y, m - 1, d, hour, minute);
    const firstPass = naive - zoneOffsetMinutes(new Date(naive), tz) * 60_000;
    return new Date(naive - zoneOffsetMinutes(new Date(firstPass), tz) * 60_000);
  } catch {
    return null;
  }
}

/** Local hour (0-23) of an instant, or null for an unknown zone. */
export function localHour(at: Date, timezone: string | null | undefined): number | null {
  const mins = localMinutes(at, timezone);
  return mins == null ? null : Math.floor(mins / 60);
}
