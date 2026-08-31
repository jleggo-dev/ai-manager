/**
 * `felt_week` — four side-by-side weeks colored by how the daily check-ins felt (owner design
 * "Cadence Progress" 1a, "Calmer evenings" card). Binds to `cadence.daily_checkins.mood` (1–5).
 *
 * Brand physics, enforced by construction: a day whose row has no mood (dismissed, or answered
 * without one) is UNREAD, and a week with zero read days gets `value: null` — the renderer draws
 * it as an outline, never a filled "zero". Always the trailing four Monday-start weeks: felt has
 * no meaningful re-window, so the card honestly ignores the page's window control.
 */
import type { FeltWeekPayload, WidgetOmission } from '@cadence/shared';
import { listDailyCheckins, type DailyCheckinRow } from '../repos/coach-moments.ts';
import { addDaysIso, mondayOnOrBefore } from './progress-rhythm.ts';
import { omit } from './window-range.ts';

const FELT_WEEKS = 4;

const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "Aug 10" — the week's Monday, plainly dated (year omitted: a bar label is a caption). */
function weekLabel(mondayIso: string): string {
  const [, m, d] = mondayIso.split('-').map(Number);
  return `${MONTH_ABBR[m! - 1]} ${d}`;
}

/** Pure: fold already-fetched check-in rows into the four-week shape. Weeks run oldest → newest,
 *  ending in the week containing `todayIso`. */
export function resolveFeltWeeks(rows: DailyCheckinRow[], todayIso: string): FeltWeekPayload | WidgetOmission {
  const thisMonday = mondayOnOrBefore(todayIso);
  const moodByDate = new Map<string, number>();
  for (const row of rows) {
    if (row.mood !== null) moodByDate.set(row.date.slice(0, 10), row.mood);
  }

  const weeks = Array.from({ length: FELT_WEEKS }, (_, i) => {
    const start = addDaysIso(thisMonday, (i - (FELT_WEEKS - 1)) * 7);
    const moods: number[] = [];
    for (let d = 0; d < 7; d++) {
      const mood = moodByDate.get(addDaysIso(start, d));
      if (mood !== undefined) moods.push(mood);
    }
    const mean = moods.length ? Math.round((moods.reduce((a, b) => a + b, 0) / moods.length) * 100) / 100 : null;
    return { label: weekLabel(start), value: mean, days: moods.length };
  });

  if (weeks.every((w) => w.days === 0)) {
    return omit('felt_week', 'felt_week', 'no daily check-in moods in the last four weeks');
  }
  return { weeks };
}

/** Fetch + resolve for one user. */
export async function getFeltWeeks(userId: string, now: Date = new Date()): Promise<FeltWeekPayload | WidgetOmission> {
  const todayIso = now.toISOString().slice(0, 10);
  const from = addDaysIso(mondayOnOrBefore(todayIso), -(FELT_WEEKS - 1) * 7);
  const rows = await listDailyCheckins(userId, from, todayIso);
  return resolveFeltWeeks(rows, todayIso);
}
