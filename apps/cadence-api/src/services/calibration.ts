/**
 * A23 §3 — the adaptive loop, closed at last.
 *
 * What existed before this file: a PACE controller. It compared the weigh-in trend to a safe rate
 * and asked a model to nudge the target by ±100–150 kcal — blind, because it never once looked at
 * what the user actually ate. It could say "you are losing slower than expected, trim something";
 * it could not say "your maintenance is 2,550 in the units this app counts, so here is the number."
 *
 * With the ledger pinning prices (§1a) the second sentence becomes computable, and once it is, the
 * TARGET IS ARITHMETIC: maintenance minus the deficit for a safe pace. That is worth stating
 * plainly, because it finishes the argument the whole project makes — a model was doing a job that
 * belonged to code, one layer up from where we started. `nutrition_baseline` still runs, and still
 * matters for the non-weight case and for the words; it no longer has to invent the number.
 *
 * Every number here is deterministic. The gates are deterministic. "Not yet" is a real answer and
 * is returned as one, with how far along the user is, so a panel can show progress rather than a
 * closed door.
 */
import type { NutritionLog } from '@cadence/shared';
import { listNutritionLogs } from '../repos/nutrition.ts';
import { listWeighInSeries } from '../repos/occurrences.ts';
import { listGoalsByStatus } from '../repos/goals.ts';
import { getUser } from '../repos/users.ts';
import {
  clampProposal,
  impliedMaintenance,
  targetForSafePace,
  type ClampedTarget,
  type IntakeDay,
  type MaintenanceBlocker,
  type MaintenanceRead,
  type TargetAdjustment,
} from './energy-balance.ts';

/** The window the calibration reads over — long enough for the scale to outvote a bad week. */
export const CALIBRATION_WINDOW_DAYS = 28;

const LB_PER_KG = 2.2046226218;
const WEIGHTY_UNIT = /\b(kg|lbs?|pounds?|weight)\b/i;

export type GoalDirection = 'lose' | 'gain' | 'hold';

export interface CalibrationRead {
  maintenance: MaintenanceRead | null;
  blocker: MaintenanceBlocker | null;
  complete_days: number;
  complete_days_needed: number;
  direction: GoalDirection;
  /** What the targets WOULD be. Suggested, never applied — the tap is still the consent. */
  proposed: ClampedTarget | null;
  current_kcal: number | null;
}

/**
 * One day's intake. `complete` means they logged something we trust that day — the plausibility
 * floor is applied downstream, so this stays a fact about logging rather than about portion size.
 */
export function groupDailyIntake(logs: NutritionLog[]): IntakeDay[] {
  const byDay = new Map<string, { kcal: number; complete: boolean }>();
  for (const log of logs) {
    const day = String(log.date).slice(0, 10);
    const row = byDay.get(day) ?? { kcal: 0, complete: false };
    if (!log.provisional && typeof log.macros?.kcal === 'number') {
      row.kcal += log.macros.kcal;
      row.complete = true;
    }
    byDay.set(day, row);
  }
  return [...byDay.entries()]
    .map(([date, v]) => ({ date, kcal: Math.round(v.kcal), complete: v.complete }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Which way they are trying to go, from the goal's own stated target.
 *
 * The target was captured in the user's own unit, so it is compared against their current weight
 * converted into that same unit — the mistake to avoid here is comparing 180 (lb) to 82 (kg) and
 * concluding somebody wants to gain forty kilos.
 */
export function goalDirection(
  goals: Array<{ type?: string; measure?: { unit?: string; target?: number | string } }>,
  currentKg: number | null | undefined,
): GoalDirection {
  if (typeof currentKg !== 'number' || !(currentKg > 0)) return 'hold';
  for (const g of goals) {
    const unit = (g.measure?.unit ?? '').trim();
    // A capture-era goal may carry its target as text ("180"); a number is what matters here.
    const target = typeof g.measure?.target === 'string' ? Number(g.measure.target) : g.measure?.target;
    if (g.type !== 'target' || typeof target !== 'number' || !Number.isFinite(target)) continue;
    if (!WEIGHTY_UNIT.test(unit)) continue;
    const currentInGoalUnit = /lb|pound/i.test(unit) ? currentKg * LB_PER_KG : currentKg;
    // A kilo either way is noise, not an intention.
    const slack = /lb|pound/i.test(unit) ? 2 : 1;
    if (target < currentInGoalUnit - slack) return 'lose';
    if (target > currentInGoalUnit + slack) return 'gain';
    return 'hold';
  }
  return 'hold';
}

/** Past adaptive moves, kept on macro_targets so the ratchet has a memory. */
function pastAdjustments(raw: unknown): TargetAdjustment[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(
      (a): a is TargetAdjustment =>
        !!a &&
        typeof (a as TargetAdjustment).date === 'string' &&
        typeof (a as TargetAdjustment).from === 'number' &&
        typeof (a as TargetAdjustment).to === 'number',
    )
    .slice(-20);
}

/**
 * The read: what maintenance is in this user's ledger units, and what the targets would be.
 *
 * Computes; never writes. Applying is `setTargets`, behind the user's tap, exactly as before.
 */
export async function getCalibration(
  userId: string,
  today = new Date().toISOString().slice(0, 10),
): Promise<CalibrationRead> {
  const todayMs = Date.parse(`${today}T00:00:00Z`);
  const from = new Date(todayMs - (CALIBRATION_WINDOW_DAYS - 1) * 86_400_000).toISOString().slice(0, 10);

  const [logs, weights, goals, user] = await Promise.all([
    listNutritionLogs(userId, from, today),
    listWeighInSeries(userId),
    listGoalsByStatus(userId, ['confirmed', 'committed']),
    getUser(userId),
  ]);

  const currentKg = user?.baseline?.weight_kg?.current ?? null;
  const targets = user?.macro_targets ?? null;
  const currentKcal = typeof targets?.kcal === 'number' ? targets.kcal : null;
  const direction = goalDirection(goals, currentKg);

  const result = impliedMaintenance(groupDailyIntake(logs), weights, CALIBRATION_WINDOW_DAYS);

  let proposed: ClampedTarget | null = null;
  if (result.read && typeof currentKg === 'number') {
    const raw = targetForSafePace(result.read.maintenance_kcal, currentKg, direction);
    proposed = clampProposal(raw, {
      current_kcal: currentKcal,
      maintenance_kcal: result.read.maintenance_kcal,
      adjustments: pastAdjustments((targets as Record<string, unknown> | null)?.adjustments),
      today,
    });
  }

  return {
    maintenance: result.read,
    blocker: result.blocker,
    complete_days: result.complete_days,
    complete_days_needed: result.complete_days_needed,
    direction,
    proposed,
    current_kcal: currentKcal,
  };
}
