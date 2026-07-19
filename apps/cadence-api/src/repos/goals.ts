import { sql, json } from '../db/sql.ts';
import type { Goal, GoalStatus } from '@cadence/shared';

export async function listGoals(userId: string): Promise<Goal[]> {
  return sql<Goal[]>`select * from cadence.goals where user_id = ${userId}`;
}

export async function listGoalsByStatus(userId: string, statuses: GoalStatus[]): Promise<Goal[]> {
  return sql<Goal[]>`
    select * from cadence.goals
    where user_id = ${userId} and status = any(${statuses})`;
}

export async function getGoal(userId: string, goalId: string): Promise<Goal | null> {
  const [row] = await sql<Goal[]>`
    select * from cadence.goals where user_id = ${userId} and goal_id = ${goalId} limit 1`;
  return row ?? null;
}

/** Insert a Broker-captured goal (status defaults to 'captured'; linked_equipment → DB default). */
export async function insertGoal(userId: string, goal: Partial<Goal>): Promise<Goal> {
  const [row] = await sql<Goal[]>`
    insert into cadence.goals (user_id, title, area, type, measure, timeframe, milestones, status, source, confidence)
    values (
      ${userId}, ${goal.title ?? ''}, ${goal.area ?? 'practice'}, ${goal.type ?? 'milestone'},
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

/** Replace-captured churn, but SPARE goals the user has invested stepping-stones into — durable
 *  intent (milestones) must survive a capture re-run even though the goal is still 'captured'. */
export async function deleteCapturedWithoutMilestones(userId: string): Promise<void> {
  await sql`
    delete from cadence.goals
    where user_id = ${userId} and status = 'captured' and coalesce(jsonb_array_length(milestones), 0) = 0`;
}

/** User edit from the review wizard — update the editable fields (null keeps existing). */
export async function updateGoal(userId: string, goalId: string, f: Partial<Goal>): Promise<void> {
  await sql`
    update cadence.goals set
      title = coalesce(${f.title ?? null}, title),
      area = coalesce(${f.area ?? null}, area),
      type = coalesce(${f.type ?? null}, type),
      measure = coalesce(${f.measure ? json(f.measure) : null}, measure),
      timeframe = coalesce(${f.timeframe ? json(f.timeframe) : null}, timeframe),
      milestones = coalesce(${f.milestones ? json(f.milestones) : null}, milestones),
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
