/**
 * Promote the things someone logs in their own words into Foods they can log again (Req 5 §1).
 *
 * The gap this closes: `touchFoodUsage` was only ever reached from the food_id / recipe_id paths,
 * so the app's PRIMARY capture path — say it or photograph it — wrote a `nutrition_logs` row and
 * stopped. Search reads `cadence.foods`; recents and frequents read `cadence.food_usage`. Someone
 * who logged a Starbucks latte therefore had two meals on file, zero foods, zero usage rows, and a
 * search box that found nothing (owner, on device, 2026-08-20).
 *
 * Nothing here estimates anything. It takes numbers the user has already accepted and gives them
 * somewhere to live, so the second latte is a tap instead of a re-parse.
 */
import type { NutritionLog } from '@cadence/shared';
import { insertFood, listOwnFoods, touchFoodUsage } from '../repos/foods.ts';
import { updateNutritionLog } from '../repos/nutrition.ts';
import { isPromotable, matchOwnFood, promotableName, shapeFromItem, type LoggedItem } from './food-promote-shape.ts';

/**
 * Ceiling on how many foods one meal can mint. `parseMealResult` already caps items at 12; this
 * sits under it so a single wildly over-itemised parse ("everything in the salad") cannot flood
 * someone's own-food list with rows they will never log again.
 */
const MAX_PER_MEAL = 8;

export interface PromotionOutcome {
  /** The log, with `food_id` backfilled onto every item that now has a Food behind it. */
  log: NutritionLog;
  created: number;
  matched: number;
}

/**
 * Give every eligible item on a freshly-written log a Food, and bump its usage.
 *
 * **Provisional logs are left alone.** Below `PROVISIONAL_BELOW` the parse is a guess the user has
 * not agreed to — it is excluded from the day's totals for exactly that reason — and a guess that
 * became a saved food would be re-logged later at numbers nobody ever confirmed. Those logs get
 * promoted the moment the user confirms them instead (`patchMeal`), which is the same tap that
 * graduates them into the totals.
 */
export async function promoteLoggedFoods(userId: string, log: NutritionLog): Promise<PromotionOutcome> {
  const items: LoggedItem[] = log.items ?? [];
  if (log.provisional || !items.some(isPromotable)) return { log, created: 0, matched: 0 };

  // One read of the user's own foods for the whole meal — matching is in memory from here.
  const own = await listOwnFoods(userId);
  const next = [...items];
  let created = 0;
  let matched = 0;

  for (let i = 0; i < next.length; i++) {
    if (created + matched >= MAX_PER_MEAL) break;
    const item = next[i]!;
    if (!isPromotable(item)) continue;
    const name = promotableName(item.name);
    const shape = name ? shapeFromItem(item) : null;
    if (!name || !shape) continue;

    let food = matchOwnFood(name, own);
    if (food) {
      matched += 1;
    } else {
      food = await insertFood(userId, {
        name,
        source: 'llm',
        confidence: typeof log.ai_confidence === 'number' ? log.ai_confidence : null,
        ...shape,
      });
      // Visible to the rest of THIS meal, so "toast and toast" is one food, not two.
      own.push(food);
      created += 1;
    }
    await touchFoodUsage(userId, food.food_id);
    next[i] = { ...item, food_id: food.food_id };
  }

  if (created + matched === 0) return { log, created: 0, matched: 0 };

  // Backfill the correlation onto the stored row. Without it "you usually have at breakfast"
  // (which tallies by items[].food_id) stays blank even once the foods exist.
  const updated = await updateNutritionLog(userId, log.log_id, { items: next as NutritionLog['items'] });
  return { log: updated ?? { ...log, items: next as NutritionLog['items'] }, created, matched };
}

/**
 * The same, but a failure here never costs the user their meal — the row is already written and
 * correct; remembering the food is the bonus half.
 */
export async function promoteLoggedFoodsSafely(userId: string, log: NutritionLog): Promise<NutritionLog> {
  try {
    return (await promoteLoggedFoods(userId, log)).log;
  } catch (e) {
    console.warn('[nutrition] could not remember the foods in that meal:', e);
    return log;
  }
}
