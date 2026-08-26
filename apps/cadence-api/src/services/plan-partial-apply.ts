import { getActivePlan } from '../repos/plans.ts';
import { listActivities } from '../repos/activities.ts';
import { describeRecurrence } from './scheduling.ts';
import type { Activity, PendingPlanActivity } from '@cadence/shared';

/**
 * Activity (the committed shape, `schedule: { recurrence, time_of_day, duration_min }`) →
 * PendingPlanActivity (the shape `commitActivities` actually reads its fields off — see
 * plan-synthesis.ts's own `proposed` mapping, which pulls `a.recurrence` / `a.time_of_day` /
 * `a.duration_min` flat, not nested). `cadence` is a display-only humanized string that
 * commitActivities never reads, but the field is required on the type, so it's computed anyway
 * for anything downstream that assumes a PendingPlanActivity is always display-ready.
 *
 * One mapping, two callers (never two): week-build.ts's `buildNextWeek` (recommitting an
 * unchanged week) and `resolveToggledActivities` below (reverting a declined edit to the
 * commitment's current version).
 */
export function toPendingPlanActivity(a: Activity): PendingPlanActivity {
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

/**
 * Resolve a proposal's per-item toggles into what `commitActivities` should actually receive.
 *
 * `commitActivities` treats its `activities` array as the COMPLETE next plan version — anything
 * absent is deleted from the plan (plan-synthesis.ts). So a toggled-OFF item must never simply be
 * filtered out of the array handed to it:
 *
 *   - disabled WITH a `commitment_id` → substituted with that commitment's CURRENT activity from
 *     the still-active plan — read here, before this commit supersedes it — mapped back to
 *     PendingPlanActivity shape via `toPendingPlanActivity`. "Keep doing it the old way."
 *   - disabled WITHOUT a `commitment_id` (a pure add) → dropped. Declining an add means it never
 *     existed; there is no "old version" of something that was never committed.
 *   - a commitment_id that no longer matches anything in the active plan (a race: it was removed
 *     by another edit between proposal and apply) → also dropped, for the same reason as a pure
 *     add — there is nothing left to revert TO.
 *
 * Enabled items — including every item when `enabled` is absent, the default for every flow that
 * predates this field — pass through untouched. The common case, nothing disabled, never reads
 * the active plan at all and returns the very same array reference it was given.
 */
export async function resolveToggledActivities(
  userId: string,
  activities: PendingPlanActivity[],
): Promise<PendingPlanActivity[]> {
  if (!activities.some((a) => a.enabled === false)) return activities;

  const active = await getActivePlan(userId);
  const current = active ? await listActivities(active.plan_id) : [];
  const byCommitmentId = new Map(current.map((a) => [a.commitment_id, a] as const));

  const resolved: PendingPlanActivity[] = [];
  for (const a of activities) {
    if (a.enabled !== false) {
      resolved.push(a);
      continue;
    }
    if (!a.commitment_id) continue; // a declined add never existed
    const currentVersion = byCommitmentId.get(a.commitment_id);
    if (currentVersion) resolved.push(toPendingPlanActivity(currentVersion));
    // else: the commitment vanished from the active plan since the proposal was made — nothing
    // to revert to, so it's dropped rather than committing a version of something gone.
  }
  return resolved;
}
