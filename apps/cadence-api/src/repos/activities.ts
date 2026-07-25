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

/** Off-plan + episode-temp activities are excluded from the committed-rhythm summary list. */
export const NON_PLAN_CATEGORIES = new Set<string>([ADHOC_CATEGORY, EPISODE_CATEGORY]);

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
