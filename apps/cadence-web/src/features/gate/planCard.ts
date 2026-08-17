import { budgetNote, sessionBudget } from '@cadence/shared';
import type { PlanActivity } from '../../lib/api.ts';

/**
 * Pure view logic for the pre-signup plan card (design: "Cadence Plan Card Gate").
 *
 * Kept out of the components so the interesting rules — when headers appear, when everything
 * arrives pre-opened, what a row's meta line says — are unit tests instead of a mounted gate.
 */

export interface PlanCardGroup {
  key: string;
  /** Uppercased on render: "TOWARD RUN A 10K" / "FOUNDATIONS". Null on a single-goal plan. */
  header: string | null;
  headerArea?: PlanActivity['area'];
  items: PlanActivity[];
}

/**
 * Group rows under the objective each serves — but headers only when there are ≥2 distinct
 * goals. A single-goal plan wearing a "Toward your novel" banner over every row is a label
 * repeating the headline; the design drops it (frame 1 vs frame 5). Goal order is arrival
 * order; the goal-less rows (weekly check-in, whole-plan work) sink to a Foundations group,
 * mirroring review/groupByGoal.
 */
export function groupPlanRows(activities: PlanActivity[]): PlanCardGroup[] {
  const groups: PlanCardGroup[] = [];
  const index = new Map<string, number>();
  for (const a of activities) {
    const key = a.goal_id ?? '__foundations__';
    let gi = index.get(key);
    if (gi == null) {
      gi = groups.length;
      index.set(key, gi);
      groups.push({
        key,
        header: a.goal_id ? `Toward ${a.goal_title ?? 'your goal'}` : 'Foundations',
        headerArea: a.area,
        items: [],
      });
    }
    groups[gi]!.items.push(a);
  }
  // Foundations sinks to the bottom — the user's own goals lead.
  groups.sort((x, y) => Number(x.key === '__foundations__') - Number(y.key === '__foundations__'));
  const goalGroups = groups.filter((g) => g.key !== '__foundations__').length;
  if (goalGroups < 2) for (const g of groups) g.header = null;
  return groups;
}

/**
 * The sparse rule (design frame 4): at ≤2 activities the rationale and every why arrive already
 * open — when the plan is one row, the reasoning IS the content, and a lone collapsed row reads
 * as a bug rather than restraint.
 */
export function sparsePlan(activities: PlanActivity[]): boolean {
  return activities.length <= 2;
}

/**
 * "Mon, Wed, Fri · 45 min (allow 55)" — the row's right-hand meta. Cadence arrives humanized.
 *
 * Two numbers, because the person is deciding whether they can afford this rhythm and needs both:
 * the 45 is the run itself (owner ruling 2026-08-17 — a 40 minute run is 40 minutes of running),
 * and the "allow 55" is what to keep free for it once warm-up and cool-down are counted. The
 * parenthetical disappears when there is nothing extra to allow for, which is most commitments —
 * a twenty-minute sit is its own whole session and "(allow 20)" would be noise.
 */
export function rowMeta(a: PlanActivity): string {
  const budget = sessionBudget(a.duration_min, a.area);
  const note = budgetNote(budget);
  const mins = budget ? `${budget.effort_min} min${note ? ` ${note}` : ''}` : null;
  return [a.cadence, mins].filter(Boolean).join(' · ');
}
