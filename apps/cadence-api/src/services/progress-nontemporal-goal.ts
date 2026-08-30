/**
 * The two goal-shaped non-temporal kinds (docs/cadence/PROGRESS-ENGINE.md W1-5):
 *
 * `stage_path` — stage chips (done / current / ahead) from a goal's milestones/stepping-stones.
 * `count_toward` — n of target ("21/100 books"). Reuses the EXACT computation
 * services/progress.ts's 'count' card uses — `countGoalCompletions` plus the same
 * `unit || 'done'` fallback — never a fork of that math.
 */
import type { CountTowardPayload, Goal, StagePathPayload, WidgetOmission } from '@cadence/shared';
import { countGoalCompletions } from '../repos/goal-events.ts';
import { getGoal } from '../repos/goals.ts';
import { omit } from './window-range.ts';

/** Pure: order milestones (by target_date when present, else given order) into stage chips. The
 *  first not-done milestone is 'current'; everything after it is 'ahead'; done stays 'done'. */
export function resolveStagePath(goal: Goal): StagePathPayload | WidgetOmission {
  const milestones = goal.milestones ?? [];
  if (milestones.length === 0) return omit(`stage_path:${goal.goal_id}`, 'stage_path', 'goal has no milestones');
  const sorted = [...milestones].sort((a, b) => {
    if (a.target_date && b.target_date) return a.target_date < b.target_date ? -1 : 1;
    if (a.target_date) return -1;
    if (b.target_date) return 1;
    return 0;
  });
  const currentIdx = sorted.findIndex((m) => !m.done);
  const stages = sorted.map((m, i) => ({
    label: m.label,
    state: (m.done ? 'done' : i === currentIdx ? 'current' : 'ahead') as 'done' | 'current' | 'ahead',
  }));
  return { stages, note: null };
}

/** Pure: the same current/target/unit shape services/progress.ts's 'count' card renders. */
export function resolveCountToward(goal: Goal, current: number): CountTowardPayload | WidgetOmission {
  const target = goal.measure?.target;
  if (typeof target !== 'number') return omit(`count_toward:${goal.goal_id}`, 'count_toward', 'goal has no numeric target');
  return { current, target, unit: goal.measure?.unit || 'done' };
}

export async function getStagePath(userId: string, goalId: string): Promise<StagePathPayload | WidgetOmission> {
  const goal = await getGoal(userId, goalId);
  if (!goal) return omit(`stage_path:${goalId}`, 'stage_path', 'goal not found');
  return resolveStagePath(goal);
}

export async function getCountToward(userId: string, goalId: string): Promise<CountTowardPayload | WidgetOmission> {
  const goal = await getGoal(userId, goalId);
  if (!goal) return omit(`count_toward:${goalId}`, 'count_toward', 'goal not found');
  const current = await countGoalCompletions(userId, goalId);
  return resolveCountToward(goal, current);
}
