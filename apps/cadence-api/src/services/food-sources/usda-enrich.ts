/**
 * Cache-miss enrichment: local DB first, USDA only when needed; always persist hits.
 * Designed for thousands of users — minimize FDC calls via cache + import limits.
 */
import type { Food } from '@cadence/shared';
import { findFoodByFdcId, searchFoods, upsertUsdaFood } from '../../repos/foods.ts';
import { lexicalMatchScore } from '../food-resolver-rank.ts';
import {
  fetchUsdaFoodDetail,
  isUsdaConfigured,
  searchUsdaFoods,
  shouldQueryUsda,
  usdaDataTypesFor,
  UsdaConfigError,
  USDA_IMPORT_LIMIT,
  USDA_SEARCH_PAGE_SIZE,
} from './usda.ts';

function mergeById(pools: Food[][]): Food[] {
  const byId = new Map<string, Food>();
  for (const pool of pools) {
    for (const f of pool) {
      if (!byId.has(f.food_id)) byId.set(f.food_id, f);
    }
  }
  return [...byId.values()];
}

/**
 * Import (or return cached) a USDA food by fdc_id. Always writes on successful FDC fetch.
 */
export async function importUsdaFood(fdcId: number): Promise<Food> {
  if (!Number.isInteger(fdcId) || fdcId <= 0) throw new Error('invalid fdc_id');

  const cached = await findFoodByFdcId(fdcId);
  if (cached) return cached;

  if (!isUsdaConfigured()) throw new UsdaConfigError();

  const mapped = await fetchUsdaFoodDetail(fdcId);
  return upsertUsdaFood({
    fdc_id: mapped.fdc_id,
    name: mapped.name,
    brand: mapped.brand,
    base_unit: mapped.base_unit,
    macros_per_base: mapped.macros_per_base,
    servings: mapped.servings,
    default_serving: mapped.default_serving,
    confidence: mapped.confidence,
  });
}

/**
 * On cache miss for a generic/whole-food query: search USDA, import top hits, return merged list.
 * No-ops (returns local) when key missing, query gated, or strong local hit — never throws for miss path.
 */
export async function enrichFoodsWithUsda(
  userId: string,
  query: string,
  localFoods: Food[],
  opts: { importLimit?: number; brand?: string | null } = {},
): Promise<Food[]> {
  if (!shouldQueryUsda(query, localFoods)) return localFoods;
  if (!isUsdaConfigured()) {
    console.info('[usda] cache-miss skipped — USDA_API_KEY not configured');
    return localFoods;
  }

  const importLimit = Math.min(5, Math.max(1, opts.importLimit ?? USDA_IMPORT_LIMIT));
  try {
    const hits = await searchUsdaFoods(query, {
      pageSize: USDA_SEARCH_PAGE_SIZE,
      dataTypes: usdaDataTypesFor(opts.brand),
    });
    if (hits.length === 0) return localFoods;

    // Prefer hits that lexically match the query; take top N.
    const ranked = [...hits].sort(
      (a, b) =>
        lexicalMatchScore(query, { name: b.name, brand: b.brand }) -
        lexicalMatchScore(query, { name: a.name, brand: a.brand }),
    );

    const imported: Food[] = [];
    for (const hit of ranked.slice(0, importLimit)) {
      try {
        imported.push(await importUsdaFood(hit.fdc_id));
      } catch (err) {
        console.warn(`[usda] import fdc_id=${hit.fdc_id} failed:`, err instanceof Error ? err.message : err);
      }
    }

    if (imported.length === 0) return localFoods;

    // Re-query local so ranking / ownership joins stay consistent, then merge.
    const refreshed = await searchFoods(userId, query, 20);
    return mergeById([refreshed, localFoods, imported]);
  } catch (err) {
    if (err instanceof UsdaConfigError) return localFoods;
    console.warn('[usda] enrich failed:', err instanceof Error ? err.message : err);
    return localFoods;
  }
}

/** Local search then optional USDA enrich (used by GET /nutrition/foods/search). */
export async function searchFoodsWithUsda(userId: string, query: string, limit = 20): Promise<Food[]> {
  const local = await searchFoods(userId, query, limit);
  const enriched = await enrichFoodsWithUsda(userId, query, local);
  return enriched.slice(0, Math.min(50, Math.max(1, limit)));
}
