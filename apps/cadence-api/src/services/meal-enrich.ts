import type { Macros, NutritionLog } from '@cadence/shared';
import { findNutritionLog, updateNutritionLog } from '../repos/nutrition.ts';
import { insertFood } from '../repos/foods.ts';
import { researchFood, shouldResearchItem } from './food-research.ts';
import { priceFood } from './food-pricing-portion.ts';
import { totalsFromItems } from './meal-corrections.ts';

/**
 * Improving a meal AFTER it is on the day — the background half of the waterfall.
 *
 * Owner's ruling (2026-08-23): *"we don't have to show that slowness to the user. We can just show
 * 'logged' and input the information in the background — updating the user's UI / macros whenever
 * we get the update back."* A grounded lookup runs 8-15 seconds and sometimes far longer, and none
 * of it needs to happen while somebody is standing in a shop holding their phone.
 *
 * WHY THIS IS A REQUEST AND NOT A BACKGROUND TASK. This API runs on Vercel with no `waitUntil`, so
 * work started after a response has already been sent can be frozen the moment the function
 * returns — the meal would be logged, the enrichment silently never finish, and nothing would say
 * so. Instead the CLIENT kicks a second request that owns its own lifetime. The log returns
 * instantly, this takes as long as it takes, and the day re-reads when it lands.
 *
 * IT IS SAFE TO CALL TWICE. `flags.enriched` is set on completion whatever the outcome, so a
 * retry, a double-tap or a second device is a no-op rather than a second billed lookup. And it is
 * safe to never call at all: the meal already has the parse's numbers, which is exactly what it
 * had before this existed.
 */
/**
 * The flag a log carries when a grounded lookup is worth doing — the client's cue to kick
 * `POST /nutrition/meals/:id/enrich` without blocking on it.
 *
 * Set at INSERT rather than discovered later, because the pricing pass has just done the work of
 * establishing that nothing matched; asking again afterwards would repeat every rung.
 */
export function enrichFlags(wantsResearch: number[]): Record<string, boolean> {
  return wantsResearch.length > 0 ? { needs_enrich: true } : {};
}

export interface EnrichOutcome {
  meal: NutritionLog | null;
  /** How many items got better numbers — 0 is a perfectly normal answer. */
  improved: number;
}

/** Which items on a logged meal are worth a grounded lookup: vendor named, nothing matched. */
export function itemsWantingResearch(meal: NutritionLog): number[] {
  return meal.items.flatMap((item, i) => (!item.food_id && shouldResearchItem(item) ? [i] : []));
}

export async function enrichMeal(userId: string, logId: string): Promise<EnrichOutcome> {
  const meal = await findNutritionLog(userId, logId);
  if (!meal) return { meal: null, improved: 0 };

  const flags = (meal.flags ?? {}) as Record<string, unknown>;
  if (flags.enriched === true) return { meal, improved: 0 };

  const targets = itemsWantingResearch(meal);
  if (targets.length === 0) {
    return { meal: await markEnriched(userId, logId, meal), improved: 0 };
  }

  const items = [...meal.items];
  let improved = 0;

  for (const index of targets) {
    const item = items[index];
    if (!item) continue;
    const found = await researchFood(userId, item);
    if (!found) continue;

    /**
     * The researched food is PINNED here, not merely borrowed. That is the whole point of paying
     * for the lookup: the next time these words are said the ledger answers for free and answers
     * identically (A23). A pin that fails costs the better numbers, never the meal.
     */
    let foodId: string | undefined;
    try {
      const pinned = await insertFood(userId, {
        name: found.food.name,
        brand: found.food.brand,
        source: 'research',
        visibility: 'private',
        confidence: found.food.confidence,
        base_unit: found.food.base_unit,
        macros_per_base: found.food.macros_per_base ?? {},
        servings: found.food.servings,
        default_serving: found.food.default_serving,
      });
      foodId = pinned.food_id;
    } catch (e) {
      console.warn('[meal-enrich] pin failed — using the numbers without a ledger row:', e);
    }

    const est = priceFood(found.food, {
      qty: item.qty,
      unit: item.unit,
      text: `${item.qty ?? ''} ${item.unit ?? ''} ${item.name}`.trim(),
    });
    if (Object.keys(est).length === 0) continue;

    items[index] = {
      ...item,
      // The researched NAME wins — it is the manufacturer's, found alongside the numbers, and it
      // is what makes "dill pickles" become "Dill Pickle Peanuts" without anybody retyping it.
      name: found.food.name,
      ...(found.food.brand ? { brand: found.food.brand } : {}),
      est: { ...est, source: 'research' } as Macros,
      ...(foodId ? { food_id: foodId } : {}),
    };
    improved++;
  }

  const recomputed = totalsFromItems(items);
  const updated = await updateNutritionLog(userId, logId, {
    items,
    ...(recomputed ? { macros: { ...recomputed, source: 'ledger' } } : {}),
    flags: { enriched: true },
  });
  return { meal: updated ?? meal, improved };
}

async function markEnriched(userId: string, logId: string, meal: NutritionLog): Promise<NutritionLog> {
  // Merged at the SQL level (`flags || …`), so this never clobbers a flag the parse set.
  return (await updateNutritionLog(userId, logId, { flags: { enriched: true } })) ?? meal;
}
