import { useCallback, useEffect, useMemo, useState } from 'react';
import { mealPlanItems, type MealPlanDay, type Recipe, type ShoppingListItem } from '@cadence/shared';
import {
  deleteMealPlan,
  patchMealPlan,
  probeRecipeDiscovery,
  saveMealPlan,
  weekOfMonday,
  type MealPlanDraft,
  type MealPlanRecord,
} from '../../lib/api.ts';
import { useInvalidateFoodLibrary, useMealPlan, useRecipes, useSetMealPlan } from '../../lib/query/index.ts';
import { toDraftRecipe } from './kitchenPlan.ts';

export type KitchenStatus = 'loading' | 'ok' | 'unavailable' | 'error';

export interface KitchenData {
  recipes: Recipe[];
  byId: Map<string, Recipe>;
  plan: MealPlanRecord | null;
  weekOf: string;
  /** True while the tab is on the running week — past weeks are read-only. */
  isCurrentWeek: boolean;
  status: KitchenStatus;
  /** Whether the recipe-discovery endpoint is live — gates the "Find a real recipe" door. */
  discoveryLive: boolean;
  busy: boolean;
  note: string;
  setNote: (note: string) => void;
  reload: () => void;
  /** Page the week: -1 back, +1 forward (never past the current week). */
  goWeek: (delta: number) => void;
  goToCurrentWeek: () => void;
  /** Write the week's days — creating, patching or clearing the plan as the edit requires. */
  commitDays: (days: MealPlanDay[]) => Promise<void>;
  /** Keep an AI-drafted week — the upsert replaces whatever the week held. */
  saveDraft: (draft: MealPlanDraft) => Promise<boolean>;
  /** Persist the basket: the derived list with its checked flags, written to the plan row. */
  saveTicks: (list: ShoppingListItem[]) => Promise<void>;
}

/**
 * The Kitchen's data — the saved recipes it plans WITH, and the week it plans INTO.
 *
 * One `commitDays` covers every edit because the three server shapes are an implementation detail
 * of "the week now looks like this": no plan yet is a create, an existing plan is a patch, and an
 * emptied week is a delete (the API cannot store a week with no meals in it). The caller composes
 * a `MealPlanDay[]` with the pure helpers and hands it over.
 *
 * The shopping LIST stays derived from what is planned, every time it opens — a plan edit can
 * never leave a stale list behind. The TICKS are kept (owner ruling, 2026-09-02: a basket must
 * survive a phone lock in the dairy aisle): `saveTicks` writes the derived list with its checked
 * flags onto the plan row, and the next derive re-reads only the checkmarks by item name. A new
 * week is a new plan row, so the basket empties itself when the week turns.
 */
/** Monday of the week `delta` weeks away from the given Monday. */
export function weekShift(weekOf: string, delta: number): string {
  const [y, m, d] = weekOf.split('-').map(Number);
  const dt = new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1, 12));
  dt.setUTCDate(dt.getUTCDate() + delta * 7);
  return dt.toISOString().slice(0, 10);
}

export function useKitchen(): KitchenData {
  const thisWeek = useState(() => weekOfMonday())[0];
  const [weekOf, setWeekOf] = useState(thisWeek);
  /**
   * The cookbook and the week, through the shared cache (lib/query/useFoodData.ts). The Kitchen
   * opened on "loading" every time it was entered — even straight back from the Day tab a second
   * later — because both reads lived in a mount effect and neither answer outlived the tab. They
   * are the same two entries the Food room and the meal sheets read, so the tab now opens on what
   * they already have and corrects itself behind the paint.
   *
   * `setPlan` keeps its old signature (a record, a null, or an updater) and writes to the cache
   * instead of to local state, so every edit path below is unchanged — and the week the Food room
   * shows changes with them.
   */
  const { data: cookbook, isError: cookbookFailed } = useRecipes(true);
  const recipes = useMemo(() => cookbook?.recipes ?? [], [cookbook]);
  const { data: weekRead, isPending: weekPending } = useMealPlan(weekOf);
  const plan = weekRead?.status === 'ok' ? weekRead.plan : null;
  const setPlan = useSetMealPlan(weekOf);
  // Paging to a week nobody has looked at yet is still a wait; paging back to one we hold is not.
  const status: KitchenStatus = cookbookFailed
    ? 'error'
    : !cookbook || weekPending
      ? 'loading'
      : cookbook.status === 'unavailable'
        ? 'unavailable'
        : 'ok';
  const [discoveryLive, setDiscoveryLive] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');

  const invalidateFoodLibrary = useInvalidateFoodLibrary();
  const reload = useCallback(() => void invalidateFoodLibrary(), [invalidateFoodLibrary]);

  /** Page the week — back freely, forward never past the running week (planning lives there). */
  const goWeek = useCallback(
    (delta: number) =>
      setWeekOf((w) => {
        const next = weekShift(w, delta);
        return next > thisWeek ? thisWeek : next;
      }),
    [thisWeek],
  );
  const goToCurrentWeek = useCallback(() => setWeekOf(thisWeek), [thisWeek]);

  useEffect(() => {
    let alive = true;
    void probeRecipeDiscovery().then((live) => {
      if (alive) setDiscoveryLive(live);
    });
    return () => {
      alive = false;
    };
  }, []);

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
    [busy, plan, recipes, setPlan, weekOf],
  );

  /**
   * Keep an AI-drafted week. The server upserts per (user, week): keeping a draft over an
   * existing week REPLACES it — the review card says so before this ever runs.
   */
  const saveDraft = useCallback(
    async (draft: MealPlanDraft): Promise<boolean> => {
      if (busy) return false;
      setBusy(true);
      setNote('');
      try {
        const r = await saveMealPlan(draft);
        if (r.status !== 'ok') {
          setNote(r.message);
          return false;
        }
        setPlan(r.plan);
        reload();
        return true;
      } finally {
        setBusy(false);
      }
    },
    [busy, reload, setPlan],
  );

  /**
   * Persist the basket. Optimistic — a tick in a supermarket aisle must move NOW — and quiet on
   * failure: the derived list still shows the local tick, and the next toggle retries the write.
   */
  const saveTicks = useCallback(
    async (list: ShoppingListItem[]): Promise<void> => {
      const planId = plan?.meal_plan_id;
      if (!planId) return;
      setPlan((p) => (p ? { ...p, shopping_list: list } : p));
      const r = await patchMealPlan(planId, { shopping_list: list }).catch(() => null);
      if (r?.status === 'ok') setPlan(r.plan);
    },
    [plan?.meal_plan_id, setPlan],
  );

  return {
    recipes,
    byId: new Map(recipes.map((r) => [r.recipe_id, r])),
    plan,
    weekOf,
    isCurrentWeek: weekOf === thisWeek,
    status,
    discoveryLive,
    busy,
    note,
    setNote,
    reload,
    goWeek,
    goToCurrentWeek,
    commitDays,
    saveDraft,
    saveTicks,
  };
}
