/**
 * Goal guardrail (spec §6.2, §A1) — deterministic app code.
 *
 * Two distinct numbers, because goals are not uniform (a daily habit is cheap;
 * a 12-week training block is expensive):
 *
 *  1. HARD_ACTIVE_GOAL_CAP — an absolute ceiling on concurrent active goals,
 *     set by what the UX can manage (~50). The Coach can NEVER exceed it.
 *  2. COACH_FOCUS_BUDGET   — the soft "let's focus" threshold that triggers the
 *     keep/park conversation. Expressed as a WEIGHTED LOAD, not a raw count, and
 *     the Coach proposes the working number within bounds. Budget = 6 so a common,
 *     healthy starting set fits: one movement target/race (load 3) plus a few gentle
 *     mind/practice habits (load 1 each). The broadened brand ("a rhythm you can keep")
 *     is about holding several life areas at once — a 4-budget tripped on a race + two
 *     habits, which read as discouraging at the moment of commitment. 6 still catches
 *     real sprawl (e.g. two races + a couple nutrition targets = load 10).
 */
import type { Goal } from '@cadence/shared';

export const HARD_ACTIVE_GOAL_CAP = 50;
export const COACH_FOCUS_BUDGET_DEFAULT = 6;

/**
 * Per-goal cognitive/effort load, priced PER AREA so the focus budget stays honest
 * across domains: three contemplative practices are not three marathon blocks.
 */
export function goalLoad(goal: Pick<Goal, 'area' | 'type'>): number {
  if (goal.area === 'mind' || goal.area === 'practice') return 1;
  if (goal.type === 'recurring') return 2;
  return 3; // movement/nourishment milestone or target — training blocks, races
}

const ACTIVE_STATUSES = new Set<Goal['status']>(['captured', 'confirmed', 'committed']);

export function activeGoals<T extends Pick<Goal, 'status'>>(goals: T[]): T[] {
  return goals.filter((g) => ACTIVE_STATUSES.has(g.status));
}

export interface GuardrailVerdict {
  activeCount: number;
  weightedLoad: number;
  /** Hard stop — lock is gated until the user parks/abandons some goals. */
  exceedsHardCap: boolean;
  /** Soft — show the "Let's focus" keep/park state and let the Coach advise. */
  overFocusBudget: boolean;
}

export function evaluateGuardrail(
  goals: Array<Pick<Goal, 'area' | 'type' | 'status'>>,
  focusBudget: number = COACH_FOCUS_BUDGET_DEFAULT,
): GuardrailVerdict {
  const active = activeGoals(goals);
  const weightedLoad = active.reduce((sum, g) => sum + goalLoad(g), 0);
  return {
    activeCount: active.length,
    weightedLoad,
    exceedsHardCap: active.length > HARD_ACTIVE_GOAL_CAP,
    overFocusBudget: weightedLoad > focusBudget,
  };
}
