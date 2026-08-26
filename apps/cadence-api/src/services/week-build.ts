import { getActivePlan } from '../repos/plans.ts';
import { listActivities, NON_PLAN_CATEGORIES } from '../repos/activities.ts';
import { commitActivities, type CommitResult } from './plan-synthesis.ts';
import { toPendingPlanActivity } from './plan-partial-apply.ts';
import { computeWeekState } from './plan-view.ts';

export interface WeekBuildResult {
  status: 'committed' | 'no_plan' | 'not_due';
  planId?: string;
  version?: number;
  activities?: number;
  occurrences?: number;
  note?: string;
}

/**
 * "Just build my week — I trust you" (DESIGN-check-in.md's skip path, and the copy rule that goes
 * with it: never "Skip", never "Not now" — this is trust, not dismissal). A COMMIT, not a
 * synthesis: no model call anywhere. The outgoing week's own activities are recommitted as the
 * next version UNCHANGED, which is exactly what makes this the safe low-friction default — nothing
 * about the plan itself changes, only the calendar rolls forward. `commitActivities` bumps
 * `plan.version`, re-materializes the next `DEFAULT_HORIZON_DAYS`, and fires its own
 * fire-and-forget session warm-up (plan-synthesis.ts) — all for free, the same as any other commit.
 *
 * Guard, both 409-shaped: no active plan to rebuild from, or the current week genuinely isn't over
 * yet (`checkin_due` false). "Just build my week" ends a week — it is never a way to skip ahead of
 * one that's still running.
 */
export async function buildNextWeek(userId: string): Promise<WeekBuildResult> {
  const plan = await getActivePlan(userId);
  if (!plan) return { status: 'no_plan' };

  const state = computeWeekState(plan);
  if (!state?.checkin_due) return { status: 'not_due' };

  // Off-plan/episode/menu buckets are derived per-version (getOrCreateAdhocActivity et al. lazily
  // recreate them against the NEW plan_id the moment they're next needed) — a normal replan never
  // carries them forward either, via the same filter buildPlanView already applies to its own list.
  const activities = (await listActivities(plan.plan_id)).filter(
    (a) => !a.category || !NON_PLAN_CATEGORIES.has(a.category),
  );

  const result: CommitResult = await commitActivities(userId, {
    activities: activities.map(toPendingPlanActivity),
    note: 'Kept your rhythm — building your next week.',
    goalIds: plan.goal_ids,
  });

  return {
    status: 'committed',
    planId: result.planId,
    version: result.version,
    activities: result.activities,
    occurrences: result.occurrences,
    note: result.note,
  };
}
