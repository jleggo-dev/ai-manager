/**
 * Req 5 Phase 3 — USDA FoodData Central deterministic lookup.
 * Search + detail over HTTP; mapping is pure (usda-map). Always cache via usda-enrich.
 * No LLM. Key is server-only (cadenceConfig.usdaApiKey).
 */
import { isUsdaConfigured, UsdaConfigError, usdaGet } from './usda-http.ts';
import { mapUsdaFoodDetail, parseUsdaSearchHit, type UsdaMappedFood, type UsdaSearchHit } from './usda-map.ts';
import { USDA_SEARCH_PAGE_SIZE } from './usda-gate.ts';

export type { UsdaMappedFood, UsdaSearchHit } from './usda-map.ts';
export { isUsdaConfigured, UsdaConfigError, UsdaHttpError } from './usda-http.ts';
export { isGenericWholeFoodQuery, shouldQueryUsda, USDA_IMPORT_LIMIT, USDA_SEARCH_PAGE_SIZE } from './usda-gate.ts';

/** Whole-food analytical datasets — exclude Branded (OFF later) and Survey noise. */
const WHOLE_FOOD_DATA_TYPES = ['Foundation', 'SR Legacy'] as const;

export interface UsdaSearchOpts {
  pageSize?: number;
  /** Override dataType filter; default Foundation + SR Legacy. */
  dataTypes?: readonly string[];
}

/**
 * Search USDA for whole/generic foods. Throws UsdaConfigError when key missing.
 * Does not write the DB — callers import/cache via importUsdaFood.
 */
export async function searchUsdaFoods(query: string, opts: UsdaSearchOpts = {}): Promise<UsdaSearchHit[]> {
  const q = query.trim();
  if (!q) return [];
  if (!isUsdaConfigured()) throw new UsdaConfigError();

  const pageSize = Math.min(20, Math.max(1, opts.pageSize ?? USDA_SEARCH_PAGE_SIZE));
  const dataTypes = opts.dataTypes ?? WHOLE_FOOD_DATA_TYPES;
  const params = new URLSearchParams({
    query: q.slice(0, 80),
    pageSize: String(pageSize),
    pageNumber: '1',
  });
  for (const dt of dataTypes) params.append('dataType', dt);

  const body = await usdaGet(`/foods/search?${params.toString()}`);
  const foods = body && typeof body === 'object' ? (body as { foods?: unknown }).foods : null;
  if (!Array.isArray(foods)) return [];

  const out: UsdaSearchHit[] = [];
  const seen = new Set<number>();
  for (const raw of foods) {
    const hit = parseUsdaSearchHit(raw);
    if (!hit || seen.has(hit.fdc_id)) continue;
    seen.add(hit.fdc_id);
    out.push(hit);
  }
  return out;
}

/** Fetch one food detail and map to Cadence shape. Throws if key missing / not found. */
export async function fetchUsdaFoodDetail(fdcId: number): Promise<UsdaMappedFood> {
  if (!Number.isInteger(fdcId) || fdcId <= 0) throw new Error('invalid fdc_id');
  if (!isUsdaConfigured()) throw new UsdaConfigError();

  const body = await usdaGet(`/food/${fdcId}`);
  const mapped = mapUsdaFoodDetail(body);
  if (!mapped) throw new Error(`USDA food ${fdcId} could not be mapped`);
  return mapped;
}
