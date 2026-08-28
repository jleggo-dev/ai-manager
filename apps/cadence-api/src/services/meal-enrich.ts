import type { Macros, NutritionLog } from '@cadence/shared';
import { findNutritionLog, updateNutritionLog } from '../repos/nutrition.ts';
import { insertFood, updateFood } from '../repos/foods.ts';
import { researchFood, shouldResearchItem, type ResearchedFood } from './food-research.ts';
import { priceFood } from './food-pricing-portion.ts';
import { totalsFromItems } from './meal-corrections.ts';
import { isGoodEnough } from './food-sources/completeness.ts';
import { findOwnDuplicate } from './food-pricing.ts';

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

/**
 * Which items on a logged meal are worth a grounded lookup.
 *
 * MP37: a `food_id` alone used to mean "resolved, leave it alone" — so a food matched with
 * calories and nothing else earned a `food_id` at price time and was never reconsidered here, even
 * after `food-pricing.ts` started flagging exactly this shape (`wants_research`, same incident,
 * same bar). The mismatch was worse than a no-op: `needs_enrich: true` told the client there was
 * work, this found zero targets, and `enrichMeal` marked the meal enriched anyway — which is
 * PERMANENT (the guard at the top of `enrichMeal`), so every meal that passed through between the
 * two fixes landing would have been immunised against ever being retried.
 *
 * This now checks the SAME thing `wants_research` checks — not whether a food_id exists, but
 * whether what it priced to is good enough. `item.est` is read rather than re-fetching the food:
 * it is `priceFood(food, portion)`, i.e. `food.macros_per_base` scaled, and scaling never drops a
 * key the source had, so its completeness mirrors the matched food's without a second query.
 */
export function itemsWantingResearch(meal: NutritionLog): number[] {
  return meal.items.flatMap((item, i) => {
    const alreadyGood = !!item.food_id && isGoodEnough(item.est ?? null);
    return !alreadyGood && shouldResearchItem(item) ? [i] : [];
  });
}

/**
 * Give a researched food a permanent home without ever minting a second row for the same words
 * (MP37). The incident this must not repeat, on record in `food-pricing.ts`'s pin-gate comment: a
 * completeness-gated PIN once made a calories-only row fail its own check on every later log, pin
 * a SECOND row each time, and the same words resolve to a different food every occurrence — two DB
 * tests exist because of it.
 *
 * Preference order:
 *  1. `existingFoodId` already names a row and the user OWNS it — `updateFood` patches it in
 *     place. Same id, same row: the common MP37 shape, an earlier thin placeholder pin matched
 *     again and now improved rather than replaced. `updateFood`'s own WHERE clause is the safety
 *     rail here — it silently declines a row this user does not own, so this can never mutate a
 *     SHARED corpus row (USDA/FatSecret/CNF) on the strength of one person's web lookup.
 *  2. No id, or the id named a shared row `updateFood` correctly refused — search this user's own
 *     foods for one already named what research found, the exact guard `pinItem` uses before
 *     minting from `estimate-food` (`food-pricing.ts`), reused rather than re-implemented.
 *  3. Neither exists — insert a new private pin. Today's behaviour for a flat miss, unchanged.
 */
async function homeForResearchedFood(
  userId: string,
  existingFoodId: string | undefined,
  found: ResearchedFood,
): Promise<string | undefined> {
  const patch = {
    name: found.food.name,
    brand: found.food.brand,
    macros_per_base: found.food.macros_per_base ?? {},
    servings: found.food.servings,
    default_serving: found.food.default_serving,
    confidence: found.food.confidence,
  };

  if (existingFoodId) {
    const updated = await updateFood(userId, existingFoodId, patch);
    if (updated) return updated.food_id;
  }

  const dupe = await findOwnDuplicate(userId, found.food.name, found.food.brand);
  if (dupe) return dupe.food_id;

  // That is the whole point of paying for the lookup: the next time these words are said the
  // ledger answers for free and answers identically (A23). A pin that fails costs the better
  // numbers for THIS item, never the meal — the estimate below still lands if pricing succeeds.
  try {
    const pinned = await insertFood(userId, {
      ...patch,
      base_unit: found.food.base_unit,
      source: 'research',
      visibility: 'private',
    });
    return pinned.food_id;
  } catch (e) {
    console.warn('[meal-enrich] pin failed — using the numbers without a ledger row:', e);
    return undefined;
  }
}

/** One item, researched and re-priced. Null on any failure — the item is left exactly as it was. */
async function improveItem(
  userId: string,
  item: NutritionLog['items'][number],
): Promise<NutritionLog['items'][number] | null> {
  const found = await researchFood(userId, item);
  if (!found) return null;

  const foodId = await homeForResearchedFood(userId, item.food_id, found);

  const est = priceFood(found.food, {
    qty: item.qty,
    unit: item.unit,
    text: `${item.qty ?? ''} ${item.unit ?? ''} ${item.name}`.trim(),
  });
  if (Object.keys(est).length === 0) return null;

  return {
    ...item,
    // The researched NAME wins — it is the manufacturer's, found alongside the numbers, and it is
    // what makes "dill pickles" become "Dill Pickle Peanuts" without anybody retyping it.
    name: found.food.name,
    ...(found.food.brand ? { brand: found.food.brand } : {}),
    est: { ...est, source: 'research' } as Macros,
    ...(foodId ? { food_id: foodId } : {}),
  };
}

export async function enrichMeal(userId: string, logId: string): Promise<EnrichOutcome> {
  const meal = await findNutritionLog(userId, logId);
  if (!meal) return { meal: null, improved: 0 };

  const flags = (meal.flags ?? {}) as Record<string, unknown>;
  if (flags.enriched === true) return { meal, improved: 0 };

  const targets = itemsWantingResearch(meal);
  if (targets.length === 0) {
    /**
     * Zero targets is not always a completion, and until now both read the same way (MP37) — the
     * exact "an empty result and a fault must never look alike" mistake this PR fixes elsewhere
     * (`tool-response.ts`'s pair), one layer over. `needs_enrich: true` is set at price time from
     * the same gate `itemsWantingResearch` reads above; a mismatch here means the meal's items
     * changed shape in between (a manual correction, a retry after a partial write) rather than
     * "no work was ever needed." Marking enriched either way with no distinction is how a real gap
     * would hide forever behind the very flag meant to prove it was checked.
     */
    if (flags.needs_enrich === true) {
      console.error(
        `[meal-enrich] meal ${logId} was flagged needs_enrich but found zero targets on read — ` +
          'the gate that set the flag and the gate that just read it disagree about this meal',
      );
    }
    return { meal: await markEnriched(userId, logId, meal), improved: 0 };
  }

  const items = [...meal.items];
  let improved = 0;

  for (const index of targets) {
    const item = items[index];
    if (!item) continue;
    const better = await improveItem(userId, item);
    if (!better) continue;
    items[index] = better;
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
