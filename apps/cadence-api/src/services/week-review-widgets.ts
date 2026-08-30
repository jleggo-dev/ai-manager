/**
 * Additive contract-shaped facts for the week review (Progress Engine parcel W2-2) — folds the
 * review's own `days` into the shared widget grammar's payload shapes
 * (packages/cadence-shared/src/types/progress-widgets.ts), so a session that reads "kept" here
 * reads "kept" the same way everywhere else `rhythm` is bound — one display vocabulary, not a
 * locally-invented one. Pure — no DB reads, same style `progress-rhythm.ts` and the client's own
 * `week-review-derive.ts` use for their day math.
 *
 * `rhythm_week` mirrors the SAME "day has anything scheduled / anything done" rule
 * `progress-rhythm.ts`'s `classifyDay` and `metrics.ts`'s `keptScheduledForDays` already use for
 * every other `rhythm` binding — reusing `keptScheduledForDays` directly rather than forking the
 * denominator math. Scoped to SESSIONS only (movement/practice rows), because that's the one
 * rollup whose per-day shape (one state per calendar date, no day holding more than a handful of
 * rows) maps onto `RhythmWeek` without distorting it — see RollupCards.tsx's own doc for why MEALS
 * and MINDSET keep their existing cell-grid rendering instead. No check-in/episode awareness (the
 * review's facts never fetch either), so `detour` is always null here.
 *
 * `meals_week` reuses `WeeklyBarsPayload`'s SHAPE at DAY granularity rather than real calendar
 * weeks — `weeks[i].label` is a weekday ("Mon"), not a week range, and `weeks[i].value` is that
 * day's kept-meal count. `WeeklyBarsWidget` itself hardcodes week-granularity copy ("N weeks ago" /
 * "this week"), so this field is exposed for a future consumer that can honor day granularity, not
 * for rendering through that widget as-is today — see the parcel report.
 */
import type { RhythmDayState, RhythmWeek, WeeklyBarsPayload } from '@cadence/shared';
import { keptScheduledForDays, type ConsistencyOccurrence } from './metrics.ts';
import type { WeekReviewDay } from './week-review-facts.ts';

const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAY_ABBR = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** "Aug 17" — a plain short date, no year (mirrors `progress-rhythm.ts`'s own week-label shape). */
function shortDateLabel(dateIso: string): string {
  const [, m, d] = dateIso.split('-').map(Number);
  return `${MONTH_ABBR[m! - 1]} ${d}`;
}

/** "Mon" — UTC-noon parse avoids a local-timezone day rollover on a plain YYYY-MM-DD string. */
function weekdayLabel(dateIso: string): string {
  return WEEKDAY_ABBR[new Date(`${dateIso}T12:00:00Z`).getUTCDay()]!;
}

/** kept > missed > unscheduled — no 'upcoming'/'checkin' here (no episode/check-in data feeds
 *  this resolver), same simplification `RollupCards.tsx`'s prior cell grid already made. */
function sessionDayState(
  date: string,
  doneDays: ReadonlySet<string>,
  scheduledDays: ReadonlySet<string>,
): RhythmDayState {
  if (doneDays.has(date)) return 'kept';
  if (scheduledDays.has(date)) return 'missed';
  return 'unscheduled';
}

/**
 * The review's SESSIONS rollup, reshaped as one real `RhythmWeek` — `start`/`label` are the
 * review's own period, never a stand-in, so nothing about the field's documented meaning is bent
 * to fit. `kept`/`scheduled` reuse `keptScheduledForDays`'s scheduled-days-only denominator (a day
 * with two sessions and one done still reads as one kept DAY), matching the rhythm widget
 * everywhere else it's bound rather than the review's own occurrence-counting rollup.
 */
export function buildSessionsRhythmWeek(days: WeekReviewDay[], period: { from: string; to: string }): RhythmWeek {
  const occurrences: ConsistencyOccurrence[] = days.flatMap((d) =>
    d.sessions.map((s) => ({ date: d.date, status: s.status })),
  );
  const doneDays = new Set(occurrences.filter((o) => o.status === 'done').map((o) => o.date));
  const scheduledDays = new Set(occurrences.map((o) => o.date));
  const { kept, scheduled } = keptScheduledForDays(
    occurrences,
    days.map((d) => d.date),
  );
  return {
    start: period.from,
    label: `${shortDateLabel(period.from)}–${shortDateLabel(period.to)}`,
    days: days.map((d) => ({ date: d.date, state: sessionDayState(d.date, doneDays, scheduledDays) })),
    kept,
    scheduled,
    detour: null,
  };
}

/**
 * The review's meals, reshaped as a `WeeklyBarsPayload` at day granularity — see module doc for
 * the caveat. A day with no per-meal occurrence materialized at all (every slot's `occurrence_id`
 * null — outside the plan's materialized horizon) reads `null` ("not read"), never a false zero; a
 * lived day with nothing logged is a real 0.
 */
export function buildMealsWeek(days: WeekReviewDay[]): WeeklyBarsPayload {
  const weeks = days.map((d) => {
    const materialized = d.meals.some((m) => m.occurrence_id !== null);
    return { label: weekdayLabel(d.date), value: materialized ? d.meals.filter((m) => m.logged).length : null };
  });
  return { unit: 'meals/day', weeks, latest: weeks.length > 0 ? weeks[weeks.length - 1]!.value : null };
}
