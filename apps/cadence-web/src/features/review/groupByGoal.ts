import type { PendingPlanActivity } from '@cadence/shared';

export type GoalActivityGroup = {
  key: string;
  title: string;
  items: PendingPlanActivity[];
};

/**
 * Group the proposed commitments under the objective each serves (the coached ladder made
 * visible), preserving the order goals first appear. Unlinked/system items (a weekly check-in,
 * whole-plan foundational work) fall into a "Foundations" group that sinks to the bottom.
 */
export function groupByGoal(activities: PendingPlanActivity[]): GoalActivityGroup[] {
  const groups: GoalActivityGroup[] = [];
  const index = new Map<string, number>();
  for (const a of activities) {
    const key = a.goal_id ?? '__foundations__';
    let gi = index.get(key);
    if (gi == null) {
      gi = groups.length;
      index.set(key, gi);
      groups.push({ key, title: a.goal_title ?? 'Foundations', items: [] });
    }
    groups[gi]!.items.push(a);
  }
  return groups.sort((x, y) => Number(x.key === '__foundations__') - Number(y.key === '__foundations__'));
}
