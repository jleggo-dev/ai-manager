import { useMemo } from 'react';
import { mealPlanItems, mealPlanLabel, type MealPlanItem, type MealPlanMeal } from '@cadence/shared';
import type { MealKind } from '../../../lib/api.ts';
import { useMealPlan } from '../../../lib/query/index.ts';

/**
 * MP19 — a planned dish, in either shape the week's plan can hold it: the legacy single recipe
 * (`recipe_id` set), or the composed kind frame 10a builds — several recipes and/or foods under one
 * name (`items` set). Exactly one of the two is ever present; a caller that needs to log it branches
 * on which.
 */
export interface PlannedMeal {
  name: string;
  recipe_id?: string;
  items?: MealPlanItem[];
}

/** A meal from the plan, normalized — null when there is truly nothing planned in it. */
function toPlannedMeal(meal: MealPlanMeal): PlannedMeal | null {
  const items = mealPlanItems(meal);
  if (!items.length) return null;
  const name = mealPlanLabel(meal);
  return meal.recipe_id ? { recipe_id: meal.recipe_id, name } : { name, items };
}

/** A stable identity for de-duping across the week — the legacy recipe's id, or its own name. */
function plannedKey(p: PlannedMeal): string {
  return p.recipe_id ?? `items:${p.name}`;
}

/**
 * Today's planned dish for this meal slot (design 2B), read from the saved week menu, plus the week's
 * other named dishes (design 2C — "also on your week"). Returns nulls/empty when nothing is planned or
 * no menu exists, so the capture degrades cleanly to the ordinary empty state.
 *
 * Reads through `mealPlanItems`/`mealPlanLabel` (@cadence/shared), so a composed meal — frame 10a's
 * "recipes, food, or both" — is just as visible here as the legacy single-recipe shape. Before MP18
 * fixed the client's own read of `items`/`name`, this could never have seen one regardless; before
 * this fix, it additionally never LOOKED for one, so a composed dinner planned for today quietly did
 * not appear in quick add at all.
 */
export function usePlannedMeal(
  mealKind: MealKind,
  date: string,
): { planned: PlannedMeal | null; alsoThisWeek: PlannedMeal[] } {
  // The week comes from the shared cache (lib/query/useFoodData.ts), so the row that says what is
  // planned is there as the sheet opens — and the Food room, which reads the same week, pays for
  // it once between them.
  const { data } = useMealPlan();
  const plan = data?.status === 'ok' ? data.plan : null;

  return useMemo(() => {
    if (!plan) return { planned: null, alsoThisWeek: [] };
    const today = plan.days.find((d) => d.day === date);
    const slot = today?.meals.find((m) => m.slot === mealKind);
    const here = slot ? toPlannedMeal(slot) : null;

    const seen = new Set<string>(here ? [plannedKey(here)] : []);
    const others: PlannedMeal[] = [];
    for (const d of plan.days) {
      for (const m of d.meals) {
        const p = toPlannedMeal(m);
        if (!p) continue;
        const key = plannedKey(p);
        if (seen.has(key)) continue;
        seen.add(key);
        others.push(p);
      }
    }
    return { planned: here, alsoThisWeek: others.slice(0, 3) };
  }, [plan, mealKind, date]);
}
