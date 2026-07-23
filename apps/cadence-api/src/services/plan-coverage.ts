import type { Goal, PendingPlanActivity } from '@cadence/shared';
import { normTitle } from './capture-normalize.ts';

/**
 * Pure coverage check for a synthesized plan (no DB / engine imports) — the deterministic backstop
 * that keeps plan synthesis from silently dropping a committed goal (the measured 3/5 failure). A
 * goal is COVERED when at least one activity is tagged to it: by resolved `goal_id` (authoritative,
 * set by matchGoal during shaping) or, as a fallback, by a normalized `goal_title` match using the
 * same `normTitle` capture de-dupes with — so "Run a 10k" ~ "run a 10k this spring".
 */
export function splitCoverage(
  activities: Pick<PendingPlanActivity, 'goal_id' | 'goal_title'>[],
  goals: Goal[],
): { covered: Goal[]; missing: Goal[] } {
  const ids = new Set(activities.map((a) => a.goal_id).filter((x): x is string => !!x));
  const titles = activities.map((a) => normTitle(a.goal_title ?? '')).filter((t) => t.length > 0);

  const isCovered = (g: Goal): boolean => {
    if (ids.has(g.goal_id)) return true;
    const n = normTitle(g.title);
    return n.length > 0 && titles.some((t) => t === n || t.includes(n) || n.includes(t));
  };

  const covered: Goal[] = [];
  const missing: Goal[] = [];
  for (const g of goals) (isCovered(g) ? covered : missing).push(g);
  return { covered, missing };
}
