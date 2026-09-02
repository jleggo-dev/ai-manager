import { useCallback, useEffect, useState } from 'react';
import { mealPlanItems, type MealPlanDay, type Recipe } from '@cadence/shared';
import {
  deleteMealPlan,
  getCurrentMealPlan,
  listRecipes,
  patchMealPlan,
  probeRecipeDiscovery,
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
  /** Whether the recipe-discovery endpoint is live — gates the "Find a real recipe" door. */
  discoveryLive: boolean;
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
  const [discoveryLive, setDiscoveryLive] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [nonce, setNonce] = useState(0);

  const reload = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    let alive = true;
    void probeRecipeDiscovery().then((live) => {
      if (alive) setDiscoveryLive(live);
    });
    return () => {
      alive = false;
    };
  }, []);

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
        /**
         * First save of a week. The confirm endpoint speaks full recipe DRAFTS — it exists to turn
         * a generated plan into saved recipes — so a composed meal (frame 10a: recipes AND loose
         * foods, under a name the user gave it) cannot be expressed in that shape.
         *
         * So: create the week from its recipes, then immediately PATCH the true days over it. The
         * patch endpoint takes the composed shape, so the meal the user actually built is what
         * ends up stored. Without the second call, everything but the recipes would be dropped on
         * the first save and silently reappear as a plain recipe — the worst kind of data loss,
         * because it looks like it worked.
         */
        const byId = new Map(recipes.map((x) => [x.recipe_id, x]));
        const draftDays = days
          .map((d) => ({
            day: d.day,
            meals: d.meals.flatMap((m) =>
              mealPlanItems(m)
                .filter((i) => i.kind === 'recipe')
                .flatMap((i) => {
                  const recipe = byId.get(i.id);
                  return recipe ? [{ slot: m.slot, recipe: toDraftRecipe(recipe) }] : [];
                }),
            ),
          }))
          .filter((d) => d.meals.length > 0);

        if (!draftDays.length) {
          // A week of loose foods only: nothing for the recipe-shaped create endpoint to make.
          return void setNote('Add at least one recipe to start the week — foods can join it after.');
        }

        const r = await saveMealPlan({ week_of: weekOf, days: draftDays, shopping_list: [], notes: null });
        if (r.status !== 'ok') return void setNote(r.message);
        if (!r.plan?.meal_plan_id) return void setPlan(r.plan ?? null);

        /**
         * The second call is an UPGRADE, never a requirement. The week already exists at this
         * point; the patch only replaces its recipe-shaped days with the composed ones. So every
         * way it can fail — rejected, or answering with something unexpected — falls back to the
         * plan that was just created rather than throwing.
         *
         * Caught by CI, not by me: the result was read as `composed.status` with no guard, and an
         * absent result made that an unhandled rejection. The tests still reported green, which is
         * exactly the "false positive tests" vitest warns about — the failure happened after the
         * assertions, so nothing that was asserted was wrong, and the feature was still broken.
         */
        const composed = await patchMealPlan(r.plan.meal_plan_id, { days }).catch(() => null);
        setPlan(composed?.status === 'ok' ? composed.plan : r.plan);
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
    discoveryLive,
    busy,
    note,
    setNote,
    reload,
    commitDays,
  };
}
