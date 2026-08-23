/**
 * FatSecret as the LAST deterministic rung (owner ruling, 2026-08-22).
 *
 * Order, and why it is this order rather than a quality judgement:
 *
 *   local ledger → USDA → FatSecret → pin an estimate
 *
 * The ledger wins first because a pinned food is free, instant, and IS the consistency guarantee.
 * USDA comes next because it is public domain: one fetch and the row is ours forever. FatSecret is
 * last because it never stops costing — their terms make every nutrient 24-hour data, so a
 * FatSecret-backed food is a network call at every pricing, for life. That is not a statement
 * about their data, which is excellent for exactly the branded and restaurant foods USDA cannot
 * hold. It is a statement about what each rung costs after the first use.
 *
 * Never throws. A source that is absent, unconfigured or failing degrades to "no match", and the
 * caller falls through to pinning an estimate exactly as it did before this file existed.
 */
import type { Food } from '@cadence/shared';
import { expireFatSecretFood, findFoodByFatSecretId, upsertFatSecretFood } from '../../repos/foods.ts';
import { lexicalMatchScore } from '../food-resolver-rank.ts';
import { fetchFatSecretFood, isFatSecretConfigured, searchFatSecretFoods } from './fatsecret.ts';

/** Their ToS: nothing but identifiers may outlive this. */
export const FATSECRET_TTL_MS = 24 * 60 * 60 * 1000;
/** How many hits to consider, and how many to actually fetch in full (each is a call). */
const SEARCH_LIMIT = 5;
const IMPORT_LIMIT = 1;
/** Below this the name is not the thing they said, and a wrong branded match is worse than none. */
const MIN_MATCH = 0.5;

export function isFatSecretRowFresh(food: Pick<Food, 'source' | 'source_fetched_at'>, now = Date.now()): boolean {
  if (food.source !== 'fatsecret') return true; // every other source keeps its numbers
  const at = food.source_fetched_at ? Date.parse(food.source_fetched_at) : NaN;
  return Number.isFinite(at) && now - at < FATSECRET_TTL_MS;
}

/**
 * A usable FatSecret row: fresh from cache, or re-read and re-stamped.
 *
 * A stale row whose refresh fails is EXPIRED rather than served — keeping the numbers past their
 * day would breach the terms, and serving them quietly is the kind of thing nobody notices until
 * an audit. The `fatsecret_id` survives, so the food returns the moment the network does.
 */
export async function refreshFatSecretFood(fatsecretId: string): Promise<Food | null> {
  const existing = await findFoodByFatSecretId(fatsecretId);
  if (existing && isFatSecretRowFresh(existing)) return existing;
  try {
    const mapped = await fetchFatSecretFood(fatsecretId);
    if (!mapped) {
      if (existing) await expireFatSecretFood(fatsecretId);
      return null;
    }
    return await upsertFatSecretFood(mapped);
  } catch (e) {
    console.warn('[fatsecret] refresh failed; expiring the cached half:', e);
    if (existing) await expireFatSecretFood(fatsecretId).catch(() => undefined);
    return null;
  }
}

/**
 * The rung itself: given a query nothing local or USDA could answer, try FatSecret and return the
 * imported row. `brand` is the strongest signal we have that this is their kind of food, so it
 * joins the query and raises the bar the name has to clear.
 */
export async function findFatSecretMatch(query: string, brand?: string | null): Promise<Food | null> {
  const q = [brand?.trim(), query.trim()].filter(Boolean).join(' ').trim();
  if (!q || !isFatSecretConfigured()) return null;
  try {
    const hits = await searchFatSecretFoods(q, SEARCH_LIMIT);
    if (hits.length === 0) return null;

    const ranked = hits
      .map((h) => ({ hit: h, score: lexicalMatchScore(q, { name: h.name, brand: h.brand }) }))
      .filter((r) => r.score >= MIN_MATCH)
      .sort((a, b) => b.score - a.score);
    if (ranked.length === 0) return null;

    for (const { hit } of ranked.slice(0, IMPORT_LIMIT)) {
      const row = await refreshFatSecretFood(hit.food_id);
      if (row) return row;
    }
    return null;
  } catch (e) {
    console.warn('[fatsecret] lookup failed — falling through to an estimate:', e);
    return null;
  }
}
