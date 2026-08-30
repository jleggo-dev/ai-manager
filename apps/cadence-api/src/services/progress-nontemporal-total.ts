/**
 * `total` — presence, not slope ("340 minutes sat", "31,200 words"), docs/cadence/PROGRESS-ENGINE.md
 * W1-5. Value + unit come from counted log units — the SAME `get_practice_totals` computation the
 * coach tool uses (services/practice-totals.ts), never a re-derivation.
 *
 * Binding note (contract friction — see the parcel's final report): there is no direct FK from a
 * Goal to the activity title(s) that produced its practice totals, so this resolver matches a
 * goal to its total by `goal.measure.unit` against the totals' `metric` key (the totals are
 * metric-agnostic by design — see practice-totals.ts), falling back to an activity-title match.
 */
import type { Goal, TotalPayload, WidgetOmission } from '@cadence/shared';
import { getGoal } from '../repos/goals.ts';
import { computePracticeTotals, type PracticeTotal } from './practice-totals.ts';
import { omit } from './progress-window.ts';

const round1 = (n: number) => Math.round(n * 10) / 10;

/** Pure: pick the practice total this goal's counted unit points at. */
export function resolveTotal(goal: Goal, totals: PracticeTotal[], windowLabel: string): TotalPayload | WidgetOmission {
  const unit = (goal.measure?.unit ?? '').trim();
  const normalized = unit.toLowerCase();
  const match =
    totals.find((t) => t.metric.replace(/_/g, ' ').toLowerCase() === normalized) ??
    totals.find((t) => t.title === goal.title);
  if (!match) return omit(`total:${goal.goal_id}`, 'total', 'no logged practice totals matching this goal');
  return { value: round1(match.total), unit: unit || match.metric.replace(/_/g, ' '), window_label: windowLabel };
}

/** Fetch + resolve for one user's goal + window (window expressed as a trailing day count —
 *  practice totals are days-keyed; see progress-window.ts's WindowRange.days). */
export async function getTotal(
  userId: string,
  goalId: string,
  windowDays: number,
  windowLabel: string,
): Promise<TotalPayload | WidgetOmission> {
  const goal = await getGoal(userId, goalId);
  if (!goal) return omit(`total:${goalId}`, 'total', 'goal not found');
  const { totals } = await computePracticeTotals(userId, windowDays);
  return resolveTotal(goal, totals, windowLabel);
}
