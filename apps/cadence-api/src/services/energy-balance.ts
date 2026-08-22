/**
 * A23 §3 — what maintenance actually is, in the units this user's ledger keeps.
 *
 * The owner's insight, and the whole reason Phase 1 came first: "the consistency is more important
 * than the accuracy… the magic will come in adjusting your weight by creating a calorie deficit
 * based on PERCEIVED calorie consumption, not in accurate calculations — those really are a red
 * herring."
 *
 * He is right, and it is worth stating why in code rather than only in a doc. If a ledger prices
 * every meal 20% under the truth, the arithmetic below simply learns a maintenance that is 20%
 * under the truth too, and a deficit measured against it produces exactly the intended weight
 * change. Systematic bias CANCELS. What does not cancel is variance: if the same lunch costs 600
 * kcal one day and 900 the next, the mean is noise and no deficit computed from it means anything.
 * That is why pinned prices (§1a) are a hard prerequisite for this file, and why it refuses to
 * answer rather than guess when the evidence is thin.
 *
 * Pure: no DB, no AI, no clock. Every date arrives as a string.
 */
import { safeWeeklyKg, smoothedWeeklyRate, trendConfidence, type WeighPoint } from './weight-trend.ts';

/**
 * Energy in a kilogram of body mass. ~7,700 kcal is the conventional figure for mixed tissue; it
 * is an approximation and everyone in this field knows it. It does not need to be exact here: it
 * is a scale factor applied to BOTH sides of the loop, so an error in it is another systematic
 * bias that calibrates out.
 */
export const KCAL_PER_KG = 7700;

/** Below this, a day's log is a snack someone forgot to finish, not a day's eating. */
export const COMPLETE_DAY_MIN_KCAL = 800;

const WINDOW_DAYS = 28;
const MIN_WINDOW_DAYS = 21;
/** Share of the window that must be properly logged before the mean means anything. */
const MIN_COMPLETE_RATIO = 0.6;
const MIN_WEIGH_INS = 3;
const MIN_WEIGH_SPAN_DAYS = 14;

export interface IntakeDay {
  date: string;
  kcal: number;
  /** Non-provisional logs clearing the floor — the only days the mean divides by. */
  complete: boolean;
}

export interface MaintenanceRead {
  /** Maintenance IN LEDGER UNITS — comparable to what this app counts, not to a lab. */
  maintenance_kcal: number;
  mean_intake_kcal: number;
  kg_per_week: number;
  complete_days: number;
  window_days: number;
  confidence: 'low' | 'medium' | 'high';
}

const daysBetween = (a: string, b: string): number => (Date.parse(b) - Date.parse(a)) / 86_400_000;

/** Why an answer could not be given — surfaced so the UI can say "not yet" and mean it. */
export type MaintenanceBlocker = 'window_too_short' | 'not_enough_logged_days' | 'not_enough_weigh_ins';

export interface MaintenanceResult {
  read: MaintenanceRead | null;
  blocker: MaintenanceBlocker | null;
  /** How far along the gates are, so a panel can show progress rather than a closed door. */
  complete_days: number;
  complete_days_needed: number;
}

/**
 * Implied maintenance from the two things we actually observe: what the ledger says they ate, and
 * what the scale says happened.
 *
 *   intake − maintenance = energy stored, and energy stored = KCAL_PER_KG × Δkg
 *   ⇒ maintenance = mean_intake − (KCAL_PER_KG × kg_per_week) / 7
 *
 * Losing weight makes `kg_per_week` negative, which RAISES the implied maintenance — they were
 * eating under it, so it must be above what they ate. That sign is the one thing in this file
 * worth checking twice, and it has its own test.
 */
export function impliedMaintenance(
  days: IntakeDay[],
  weights: WeighPoint[],
  windowDays = WINDOW_DAYS,
): MaintenanceResult {
  const completeDaysNeeded = Math.ceil(windowDays * MIN_COMPLETE_RATIO);
  const complete = days.filter((d) => d.complete && Number.isFinite(d.kcal) && d.kcal >= COMPLETE_DAY_MIN_KCAL);
  const nothing = (blocker: MaintenanceBlocker): MaintenanceResult => ({
    read: null,
    blocker,
    complete_days: complete.length,
    complete_days_needed: completeDaysNeeded,
  });

  if (windowDays < MIN_WINDOW_DAYS) return nothing('window_too_short');
  if (complete.length < completeDaysNeeded) return nothing('not_enough_logged_days');

  const pts = weights.filter((p) => Number.isFinite(p.kg) && p.kg > 0).sort((a, b) => a.date.localeCompare(b.date));
  if (pts.length < MIN_WEIGH_INS) return nothing('not_enough_weigh_ins');
  if (daysBetween(pts[0]!.date, pts[pts.length - 1]!.date) < MIN_WEIGH_SPAN_DAYS) {
    return nothing('not_enough_weigh_ins');
  }
  const rate = smoothedWeeklyRate(weights, windowDays);
  if (rate === null) return nothing('not_enough_weigh_ins');

  const meanIntake = complete.reduce((a, d) => a + d.kcal, 0) / complete.length;
  const maintenance = meanIntake - (KCAL_PER_KG * rate) / 7;

  // A maintenance outside human range means the inputs disagree violently (a mis-logged week, a
  // scale in the wrong units). Refusing is better than prescribing from it.
  if (!Number.isFinite(maintenance) || maintenance < 1000 || maintenance > 6000) {
    return nothing('not_enough_weigh_ins');
  }

  return {
    read: {
      maintenance_kcal: Math.round(maintenance / 10) * 10,
      mean_intake_kcal: Math.round(meanIntake),
      kg_per_week: Math.round(rate * 100) / 100,
      complete_days: complete.length,
      window_days: windowDays,
      confidence: combineConfidence(complete.length, windowDays, trendConfidence(weights, windowDays)),
    },
    blocker: null,
    complete_days: complete.length,
    complete_days_needed: completeDaysNeeded,
  };
}

/** The estimate is only as good as its WEAKER half — thin logging and a thin scale both cap it. */
function combineConfidence(
  completeDays: number,
  windowDays: number,
  weight: 'none' | 'low' | 'medium' | 'high',
): 'low' | 'medium' | 'high' {
  const ratio = completeDays / windowDays;
  const food = ratio >= 0.85 ? 'high' : ratio >= 0.7 ? 'medium' : 'low';
  const rank = { none: 0, low: 0, medium: 1, high: 2 } as const;
  const worst = Math.min(rank[food], rank[weight]);
  return worst === 2 ? 'high' : worst === 1 ? 'medium' : 'low';
}

/**
 * The daily target that produces the safe rate of change, expressed in the same ledger units as
 * `maintenance_kcal`. Deliberately arithmetic rather than a model's opinion: once maintenance is
 * known, the target is subtraction, and asking a model to do subtraction is how variance gets
 * back in (§1a's lesson, applied one layer up).
 */
export function targetForSafePace(
  maintenanceKcal: number,
  currentKg: number,
  direction: 'lose' | 'gain' | 'hold',
): number {
  if (direction === 'hold') return Math.round(maintenanceKcal / 10) * 10;
  const perDay = (KCAL_PER_KG * safeWeeklyKg(currentKg)) / 7;
  const raw = direction === 'lose' ? maintenanceKcal - perDay : maintenanceKcal + perDay;
  return Math.round(raw / 10) * 10;
}

/** A record of adaptive kcal moves, kept so the loop cannot ratchet someone downward forever. */
export interface TargetAdjustment {
  date: string;
  from: number;
  to: number;
}

/** No more than this much cumulative CUT inside the rolling window, however the maths argues. */
export const RATCHET_WINDOW_DAYS = 28;
export const RATCHET_MAX_CUT_KCAL = 300;
/** Never propose below this share of implied maintenance — the old prompt's "~15%", in code. */
export const MAINTENANCE_FLOOR_RATIO = 0.85;

export interface ClampContext {
  current_kcal: number | null;
  maintenance_kcal: number | null;
  adjustments: TargetAdjustment[];
  today: string;
}

export interface ClampedTarget {
  kcal: number;
  /** Set when a guardrail moved the number, so the UI can say why rather than silently differ. */
  limited_by: 'maintenance_floor' | 'ratchet' | null;
}

/**
 * The guardrails, moved out of prompt prose and into code (A23 §3).
 *
 * "Never more than ~15% below maintenance" was a sentence in the `nutrition_baseline` prompt — a
 * rule a model was asked to remember. Now that maintenance is a number, it is enforceable, and a
 * rule that can be enforced should not be a request.
 *
 * The ratchet is the second one, and it exists for a failure mode calibration invites: a plateau
 * looks exactly like "the deficit is too small", so a loop that only ever subtracts will keep
 * subtracting. Capping cumulative cuts per four weeks turns the third cut into a CONVERSATION
 * instead of a smaller number.
 */
export function clampProposal(proposed: number, ctx: ClampContext): ClampedTarget {
  let kcal = Math.round(proposed / 10) * 10;
  let limited: ClampedTarget['limited_by'] = null;

  if (ctx.maintenance_kcal) {
    const floor = Math.round((ctx.maintenance_kcal * MAINTENANCE_FLOOR_RATIO) / 10) * 10;
    if (kcal < floor) {
      kcal = floor;
      limited = 'maintenance_floor';
    }
  }

  if (ctx.current_kcal && kcal < ctx.current_kcal) {
    const since = ctx.adjustments
      .filter((a) => daysBetween(a.date, ctx.today) <= RATCHET_WINDOW_DAYS && a.to < a.from)
      .reduce((sum, a) => sum + (a.from - a.to), 0);
    const remaining = Math.max(0, RATCHET_MAX_CUT_KCAL - since);
    const deepest = ctx.current_kcal - remaining;
    if (kcal < deepest) {
      kcal = Math.round(deepest / 10) * 10;
      limited = 'ratchet';
    }
  }

  return { kcal, limited_by: limited };
}
