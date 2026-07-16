import type { Goal } from '@cadence/shared';

/**
 * Pure, dependency-free goal matching for plan synthesis (no DB/engine imports) so it's
 * unit-testable in isolation, like capture-normalize.ts.
 */

const normGoalTitle = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/**
 * Map a synthesized activity's stated goal_title back to the confirmed goal it serves. The Coach
 * echoes a title from <confirmed_goals> (models are unreliable at copying UUIDs), so we match on
 * the normalized title — EXACT first, then a UNIQUE containment match (tolerates a slight reword,
 * but never links when it would be ambiguous). Returns the canonical goal so the commitment points
 * at a real objective; unlinked/foundational/system activities (no goal_title, no match, or an
 * ambiguous one) return undefined and simply aren't grouped.
 */
export function matchGoal(
  goalTitle: string | undefined,
  goals: Goal[],
): { goal_id: string; title: string } | undefined {
  const t = normGoalTitle(goalTitle ?? '');
  if (!t) return undefined;
  const exact = goals.find((g) => normGoalTitle(g.title) === t);
  if (exact) return { goal_id: exact.goal_id, title: exact.title };
  const near = goals.filter((g) => {
    const gt = normGoalTitle(g.title);
    return gt.length > 0 && (gt.includes(t) || t.includes(gt));
  });
  return near.length === 1 ? { goal_id: near[0]!.goal_id, title: near[0]!.title } : undefined;
}
