/**
 * Deterministic meal logs from saved Food / Recipe entities (Req 5).
 * No AI — macros from serving math or recipe macros_per_serving × quantity.
 */
import { macrosForLog, type Macros, type MealKind, type NutritionLog } from '@cadence/shared';
import { getFood, touchFoodUsage } from '../repos/foods.ts';
import { insertNutritionLog } from '../repos/nutrition.ts';
import { getRecipe } from '../repos/recipes.ts';
import { findPendingFoodLogOccurrence, setOccurrenceStatus } from '../repos/occurrences.ts';
import { isMeal } from './nutrition-parse.ts';
import { scaleMacros } from './recipe-macros.ts';

const today = (): string => new Date().toISOString().slice(0, 10);

async function tickFoodLogOccurrence(userId: string, date: string): Promise<void> {
  try {
    const occId = await findPendingFoodLogOccurrence(userId, date);
    if (occId) await setOccurrenceStatus(userId, occId, 'done');
  } catch (e) {
    console.warn('[nutrition] food-log occurrence tick failed:', e);
  }
}

/** Deterministic log of a saved Food — macros from serving math, no AI. */
export async function logMealFromFood(
  userId: string,
  input: {
    food_id: string;
    meal?: MealKind;
    date?: string;
    serving_index?: number;
    quantity?: number;
  },
): Promise<NutritionLog> {
  const food = await getFood(userId, input.food_id);
  if (!food) throw new Error('food not found');
  const date = input.date ?? today();
  const quantity = input.quantity && input.quantity > 0 ? input.quantity : 1;
  const servingIndex =
    typeof input.serving_index === 'number' && Number.isInteger(input.serving_index)
      ? input.serving_index
      : food.default_serving;
  const nutrients = macrosForLog(food, { servingIndex, quantity });
  const macros: Macros = {
    ...(typeof nutrients.kcal === 'number' ? { kcal: nutrients.kcal } : {}),
    ...(typeof nutrients.protein_g === 'number' ? { protein_g: nutrients.protein_g } : {}),
    ...(typeof nutrients.carbs_g === 'number' ? { carbs_g: nutrients.carbs_g } : {}),
    ...(typeof nutrients.fat_g === 'number' ? { fat_g: nutrients.fat_g } : {}),
  };
  const serving =
    Number.isInteger(servingIndex) && servingIndex >= 0 && servingIndex < food.servings.length
      ? food.servings[servingIndex]
      : food.servings[0];
  const meal: MealKind = input.meal && isMeal(input.meal) ? input.meal : 'other';
  const rawText = food.brand ? `${food.brand} ${food.name}` : food.name;

  const row = await insertNutritionLog(userId, {
    date,
    meal,
    items: [
      {
        name: food.name,
        qty: quantity,
        ...(serving?.unit ? { unit: serving.unit } : {}),
        ...(Object.keys(macros).length ? { est: macros } : {}),
        food_id: food.food_id,
      },
    ],
    input_method: 'manual',
    ai_confidence: food.confidence,
    raw_text: rawText,
    flags: {},
    photo_ref: null,
    macros: Object.keys(macros).length ? macros : null,
    provisional: false,
  });

  try {
    await touchFoodUsage(userId, food.food_id);
  } catch (e) {
    console.warn('[nutrition] food_usage touch failed:', e);
  }
  await tickFoodLogOccurrence(userId, date);
  return row;
}

/**
 * Deterministic log of N servings of a saved Recipe — macros from
 * macros_per_serving × quantity. Correlates via nutrition_logs.recipe_id.
 */
export async function logMealFromRecipe(
  userId: string,
  input: {
    recipe_id: string;
    meal?: MealKind;
    date?: string;
    /** Number of recipe servings to log (default 1). */
    quantity?: number;
  },
): Promise<NutritionLog> {
  const recipe = await getRecipe(userId, input.recipe_id);
  if (!recipe) throw new Error('recipe not found');
  const date = input.date ?? today();
  const servings = input.quantity && input.quantity > 0 ? input.quantity : 1;
  const macros = scaleMacros(recipe.macros_per_serving ?? {}, servings);
  const meal: MealKind = input.meal && isMeal(input.meal) ? input.meal : 'other';

  const items: NutritionLog['items'] = [
    {
      name: recipe.name,
      qty: servings,
      unit: 'serving',
      ...(Object.keys(macros).length ? { est: macros } : {}),
    },
    ...recipe.ingredients
      .filter((ing) => !!ing.food_id)
      .slice(0, 11)
      .map((ing) => ({
        name: ing.name,
        food_id: ing.food_id,
        ...(typeof ing.qty === 'number' ? { qty: ing.qty } : {}),
        ...(ing.unit ? { unit: ing.unit } : {}),
      })),
  ];

  const row = await insertNutritionLog(userId, {
    date,
    meal,
    items,
    input_method: 'manual',
    ai_confidence: 1,
    raw_text: `${servings} serving${servings === 1 ? '' : 's'} of ${recipe.name}`,
    flags: {},
    photo_ref: null,
    macros: Object.keys(macros).length ? macros : null,
    provisional: false,
    recipe_id: recipe.recipe_id,
  });

  for (const ing of recipe.ingredients) {
    if (!ing.food_id) continue;
    try {
      await touchFoodUsage(userId, ing.food_id);
    } catch (e) {
      console.warn('[nutrition] food_usage touch (recipe) failed:', e);
    }
  }

  await tickFoodLogOccurrence(userId, date);
  return row;
}
