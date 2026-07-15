import { sql, json } from '../db/sql.ts';
import type { GoalEvent } from '@cadence/shared';

/** Record one accomplishment ("finished Dune"). goal_id optional — history outlives goals. */
export async function insertGoalEvent(
  userId: string,
  event: { goal_id?: string | null; kind?: GoalEvent['kind']; label: string; meta?: Record<string, unknown> },
): Promise<GoalEvent> {
  const [row] = await sql<GoalEvent[]>`
    insert into cadence.goal_events (user_id, goal_id, kind, label, meta)
    values (${userId}, ${event.goal_id ?? null}, ${event.kind ?? 'completion'}, ${event.label}, ${event.meta ? json(event.meta) : null})
    returning *`;
  if (!row) throw new Error('insertGoalEvent: no row returned');
  return row;
}

/** Newest-first events (History feed). `at` cast to text — postgres.js returns timestamptz as
 *  a JS Date otherwise, and the shared type (plus every consumer) expects an ISO string. */
export async function listGoalEvents(userId: string, limit = 30): Promise<GoalEvent[]> {
  return sql<GoalEvent[]>`
    select event_id, user_id, goal_id, kind, label, at::text as at, meta
    from cadence.goal_events where user_id = ${userId} order by at desc limit ${limit}`;
}

/** Completion count per goal — the "20/100 books" numerator. */
export async function countGoalCompletions(userId: string, goalId: string): Promise<number> {
  const [row] = await sql<{ n: string }[]>`
    select count(*) as n from cadence.goal_events
    where user_id = ${userId} and goal_id = ${goalId} and kind = 'completion'`;
  return Number(row?.n ?? 0);
}
