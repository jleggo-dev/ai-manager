import { useEffect, useState } from 'react';
import { getCurrentMealPlan, type MealKind } from '../../../lib/api.ts';

export interface PlannedMeal {
  recipe_id: string;
  name: string;
}

/**
 * Today's planned dish for this meal slot (design 2B), read from the saved week menu, plus the week's
 * other named dishes (design 2C — "also on your week"). Returns nulls/empty when nothing is planned or
 * no menu exists, so the capture degrades cleanly to the ordinary empty state. Recipe-only for now —
 * a planned slot resolves to a saved recipe, which logs deterministically in one tap.
 */
export function usePlannedMeal(
  mealKind: MealKind,
  date: string,
): { planned: PlannedMeal | null; alsoThisWeek: PlannedMeal[] } {
  const [planned, setPlanned] = useState<PlannedMeal | null>(null);
  const [alsoThisWeek, setAlsoThisWeek] = useState<PlannedMeal[]>([]);

  useEffect(() => {
    let alive = true;
    getCurrentMealPlan().then((r) => {
      if (!alive || r.status !== 'ok' || !r.plan) return;
      const today = r.plan.days.find((d) => d.day === date);
      const slot = today?.meals.find((m) => m.slot === mealKind && m.recipe_id);
      const here = slot?.recipe_id ? { recipe_id: slot.recipe_id, name: slot.recipe_name || 'Planned dish' } : null;
      setPlanned(here);

      const seen = new Set<string>(here ? [here.recipe_id] : []);
      const others: PlannedMeal[] = [];
      for (const d of r.plan.days) {
        for (const m of d.meals) {
          if (m.recipe_id && m.recipe_name && !seen.has(m.recipe_id)) {
            seen.add(m.recipe_id);
            others.push({ recipe_id: m.recipe_id, name: m.recipe_name });
          }
        }
      }
      setAlsoThisWeek(others.slice(0, 3));
    });
    return () => {
      alive = false;
    };
  }, [mealKind, date]);

  return { planned, alsoThisWeek };
}
