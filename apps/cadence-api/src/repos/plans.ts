import { sql, type SqlExecutor } from '../db/sql.ts';
import type { Plan } from '@cadence/shared';

// These three participate in commitActivities' transaction, so each accepts an optional executor
// (`db`) — the module `sql` by default, or the `sql.begin()` transaction handle when committing
// atomically. Passing the tx handle is what makes supersede→insert→insert all-or-nothing (API-01).
export async function getActivePlan(userId: string, db: SqlExecutor = sql): Promise<Plan | null> {
  const [row] = await db<Plan[]>`
    select * from cadence.plans
    where user_id = ${userId} and status = 'active'
    order by version desc limit 1`;
  return row ?? null;
}

export async function insertPlan(userId: string, plan: Partial<Plan>, db: SqlExecutor = sql): Promise<Plan> {
  const [row] = await db<Plan[]>`
    insert into cadence.plans (user_id, goal_ids, generated_by, version, status, rationale)
    values (
      ${userId}, ${plan.goal_ids ?? []}::uuid[], ${plan.generated_by ?? 'coach'},
      ${plan.version ?? 1}, ${plan.status ?? 'active'}, ${plan.rationale ?? null}
    )
    returning *`;
  if (!row) throw new Error('insertPlan: no row returned');
  return row;
}

/** Mark all of a user's active plans superseded (call before committing a new version). */
export async function supersedeActivePlans(userId: string, db: SqlExecutor = sql): Promise<void> {
  await db`update cadence.plans set status = 'superseded' where user_id = ${userId} and status = 'active'`;
}

/**
 * When the user's FIRST plan was committed (min generated_at, any status — superseded rows are
 * kept forever, so this is stable). Drives the coach-session "onboarding graduation" staleness
 * rule: a conversation opened before this moment belongs to onboarding, not ongoing coaching.
 */
export async function getFirstPlanCommitAt(userId: string): Promise<string | null> {
  const [row] = await sql<{ first_at: string | null }[]>`
    select min(generated_at)::text as first_at from cadence.plans where user_id = ${userId}`;
  return row?.first_at ?? null;
}
