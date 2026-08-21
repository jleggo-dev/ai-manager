import { useCallback, useEffect, useState } from 'react';
import type { MealPlanDay, Recipe } from '@cadence/shared';
import {
  deleteMealPlan,
  getCurrentMealPlan,
  listRecipes,
  patchMealPlan,
  saveMealPlan,
  weekOfMonday,
  type MealPlanRecord,
} from '../../lib/api.ts';
import { toDraftRecipe } from './kitchenPlan.ts';

export type KitchenStatus = 'loading' | 'ok' | 'unavailable' | 'error';

export interface KitchenData {
  recipes: Recipe[];
  byId: Map<string, Recipe>;
  plan: MealPlanRecord | null;
  weekOf: string;
  status: KitchenStatus;
  busy: boolean;
  note: string;
  setNote: (note: string) => void;
  reload: () => void;
  /** Write the week's days — creating, patching or clearing the plan as the edit requires. */
  commitDays: (days: MealPlanDay[]) => Promise<void>;
}

/**
 * The Kitchen's data — the saved recipes it plans WITH, and the week it plans INTO.
 *
 * One `commitDays` covers every edit because the three server shapes are an implementation detail
 * of "the week now looks like this": no plan yet is a create, an existing plan is a patch, and an
 * emptied week is a delete (the API cannot store a week with no meals in it). The caller composes
 * a `MealPlanDay[]` with the pure helpers and hands it over.
 *
 * The shopping list is never written from here. The Kitchen derives its list from what is planned,
 * every time it is opened — so a plan edit can never leave a stale list behind, and a list the meal
 * planner generated is left exactly as it found it.
 */
export function useKitchen(): KitchenData {
  const [weekOf] = useState(() => weekOfMonday());
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [plan, setPlan] = useState<MealPlanRecord | null>(null);
  const [status, setStatus] = useState<KitchenStatus>('loading');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [nonce, setNonce] = useState(0);

  const reload = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    let alive = true;
    setStatus('loading');
    void Promise.all([listRecipes({ savedOnly: true }), getCurrentMealPlan(weekOf)]).then(([r, p]) => {
      if (!alive) return;
      setRecipes(r.status === 'ok' ? r.recipes : []);
      setPlan(p.status === 'ok' ? p.plan : null);
      if (r.status === 'unavailable') setStatus('unavailable');
      else if (r.status === 'error') setStatus('error');
      else setStatus('ok');
    });
    return () => {
      alive = false;
    };
  }, [weekOf, nonce]);

  const commitDays = useCallback(
    async (days: MealPlanDay[]) => {
      if (busy) return;
      setBusy(true);
      setNote('');
      try {
        if (!days.length) {
          if (!plan?.meal_plan_id) return void setPlan(null);
          const r = await deleteMealPlan(plan.meal_plan_id);
          if (r.status !== 'ok') return void setNote(r.message);
          setPlan(null);
          return;
        }
        if (plan?.meal_plan_id) {
          const r = await patchMealPlan(plan.meal_plan_id, { days });
          if (r.status !== 'ok') return void setNote(r.message);
          setPlan(r.plan);
          return;
        }
        const byId = new Map(recipes.map((x) => [x.recipe_id, x]));
        const draftDays = days.map((d) => ({
          day: d.day,
          meals: d.meals.flatMap((m) => {
            const recipe = byId.get(m.recipe_id);
            return recipe ? [{ slot: m.slot, recipe: toDraftRecipe(recipe) }] : [];
          }),
        }));
        const r = await saveMealPlan({ week_of: weekOf, days: draftDays, shopping_list: [], notes: null });
        if (r.status !== 'ok') return void setNote(r.message);
        setPlan(r.plan);
      } finally {
        setBusy(false);
      }
    },
    [busy, plan, recipes, weekOf],
  );

  return {
    recipes,
    byId: new Map(recipes.map((r) => [r.recipe_id, r])),
    plan,
    weekOf,
    status,
    busy,
    note,
    setNote,
    reload,
    commitDays,
  };
}
