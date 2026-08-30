/**
 * Recap persistence's own pure half (Progress Engine W2-1, docs/cadence/PROGRESS-ENGINE.md "Check-in
 * unification") — same "code computes, no AI here" stance week-review-facts.ts states for the review
 * grid itself. `buildRecapFacts` reduces a `WeekReviewFacts` week (plus an optional weigh-in trend
 * read) down to the COMPACT snapshot cadence.recaps stores; `buildFactsLine` turns that snapshot into
 * the deterministic one-liner the rail shows ("showed up 4 of 5 · 19 of 21 meals · -0.4 lb").
 *
 * PURE — no DB, no clock. The caller (routes/week-review.ts) does the reading; this file only shapes
 * what it read. Kept that way for the same reason week-review-diff.ts is pure: a function nobody can
 * unit-test without mocking the world is exactly the failure mode to avoid here.
 */
import type { WeekReviewFacts } from './week-review-facts.ts';

/** Not exported/shared elsewhere either (progress.ts, calibration.ts, weigh-in.ts each keep their
 *  own copy) — a plain numeric constant, not a date/window helper, so duplicating it here follows
 *  the same house style rather than inventing a new shared module for one number. */
const LB_PER_KG = 2.2046226218;

export interface RecapWeighIn {
  /** Signed kg/week — negative is losing. Stored in kg regardless of display unit so the raw
   *  number never needs re-deriving if a unit preference changes later. */
  delta_kg: number;
  /** The user's display unit AT CONFIRM TIME — `facts_line` was already rendered in it. */
  unit: 'kg' | 'lb';
}

/** The compact snapshot `cadence.recaps.facts` stores — deliberately not the full day-by-day grid
 *  `WeekReviewFacts` carries (that stays derived-on-read for the review sheet itself). */
export interface RecapFacts {
  sessions: { kept: number; scheduled: number };
  meals: { logged: number; total: number };
  /** Null when there isn't enough weigh-in history yet to trust a trend (see weight-trend.ts's own
   *  "not enough to trust" rule) — omitted from `facts_line` rather than guessed. */
  weigh_in: RecapWeighIn | null;
}

const round1 = (n: number): number => Math.round(n * 10) / 10;

/**
 * `WeekReviewFacts` → the compact snapshot. `weeklyRateKg` is whatever the caller already measured
 * (weight-trend.ts's `smoothedWeeklyRate`, filtered to weigh-ins on/before the reviewed week) —
 * this function only reshapes it, it does not compute it.
 */
export function buildRecapFacts(facts: WeekReviewFacts, weeklyRateKg: number | null, unit: 'kg' | 'lb'): RecapFacts {
  const sessions = facts.days.flatMap((d) => d.sessions);
  const meals = facts.days.flatMap((d) => d.meals);
  return {
    sessions: {
      kept: sessions.filter((s) => s.status === 'done').length,
      scheduled: sessions.length,
    },
    meals: {
      logged: meals.filter((m) => m.logged).length,
      total: meals.length,
    },
    weigh_in: weeklyRateKg === null ? null : { delta_kg: round1(weeklyRateKg), unit },
  };
}

/**
 * The deterministic one-liner ("showed up 4 of 5 · 19 of 21 meals · -0.4 lb") — tabular parts
 * omitted when absent (nothing scheduled, no meal slots materialized, no trustable weigh-in trend
 * yet). Counts what happened, never what broke: no "adherence"/"streak", and the weight delta is a
 * plain signed number, not a verdict, so a maintain-weight goal reads it exactly as neutrally as a
 * loss or gain goal does (BRAND.md).
 */
export function buildFactsLine(recap: RecapFacts): string {
  const parts: string[] = [];
  if (recap.sessions.scheduled > 0) {
    parts.push(`showed up ${recap.sessions.kept} of ${recap.sessions.scheduled}`);
  }
  if (recap.meals.total > 0) {
    parts.push(`${recap.meals.logged} of ${recap.meals.total} meals`);
  }
  if (recap.weigh_in) {
    const { delta_kg, unit } = recap.weigh_in;
    const value = unit === 'lb' ? delta_kg * LB_PER_KG : delta_kg;
    const rounded = round1(value);
    const sign = rounded > 0 ? '+' : rounded < 0 ? '-' : '';
    parts.push(`${sign}${Math.abs(rounded)} ${unit}`);
  }
  return parts.length > 0 ? parts.join(' · ') : 'nothing logged this week';
}
