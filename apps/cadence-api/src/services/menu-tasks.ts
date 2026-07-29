/**
 * "Save the week · adds 2 trail tasks" (design E/2G) — write the menu's shop/cook tasks onto the
 * user's committed plan (owner's call: write directly on save). Idempotent: clears prior menu-derived
 * activities first, so re-saving a week replaces rather than duplicates. Cook tasks carry no recipe
 * ref on the activity — the client cross-references the saved menu by date to load the recipe's steps.
 * Placement itself is pure + unit-tested in menu-plan.ts.
 */
import type { MealPlan } from '@cadence/shared';
import { deleteActivitiesByCategory, insertActivities, MENU_TASK_CATEGORY } from '../repos/activities.ts';
import { getOrInsertOccurrenceId } from '../repos/occurrences.ts';
import { getActivePlan } from '../repos/plans.ts';
import { planMenuTasks } from './menu-plan.ts';

export async function syncMenuTasks(userId: string, plan: Pick<MealPlan, 'days' | 'shopping_list'>): Promise<void> {
  const activePlan = await getActivePlan(userId);
  if (!activePlan) return;

  await deleteActivitiesByCategory(userId, activePlan.plan_id, MENU_TASK_CATEGORY);

  const tasks = planMenuTasks(plan);
  if (!tasks.length) return;

  const activities = await insertActivities(
    userId,
    activePlan.plan_id,
    tasks.map((t) => ({
      title: t.title,
      kind: 'system' as const,
      category: MENU_TASK_CATEGORY,
      schedule: { recurrence: '', time_of_day: t.kind === 'shop' ? 'afternoon' : 'evening' },
      completion_source: 'self_report' as const,
    })),
  );

  // Materialize each activity's single occurrence on its task date so it shows on the trail.
  await Promise.all(
    activities.map((a, i) => {
      const date = tasks[i]?.date;
      return date ? getOrInsertOccurrenceId(a.activity_id, userId, date) : Promise.resolve('');
    }),
  );
}
