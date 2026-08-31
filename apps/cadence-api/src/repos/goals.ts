import { sql, json } from '../db/sql.ts';
import type { Goal, GoalStatus } from '@cadence/shared';

/**
 * The goal statuses Progress draws from (services/progress.ts, routes/progress-layout.ts's
 * default layout) — deliberately WIDER than what feeds a plan build. A retired ('parked') goal
 * stops shaping the week from its next build (see lock.ts/replan.ts, which pass their own
 * narrower lists and never include 'parked'), but "everything it built — the 5k, the grip work —
 * stays in Progress" (Settings Room SR-1 copy): its cards and history keep reading exactly as
 * they did the moment before it was set aside. Named and shared so the two call sites that must
 * agree on this can't drift apart the way a repeated comment would let them.
 */
export const PROGRESS_GOAL_STATUSES: GoalStatus[] = ['confirmed', 'committed', 'parked'];

export async function listGoals(userId: string): Promise<Goal[]> {
  return sql<Goal[]>`select * from cadence.goals where user_id = ${userId}`;
}

/** Oldest first — capture's duplicate-folding picks a survivor by age, so the order is load-bearing. */
export async function listGoalsByStatus(userId: string, statuses: GoalStatus[]): Promise<Goal[]> {
  return sql<Goal[]>`
    select * from cadence.goals
    where user_id = ${userId} and status = any(${statuses})
    order by created_at asc`;
}

export async function getGoal(userId: string, goalId: string): Promise<Goal | null> {
  const [row] = await sql<Goal[]>`
    select * from cadence.goals where user_id = ${userId} and goal_id = ${goalId} limit 1`;
  return row ?? null;
}

/** Insert a Broker-captured goal (status defaults to 'captured'; linked_equipment → DB default). */
export async function insertGoal(userId: string, goal: Partial<Goal>): Promise<Goal> {
  const [row] = await sql<Goal[]>`
    insert into cadence.goals (user_id, title, brief, area, type, measure, timeframe, milestones, status, source, confidence)
    values (
      ${userId}, ${goal.title ?? ''}, ${goal.brief ?? null}, ${goal.area ?? 'practice'}, ${goal.type ?? 'milestone'},
      ${json(goal.measure ?? {})}, ${json(goal.timeframe ?? {})}, ${json(goal.milestones ?? [])},
      ${goal.status ?? 'captured'}, ${goal.source ?? 'captured'}, ${goal.confidence ?? null}
    )
    returning *`;
  if (!row) throw new Error('insertGoal: no row returned');
  return row;
}

/** Clear goals in a given status (used to replace pre-confirmation 'captured' goals). */
export async function deleteGoalsByStatus(userId: string, status: GoalStatus): Promise<void> {
  await sql`delete from cadence.goals where user_id = ${userId} and status = ${status}`;
}

/** User edit from the review wizard — update the editable fields (null keeps existing). */
export async function updateGoal(userId: string, goalId: string, f: Partial<Goal>): Promise<void> {
  await sql`
    update cadence.goals set
      title = coalesce(${f.title ?? null}, title),
      brief = coalesce(${f.brief ?? null}, brief),
      area = coalesce(${f.area ?? null}, area),
      type = coalesce(${f.type ?? null}, type),
      measure = coalesce(${f.measure ? json(f.measure) : null}, measure),
      timeframe = coalesce(${f.timeframe ? json(f.timeframe) : null}, timeframe),
      milestones = coalesce(${f.milestones ? json(f.milestones) : null}, milestones),
      plan_mode = coalesce(${f.plan_mode ?? null}, plan_mode),
      updated_at = now()
    where user_id = ${userId} and goal_id = ${goalId}`;
}

/** User reject from the review wizard. */
export async function deleteGoal(userId: string, goalId: string): Promise<void> {
  await sql`delete from cadence.goals where user_id = ${userId} and goal_id = ${goalId}`;
}

export async function setGoalStatus(userId: string, goalId: string, status: GoalStatus): Promise<void> {
  await sql`
    update cadence.goals set status = ${status}, updated_at = now()
    where user_id = ${userId} and goal_id = ${goalId}`;
}

/**
 * Retire a goal (Settings' "Retire", or the coach's own update_goal action): parks it and
 * remembers what it was, so a restore can put it back exactly where it left off. A no-op
 * (returns null) on a goal that's already parked or doesn't belong to this user — retiring twice
 * must never overwrite a real prior_status with 'parked'.
 */
export async function retireGoal(userId: string, goalId: string): Promise<Goal | null> {
  const [row] = await sql<Goal[]>`
    update cadence.goals set
      prior_status = status,
      status = 'parked',
      updated_at = now()
    where user_id = ${userId} and goal_id = ${goalId} and status <> 'parked'
    returning *`;
  return row ?? null;
}

/**
 * Bring a retired goal back. Restores whatever status it held before parking; falls back to
 * 'confirmed' for a goal parked before prior_status existed. A no-op (returns null) on a goal
 * that isn't currently parked or doesn't belong to this user.
 */
export async function restoreGoal(userId: string, goalId: string): Promise<Goal | null> {
  const [row] = await sql<Goal[]>`
    update cadence.goals set
      status = coalesce(prior_status, 'confirmed'),
      prior_status = null,
      updated_at = now()
    where user_id = ${userId} and goal_id = ${goalId} and status = 'parked'
    returning *`;
  return row ?? null;
}
