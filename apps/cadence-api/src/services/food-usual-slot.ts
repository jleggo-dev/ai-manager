/**
 * "What you have at breakfast" — the meal screen's Usual shelf, one page at a time.
 *
 * Every food and recipe ever logged at this slot, most recently logged first, as an endless
 * scroll the client pages through (owner, 2026-10-29). The ordering is recentAtSlot's; this file
 * hydrates ONE page — each row costs a food/recipe read, so a page is never the whole history.
 * The row carries the serving label and calories because a one-tap add has to show what it adds.
 */
import { macrosForLog, resolveDefaultServing, type MealKind } from '@cadence/shared';
import { getFood } from '../repos/foods.ts';
import { getRecipe } from '../repos/recipes.ts';
import { listNutritionLogsAtSlot } from '../repos/nutrition.ts';
import { pageOf, recentAtSlot, type RecentAtSlot } from './food-usual-recent.ts';

/** The most rows one page will hydrate. */
export const USUAL_MAX = 60;

export interface UsualAtSlot {
  kind: 'food' | 'recipe';
  /** `food_id` or `recipe_id` — whichever `kind` says. */
  id: string;
  name: string;
  /** The food's brand, when it has one — the tile shows "Gatorade Lemon-lime", not "Lemon-lime". */
  brand: string | null;
  /** The serving this would add ("2/3 cup"), when the food names one. */
  serving_label: string | null;
  kcal: number | null;
  /** Grams per serving — the tile's "P 12 · C 30 · F 8" line (quick log, 2026-10-28). */
  protein_g: number | null;
  carbs_g: number | null;
  fat_g: number | null;
  /** How many meals at this slot it appears in, all of history. */
  count: number;
  /** When it was last logged at this slot (YYYY-MM-DD) — what the list is ordered by. */
  last_date: string;
}

export interface UsualPage {
  items: UsualAtSlot[];
  /** Pass back as `cursor` for the next page; null when the list is done. */
  next_cursor: string | null;
}

async function hydrate(userId: string, t: RecentAtSlot): Promise<UsualAtSlot | null> {
  if (t.kind === 'food') {
    const food = await getFood(userId, t.id);
    if (!food) return null;
    const serving = resolveDefaultServing(food);
    const macros = macrosForLog(food);
    return {
      kind: 'food',
      id: food.food_id,
      name: food.name,
      brand: food.brand ?? null,
      serving_label: serving?.label ?? null,
      kcal: macros.kcal ?? null,
      protein_g: macros.protein_g ?? null,
      carbs_g: macros.carbs_g ?? null,
      fat_g: macros.fat_g ?? null,
      count: t.count,
      last_date: t.last_date,
    };
  }
  const recipe = await getRecipe(userId, t.id);
  if (!recipe) return null;
  return {
    kind: 'recipe',
    id: recipe.recipe_id,
    name: recipe.name,
    brand: null,
    serving_label: recipe.ingredients.length ? `${recipe.ingredients.length} ingredients` : null,
    kcal: recipe.macros_per_serving?.kcal ?? null,
    protein_g: recipe.macros_per_serving?.protein_g ?? null,
    carbs_g: recipe.macros_per_serving?.carbs_g ?? null,
    fat_g: recipe.macros_per_serving?.fat_g ?? null,
    count: t.count,
    last_date: t.last_date,
  };
}

/**
 * One page of the shelf. A food or recipe since deleted drops out of its page, so a page can be
 * shorter than `limit` without being the last — only `next_cursor: null` says the list is done.
 */
export async function usualAtSlot(userId: string, meal: MealKind, limit = 30, cursor = 0): Promise<UsualPage> {
  const capped = Math.min(USUAL_MAX, Math.max(1, limit));
  const page = pageOf(recentAtSlot(await listNutritionLogsAtSlot(userId, meal), meal), Math.max(0, cursor), capped);
  const rows = await Promise.all(page.items.map((t) => hydrate(userId, t)));
  return { items: rows.filter((r): r is UsualAtSlot => r !== null), next_cursor: page.next_cursor };
}
