/**
 * FatSecret endpoint layer — search and fetch, mapped. No DB.
 *
 * v4 for `food.get`, and that is load-bearing rather than housekeeping: v1 returns calcium, iron
 * and vitamin C as a PERCENTAGE of daily value under the same field names v4 uses for milligrams.
 * See the warning in `fatsecret-map.ts`.
 */
import { fatSecretCall, isFatSecretConfigured } from './fatsecret-http.ts';
import { mapFatSecretFood, mapFatSecretSearch, type FatSecretHit, type FatSecretMappedFood } from './fatsecret-map.ts';

/** Their search caps out well below this; we ask for few because we import fewer still. */
const MAX_RESULTS = 10;

export { isFatSecretConfigured };

/** Search by name. Empty query, or no credentials, returns nothing rather than throwing. */
export async function searchFatSecretFoods(query: string, limit = 5): Promise<FatSecretHit[]> {
  const q = query.trim().slice(0, 200);
  if (!q || !isFatSecretConfigured()) return [];
  const raw = await fatSecretCall({
    method: 'foods.search',
    search_expression: q,
    max_results: String(Math.min(MAX_RESULTS, Math.max(1, limit))),
  });
  return mapFatSecretSearch(raw).slice(0, limit);
}

/** One food, in full, mapped to Cadence's shape. Null when it cannot be mapped honestly. */
export async function fetchFatSecretFood(foodId: string): Promise<FatSecretMappedFood | null> {
  const id = foodId.trim();
  if (!id || !isFatSecretConfigured()) return null;
  // v4 — see the note above. Do not "simplify" this to `food.get`.
  const raw = await fatSecretCall({ method: 'food.get.v4', food_id: id });
  return mapFatSecretFood(raw);
}
