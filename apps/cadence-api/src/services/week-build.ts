import { getActivePlan } from '../repos/plans.ts';
import { listActivities, NON_PLAN_CATEGORIES } from '../repos/activities.ts';
import { describeRecurrence } from './scheduling.ts';
import { commitActivities, type CommitResult } from './plan-synthesis.ts';
import { computeWeekState } from './plan-view.ts';
import type { Activity, PendingPlanActivity } from '@cadence/shared';

/**
 * Activity (the committed shape, `schedule: { recurrence, time_of_day, duration_min }`) →
 * PendingPlanActivity (the shape `commitActivities` actually reads its fields off — see
 * plan-synthesis.ts's own `proposed` mapping, which pulls `a.recurrence` / `a.time_of_day` /
 * `a.duration_min` flat, not nested). `cadence` is a display-only humanized string that
 * commitActivities never reads, but the field is required on the type, so it's computed anyway
 * for anything downstream that assumes a PendingPlanActivity is always display-ready.
 */
function toPendingPlanActivity(a: Activity): PendingPlanActivity {
  return {
    commitment_id: a.commitment_id,
    title: a.title,
    kind: a.kind,
    category: a.category,
    cadence: describeRecurrence(a.schedule?.recurrence ?? ''),
    recurrence: a.schedule?.recurrence ?? '',
    time_of_day: a.schedule?.time_of_day,
    duration_min: a.schedule?.duration_min,
    target: a.target,
    completion_source: a.completion_source,
    goal_id: a.goal_id,
    why: a.why ?? undefined,
    how_to: a.how_to ?? undefined,
    suggested: a.suggested,
  };
}

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
