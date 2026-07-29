import { sql, json, type SqlExecutor } from '../db/sql.ts';
import type { Activity } from '@cadence/shared';

export async function listActivities(planId: string): Promise<Activity[]> {
  return sql<Activity[]>`select * from cadence.activities where plan_id = ${planId}`;
}

/** Marks the per-plan "Off-plan" bucket activity that ad-hoc logs attach to. The plan view keeps
 *  activities with this category OUT of the committed-rhythm list while still showing their logged
 *  occurrences (they're things you did, not part of the plan you set). */
export const ADHOC_CATEGORY = 'adhoc';

/** Marks the temporary "do what you can" activities a disrupted episode adds (Req 4). Like the
 *  ad-hoc bucket, these are kept out of the committed-rhythm list; their occurrences (episode_id
 *  tagged) surface in the week as the episode's lighter options. */
export const EPISODE_CATEGORY = 'episode';

/** Marks the shop/cook tasks a saved week menu implies (food module). Like ad-hoc/episode, they're
 *  kept out of the committed-rhythm list — they're this week's derived chores, not your set rhythm —
 *  but their occurrences ride the trail. Cleared + re-created on each menu save (see menu-tasks.ts). */
export const MENU_TASK_CATEGORY = 'menu';

/** Off-plan + episode-temp + menu-derived activities are excluded from the committed-rhythm list. */
export const NON_PLAN_CATEGORIES = new Set<string>([ADHOC_CATEGORY, EPISODE_CATEGORY, MENU_TASK_CATEGORY]);

/** Delete a plan's activities of one category, and their occurrences first (no FK-cascade assumed).
 *  Backs the idempotent re-save of menu-derived shop/cook tasks. */
export async function deleteActivitiesByCategory(userId: string, planId: string, category: string): Promise<void> {
  await sql`
    delete from cadence.occurrences
    where user_id = ${userId}
      and activity_id in (
        select activity_id from cadence.activities
        where user_id = ${userId} and plan_id = ${planId} and category = ${category}
      )`;
  await sql`
    delete from cadence.activities
    where user_id = ${userId} and plan_id = ${planId} and category = ${category}`;
}

/**
 * Find (or lazily create) the per-plan "Off-plan" bucket activity. Ad-hoc logs need an activity to
 * hang on — `occurrences.activity_id` is NOT NULL — but they aren't scheduled, so this is a `system`
 * activity with an empty schedule (never materialized by ensureHorizon). Idempotent per (user,
 * plan); a rare double-submit could create two, which is harmless (both are valid buckets).
 */
export async function getOrCreateAdhocActivity(userId: string, planId: string): Promise<Activity> {
  const [existing] = await sql<Activity[]>`
    select * from cadence.activities
    where user_id = ${userId} and plan_id = ${planId} and kind = 'system' and category = ${ADHOC_CATEGORY}
    limit 1`;
  if (existing) return existing;
  // Empty recurrence ⇒ ensureHorizon never materializes it (it only expands non-empty recurrences),
  // so the bucket exists solely to carry on-demand ad-hoc occurrences.
  const [row] = await insertActivities(userId, planId, [
    { title: 'Off-plan', kind: 'system', category: ADHOC_CATEGORY, schedule: { recurrence: '' } },
  ]);
  if (!row) throw new Error('getOrCreateAdhocActivity: insert failed');
  return row;
}

/** Fetch one of the user's activities by id (ownership-checked); null if it isn't theirs. Backs the
 *  goal-aware "log something you did" FAB, which credits the REAL planned activity by title (so it
 *  counts toward that goal's progression) rather than the generic off-plan bucket. */
export async function getUserActivity(userId: string, activityId: string): Promise<Activity | null> {
  const [row] = await sql<Activity[]>`
    select * from cadence.activities where user_id = ${userId} and activity_id = ${activityId} limit 1`;
  return row ?? null;
}

/** Insert the activities for a plan (one statement each — jsonb schedule/target via json()). */
export async function insertActivities(
  userId: string,
  planId: string,
  activities: Partial<Activity>[],
  db: SqlExecutor = sql, // the sql.begin() tx handle when called inside commitActivities' transaction
): Promise<Activity[]> {
  const out: Activity[] = [];
  for (const a of activities) {
    const [row] = await db<Activity[]>`
      insert into cadence.activities
        (user_id, plan_id, goal_id, title, kind, category, schedule, target, completion_source, why, how_to)
      values (
        ${userId}, ${planId}, ${a.goal_id ?? null}, ${a.title ?? ''}, ${a.kind ?? 'user'}, ${a.category ?? null},
        ${json(a.schedule ?? {})}, ${a.target ? json(a.target) : null},
        ${a.completion_source ?? 'self_report'}, ${a.why ?? null}, ${a.how_to ?? null}
      )
      returning *`;
    if (row) out.push(row);
  }
  return out;
}
