import type { WeekReviewDay, WeekReviewMindRow } from '../../../lib/api.ts';

/**
 * Pure "what counts as kept" math, shared by DayChips (per day) and RollupCards (per week) so the
 * two views of the same facts can never quietly disagree about what a done mind row is. No
 * component here — these are extracted precisely so both call sites read the identical rule.
 *
 * BRAND.md throughout: every count below is "kept out of total", never "missed out of total" —
 * callers render the difference as a neutral track, not a red mark.
 */

/** A mind/practice row counts as kept when its cached session named steps and every one is done,
 *  or — with no named steps to check off — the occurrence itself is marked done. */
export function mindRowKept(row: WeekReviewMindRow): boolean {
  return row.steps ? row.steps.length > 0 && row.steps.every((s) => s.done) : row.done === true;
}

export interface KeptTotal {
  kept: number;
  total: number;
}

/** One day's completion across everything it schedules — sessions, meal slots, mind rows alike —
 *  for the chip's ring. A rest day (`total === 0`) is for the caller to read as empty, not missed. */
export function dayCompletion(day: WeekReviewDay): KeptTotal {
  const kept =
    day.sessions.filter((s) => s.status === 'done').length +
    day.meals.filter((m) => m.logged).length +
    day.mind.filter(mindRowKept).length;
  const total = day.sessions.length + day.meals.length + day.mind.length;
  return { kept, total };
}

/** 7 days × 3 fixed slots (breakfast/lunch/dinner) — "17 of 21", never "4 missed". */
export function mealsRollup(days: WeekReviewDay[]): KeptTotal {
  return days.reduce(
    (acc, d) => ({ kept: acc.kept + d.meals.filter((m) => m.logged).length, total: acc.total + d.meals.length }),
    { kept: 0, total: 0 },
  );
}

export function sessionsRollup(days: WeekReviewDay[]): KeptTotal {
  return days.reduce(
    (acc, d) => ({
      kept: acc.kept + d.sessions.filter((s) => s.status === 'done').length,
      total: acc.total + d.sessions.length,
    }),
    { kept: 0, total: 0 },
  );
}

/** Absent entirely (`total === 0`) for a week with no mind/practice goal at all — the caller
 *  renders nothing rather than a false "0 of 0". */
export function mindsetRollup(days: WeekReviewDay[]): KeptTotal {
  return days.reduce(
    (acc, d) => ({ kept: acc.kept + d.mind.filter(mindRowKept).length, total: acc.total + d.mind.length }),
    { kept: 0, total: 0 },
  );
}
