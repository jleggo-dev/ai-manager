/**
 * Pure plate composition (design 2D — "a meal is a plate, not a food"). Fold N resolved foods +
 * their portions into one meal's items[] + summed macros, using the same serving math as a single
 * saved-food log. No DB, no AI — kept in its own module so it imports nothing from the repo/db layer
 * and stays unit-testable without a database. `logMealFromItems` (in nutrition-log-saved.ts) resolves
 * the foods and inserts the composed row.
 */
import { macrosForLog, type Food, type Macros, type NutritionLog } from '@cadence/shared';

export interface PlateItemInput {
  food_id: string;
  serving_index?: number;
  quantity?: number;
}

export type PlateFood = Pick<
  Food,
  'food_id' | 'name' | 'base_unit' | 'macros_per_base' | 'servings' | 'default_serving'
>;

// Mirrors nutrition-day's key list — a plate sums every nutrient its foods carry, micros too.
import { MACRO_KEYS } from './nutrition-day.ts';

export function composePlate(
  foods: PlateFood[],
  portions: Array<{ serving_index?: number; quantity?: number }>,
): { items: NutritionLog['items']; macros: Macros | null } {
  const items: NutritionLog['items'] = [];
  const total = Object.fromEntries(MACRO_KEYS.map((k) => [k, 0])) as Record<(typeof MACRO_KEYS)[number], number>;

  foods.forEach((food, i) => {
    const p = portions[i] ?? {};
    const quantity = p.quantity && p.quantity > 0 ? p.quantity : 1;
    const servingIndex =
      typeof p.serving_index === 'number' &&
      Number.isInteger(p.serving_index) &&
      p.serving_index >= 0 &&
      p.serving_index < food.servings.length
        ? p.serving_index
        : food.default_serving;
    const n = macrosForLog(food, { servingIndex, quantity });
    const est: Macros = {};
    for (const k of MACRO_KEYS) {
      const v = n[k];
      if (typeof v === 'number') {
        est[k] = v;
        total[k] += v;
      }
    }
    const serving = food.servings[servingIndex] ?? food.servings[0];
    items.push({
      name: food.name,
      qty: quantity,
      ...(serving?.unit ? { unit: serving.unit } : {}),
      ...(Object.keys(est).length ? { est } : {}),
      food_id: food.food_id,
    });
  });

  const macros: Macros = {};
  if (total.kcal) macros.kcal = Math.round(total.kcal);
  if (total.protein_g) macros.protein_g = Math.round(total.protein_g * 10) / 10;
  if (total.carbs_g) macros.carbs_g = Math.round(total.carbs_g * 10) / 10;
  if (total.fat_g) macros.fat_g = Math.round(total.fat_g * 10) / 10;
  return { items, macros: Object.keys(macros).length ? macros : null };
}
