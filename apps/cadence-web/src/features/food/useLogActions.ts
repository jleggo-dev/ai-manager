import { useState } from 'react';
import type { Food } from '@cadence/shared';
import { getFoodById, logMealFromFood, logMealFromRecipe, type Meal, type MealKind } from '../../lib/api.ts';
import { useInvalidateNutritionDay } from '../../lib/query/index.ts';

const FAILED = "Couldn't write that down just now — try again in a moment.";

/**
 * Everything the Log screen WRITES, in one place so the screen itself stays a render body. Every
 * path ends the same way: the day is invalidated and the meal that landed is handed back, because
 * what lands is what the "where should it sit?" question (design 06) is about.
 */
export function useLogActions() {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const invalidateNutritionDay = useInvalidateNutritionDay();

  async function run(work: () => Promise<Meal | null>): Promise<Meal | null> {
    if (busy) return null;
    setBusy(true);
    setErr('');
    try {
      const meal = await work();
      if (!meal) {
        setErr(FAILED);
        return null;
      }
      await invalidateNutritionDay();
      return meal;
    } catch {
      setErr(FAILED);
      return null;
    } finally {
      setBusy(false);
    }
  }

  return {
    busy,
    err,
    setErr,
    /** Open a saved food so its own servings can answer the amount question (design 05d). */
    openFood: async (foodId: string): Promise<Food | null> => {
      const found = await getFoodById(foodId);
      if (found.status === 'ok' && found.food) return found.food;
      setErr("Couldn't open that one — say it or photograph it instead.");
      return null;
    },
    logFood: (input: { food_id: string; serving_index: number; quantity: number; meal: MealKind }) =>
      run(() => logMealFromFood(input)),
    logRecipe: (recipe_id: string, meal: MealKind) => run(() => logMealFromRecipe({ recipe_id, meal })),
  };
}
