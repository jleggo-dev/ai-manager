/* ════════════════════════════════════════════════════════════════
   Points / reward engine (REQ8) — habit-first, redeemable for freezes
   ════════════════════════════════════════════════════════════════ */

/**
 * Points reward the brand promise — *building better habits* — not raw output. Four composable,
 * tunable sources (owner steer):
 *   1. per completed task            — the redesign's "+10" on a finished task
 *   2. a **completed day**           — a bonus when every task that was due got done
 *   3. **weekly active minutes**     — earned even if not everything is done (showing up counts)
 *   4. **streak length**             — a small daily bonus that scales with the run you're on
 * Points are then **redeemable for streak freezes**, so effort banked on good weeks buys
 * protection for a bad one — the same "life happens, momentum shouldn't reset" posture as Req 4.
 *
 * Pure + forward-only, like `metrics.ts`/`progression.ts` — no DB, no clock. `advancePoints` folds
 * finalized (past) days into the persisted `PointsState`; `last_evaluated` makes re-runs on an
 * unchanged tail a no-op (idempotent). Weekly-minute points are awarded at the week boundary via
 * `pointsForWeekMinutes`, separately from the daily fold, so the two never double-count. See
 * docs/cadence/REQ8.
 */

import type { PointsState } from '@cadence/shared';

export type { PointsState };

/** Reward knobs. Defaults are a starting calibration, meant to be tuned against real data. */
export interface PointsParams {
  /** Base points for each completed task (the design's per-task reward). */
  perTask: number;
  /** Bonus when a day's due tasks are ALL done (a "complete day"). */
  dayCompleteBonus: number;
  /** 1 point per this many active minutes logged in a week (regardless of completion). */
  minutesPerPoint: number;
  /** Daily streak bonus = min(streak length, this cap) — longer runs earn a little more, bounded. */
  streakDayBonusCap: number;
  /** Points to redeem one streak freeze. */
  freezeCost: number;
}

export const DEFAULT_POINTS_PARAMS: PointsParams = {
  perTask: 10,
  dayCompleteBonus: 20,
  minutesPerPoint: 10,
  streakDayBonusCap: 10,
  freezeCost: 100,
};

export function initialPointsState(): PointsState {
  return { balance: 0, lifetime: 0, last_evaluated: null };
}

/** One finalized day's inputs to the reward fold. `streakAfter` is the streak length as of the end
 *  of this day (from `advanceStreak`), so the streak bonus and the streak stay in lock-step. */
export interface DayPoints {
  date: string; // YYYY-MM-DD
  tasksDone: number; // completed occurrences that day
  tasksDue: number; // occurrences that carried a real obligation that day
  streakAfter: number; // streak length through this day
}

/** The habit bonus: a longer streak earns a little more each day, capped so it can't run away. */
export function streakDayBonus(streakAfter: number, params: PointsParams = DEFAULT_POINTS_PARAMS): number {
  return Math.max(0, Math.min(Math.floor(streakAfter), params.streakDayBonusCap));
}

/** Points earned on one finalized day: per-task base + a completed-day bonus + the streak bonus. */
export function pointsForDay(day: DayPoints, params: PointsParams = DEFAULT_POINTS_PARAMS): number {
  const base = params.perTask * Math.max(0, day.tasksDone);
  const complete = day.tasksDue > 0 && day.tasksDone >= day.tasksDue ? params.dayCompleteBonus : 0;
  return base + complete + streakDayBonus(day.streakAfter, params);
}

/** Points for a week's active minutes — effort, not completion (even a partial week earns). */
export function pointsForWeekMinutes(activeMinutes: number, params: PointsParams = DEFAULT_POINTS_PARAMS): number {
  return Math.floor(Math.max(0, activeMinutes) / params.minutesPerPoint);
}

/**
 * Fold finalized days into the wallet. Pure and forward-only: the caller passes only days strictly
 * after `prior.last_evaluated`, so re-running on an unchanged tail is a no-op. Weekly-minute points
 * are NOT folded here (see `pointsForWeekMinutes`) — they're added once at the week boundary.
 */
export function advancePoints(
  prior: PointsState,
  days: DayPoints[],
  params: PointsParams = DEFAULT_POINTS_PARAMS,
): PointsState {
  const s: PointsState = { ...prior };
  for (const day of days) {
    const earned = pointsForDay(day, params);
    s.balance += earned;
    s.lifetime += earned;
    s.last_evaluated = day.date;
  }
  return s;
}

export interface RedeemResult {
  ok: boolean;
  reason?: 'insufficient_points' | 'freezes_full';
  balance: number;
  freezes: number;
}

/**
 * Spend `freezeCost` points to bank one freeze. Refuses when the wallet can't afford it or the
 * user is already at the freeze cap (over-banking is forfeited, matching the streak economy). Pure
 * — returns the would-be wallet + freeze count; the caller persists both together. `freezeCap`
 * comes from the caller's StreakParams so the two economies stay decoupled.
 */
export function redeemFreeze(
  balance: number,
  freezes: number,
  freezeCap: number,
  params: PointsParams = DEFAULT_POINTS_PARAMS,
): RedeemResult {
  if (freezes >= freezeCap) return { ok: false, reason: 'freezes_full', balance, freezes };
  if (balance < params.freezeCost) return { ok: false, reason: 'insufficient_points', balance, freezes };
  return { ok: true, balance: balance - params.freezeCost, freezes: freezes + 1 };
}
