/**
 * The food reads more than one surface shares: the cookbook, the cooking week, the recent meals
 * behind the Food room's dots, and the dietary profile.
 *
 * Every one of these was fetched per-mount by three or four different screens — the Food room, the
 * kitchen, the meal sheets, the coach's food sheet, Settings' nutrition door — so each of them
 * opened blank and filled in a round trip later, and opening two of them asked the same question
 * twice. One key each: the second surface pays nothing, and the boot paint carries all four.
 *
 * `status: 'error'` throws, `'unavailable'` does not. They are different answers: unavailable is
 * an older server that genuinely has no such endpoint (a real, cacheable "there is nothing here"),
 * an error is a failure, and a failure cached as data becomes an empty cookbook painted from disk
 * on the next launch.
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getCurrentMealPlan,
  getDietaryProfile,
  getRecentMeals,
  listRecipes,
  type DietaryProfileResult,
  type Meal,
  type MealPlanDetailResult,
  type MealPlanRecord,
  type RecipeListResult,
} from '../api.ts';
import { queryKeys } from './keys.ts';

const FOOD_STALE_MS = 60_000;

/** The cookbook. `savedOnly` is part of the key: the shelves ask a narrower question than the room. */
export function useRecipes(savedOnly = false) {
  return useQuery<RecipeListResult>({
    queryKey: queryKeys.recipes.scoped(savedOnly),
    queryFn: async () => {
      const res = await listRecipes(savedOnly ? { savedOnly: true } : undefined);
      if (res.status === 'error') throw new Error('recipes-unavailable');
      return res;
    },
    staleTime: FOOD_STALE_MS,
  });
}

/** The cooking week — `weekOf` omitted means the current one, whatever `getCurrentMealPlan` calls it. */
export function useMealPlan(weekOf?: string) {
  return useQuery<MealPlanDetailResult>({
    queryKey: queryKeys.mealPlan.week(weekOf),
    queryFn: async () => {
      const res = await getCurrentMealPlan(weekOf);
      if (res.status === 'error') throw new Error('meal-plan-unavailable');
      return res;
    },
    staleTime: FOOD_STALE_MS,
  });
}

/** The meals behind the Food room's day dots and week strip. */
export function useRecentMeals(days = 7) {
  return useQuery<Meal[]>({
    queryKey: queryKeys.recentMeals.days(days),
    queryFn: () => getRecentMeals(days),
    staleTime: FOOD_STALE_MS,
  });
}

/**
 * Write a week back after an edit — a commit, a draft kept, a basket ticked. Takes the plan record
 * (or an updater over it) rather than the wire shape, because that is what every caller holds; a
 * null plan is stored as `not_found`, which is what the read itself says for an unplanned week.
 */
export function useSetMealPlan(weekOf?: string) {
  const queryClient = useQueryClient();
  return (next: MealPlanRecord | null | ((prev: MealPlanRecord | null) => MealPlanRecord | null)) =>
    queryClient.setQueryData<MealPlanDetailResult>(queryKeys.mealPlan.week(weekOf), (prev) => {
      const prevPlan = prev?.status === 'ok' ? prev.plan : null;
      const plan = typeof next === 'function' ? next(prevPlan) : next;
      return plan ? { status: 'ok', plan } : { status: 'not_found', plan: null };
    });
}

/** Allergies and things to skip — the one fact here that a stale answer must never soften. */
export function useDietaryProfile() {
  return useQuery<DietaryProfileResult>({
    queryKey: queryKeys.dietaryProfile.all,
    queryFn: async () => {
      const res = await getDietaryProfile();
      if (res.status === 'error') throw new Error('dietary-profile-unavailable');
      return res;
    },
    staleTime: FOOD_STALE_MS,
  });
}

/** Write a saved profile back after an edit, so every surface reading it agrees at once. */
export function useSetDietaryProfile() {
  const queryClient = useQueryClient();
  return (next: DietaryProfileResult) => queryClient.setQueryData(queryKeys.dietaryProfile.all, next);
}

/** A recipe minted or deleted, a week saved: drop the cookbook and the week so both re-read. */
export function useInvalidateFoodLibrary() {
  const queryClient = useQueryClient();
  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ['recipes'] }),
      queryClient.invalidateQueries({ queryKey: ['mealPlan'] }),
      queryClient.invalidateQueries({ queryKey: ['recentMeals'] }),
    ]);
}
