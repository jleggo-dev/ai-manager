import { sql, json } from '../db/sql.ts';
import type { Activity } from '@cadence/shared';

export async function listActivities(planId: string): Promise<Activity[]> {
  return sql<Activity[]>`select * from cadence.activities where plan_id = ${planId}`;
}

/** Insert the activities for a plan (one statement each — jsonb schedule/target via json()). */
export async function insertActivities(
  userId: string,
  planId: string,
  activities: Partial<Activity>[],
): Promise<Activity[]> {
  const out: Activity[] = [];
  for (const a of activities) {
    const [row] = await sql<Activity[]>`
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
