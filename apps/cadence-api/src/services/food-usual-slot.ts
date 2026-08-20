/**
 * "What you usually have at breakfast" — the slot-aware half of the quick-add sheet (design 05a).
 *
 * Recents are a single list for the whole day, which is why the sheet used to offer last night's
 * chilli at 08:14. This reads the same history the coach's "usual breakfast" already reads, but
 * keeps the COUNT ("logged 14 times") and carries the serving label and calories, because the row
 * is something you add with one tap and a one-tap add has to show what it will add.
 */
import { macrosForLog, resolveDefaultServing, type MealKind } from '@cadence/shared';
import { getFood } from '../repos/foods.ts';
import { getRecipe } from '../repos/recipes.ts';
import { listNutritionLogs } from '../repos/nutrition.ts';
import { tallyUsual } from './coach-food-usual-tally.ts';

/** How far back "usually" reaches. Six weeks is long enough to survive a holiday, short enough to
 *  forget a phase someone has moved on from. */
const WINDOW_DAYS = 45;

export interface UsualAtSlot {
  kind: 'food' | 'recipe';
  /** `food_id` or `recipe_id` — whichever `kind` says. */
  id: string;
  name: string;
  /** The serving this would add ("2/3 cup"), when the food names one. */
  serving_label: string | null;
  kcal: number | null;
  /** How many times it has been logged at this slot inside the window. */
  count: number;
}

function isoDaysAgo(days: number): { from: string; to: string } {
  const now = Date.now();
  return {
    from: new Date(now - days * 86_400_000).toISOString().slice(0, 10),
    to: new Date(now).toISOString().slice(0, 10),
  };
}

/** Most-logged foods and recipes for one meal slot, newest window, counted. */
export async function usualAtSlot(userId: string, meal: MealKind, limit = 6): Promise<UsualAtSlot[]> {
  const capped = Math.min(20, Math.max(1, limit));
  const { from, to } = isoDaysAgo(WINDOW_DAYS);
  const tallied = tallyUsual(await listNutritionLogs(userId, from, to), meal).slice(0, capped);

  const rows = await Promise.all(
    tallied.map(async (t): Promise<UsualAtSlot | null> => {
      if (t.kind === 'food') {
        const food = await getFood(userId, t.id);
        if (!food) return null;
        const serving = resolveDefaultServing(food);
        const macros = macrosForLog(food);
        return {
          kind: 'food',
          id: food.food_id,
          name: food.name,
          serving_label: serving?.label ?? null,
          kcal: macros.kcal ?? null,
          count: t.count,
        };
      }
      const recipe = await getRecipe(userId, t.id);
      if (!recipe) return null;
      return {
        kind: 'recipe',
        id: recipe.recipe_id,
        name: recipe.name,
        serving_label: recipe.ingredients.length ? `${recipe.ingredients.length} ingredients` : null,
        kcal: recipe.macros_per_serving?.kcal ?? null,
        count: t.count,
      };
    }),
  );

  return rows.filter((r): r is UsualAtSlot => r !== null);
}
