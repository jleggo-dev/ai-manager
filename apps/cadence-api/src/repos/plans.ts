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

/**
 * The newest version the COACH built (any status) — the rhythm's own birthday, as opposed to the
 * active version's. Apply and roll-forward commits supersede a plan without redesigning it, so the
 * monthly rebuild checkpoint (situation.ts) measures from this row, not from `getActivePlan`.
 */
export async function getLatestCoachBuild(userId: string, db: SqlExecutor = sql): Promise<Plan | null> {
  const [row] = await db<Plan[]>`
    select * from cadence.plans
    where user_id = ${userId} and generated_by = 'coach'
    order by version desc limit 1`;
  return row ?? null;
}

/**
 * `week_started_at` (0058): the week clock. Omitted/null → `now()`, i.e. this version STARTS a
 * week (a first-ever plan, or one of the two check-in exits). `commitActivities` passes the
 * superseded version's value for every ordinary commit so the week keeps running — see
 * services/week-clock.ts for why `generated_at` could never be that clock.
 */
export async function insertPlan(userId: string, plan: Partial<Plan>, db: SqlExecutor = sql): Promise<Plan> {
  const [row] = await db<Plan[]>`
    insert into cadence.plans (user_id, goal_ids, generated_by, version, status, rationale, steer, week_started_at)
    values (
      ${userId}, ${plan.goal_ids ?? []}::uuid[], ${plan.generated_by ?? 'coach'},
      ${plan.version ?? 1}, ${plan.status ?? 'active'}, ${plan.rationale ?? null}, ${plan.steer ?? null},
      coalesce(${plan.week_started_at ?? null}::timestamptz, now())
    )
    returning *`;
  if (!row) throw new Error('insertPlan: no row returned');
  return row;
}

/**
 * Start the ACTIVE plan's week over from now (0058) — the check-in exit that performs no commit:
 * "Confirm my week" with nothing to change. The wall on the trail (`checkin_due`) clears the
 * moment this lands, the same as it would after "Just build my week". Returns whether there was
 * an active plan to reset. Never called by "Not now"/dismiss — a card put away is not a week done.
 */
export async function restartActiveWeek(userId: string, db: SqlExecutor = sql): Promise<boolean> {
  const rows = await db<{ plan_id: string }[]>`
    update cadence.plans set week_started_at = now()
    where user_id = ${userId} and status = 'active'
    returning plan_id`;
  return rows.length > 0;
}

/** Mark all of a user's active plans superseded (call before committing a new version). */
export async function supersedeActivePlans(userId: string, db: SqlExecutor = sql): Promise<void> {
  await db`update cadence.plans set status = 'superseded' where user_id = ${userId} and status = 'active'`;
}

/** Set how many days a plan's week runs (0050) — written only by `extendHorizon`, which owns the
 *  guardrails; a fresh commit just takes the column default of 7. */
export async function setPlanHorizon(planId: string, horizonDays: number, db: SqlExecutor = sql): Promise<void> {
  await db`update cadence.plans set horizon_days = ${horizonDays} where plan_id = ${planId}`;
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
