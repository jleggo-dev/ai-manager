/**
 * Decide when to hit USDA vs stay on the local foods cache.
 * Whole/generic foods only; skip barcodes / empty / strong local hits.
 */
import { lexicalMatchScore, normalizeResolveText } from '../food-resolver-rank.ts';
import type { Food } from '@cadence/shared';

/** Local hit at/above this lexical score → skip USDA (cache hit). */
export const LOCAL_HIT_THRESHOLD = 0.78;

/** Max USDA search page size (keep external fan-out tiny). */
export const USDA_SEARCH_PAGE_SIZE = 5;

/** Max detail fetches / imports per cache-miss enrich. */
export const USDA_IMPORT_LIMIT = 2;

/** Min query length before we bother USDA. */
const MIN_QUERY_LEN = 2;

/**
 * True when the query looks like a whole/generic food lookup (not barcode / empty).
 * Branded packaged foods stay on OpenFoodFacts (future); USDA is Foundation/SR Legacy.
 */
export function isGenericWholeFoodQuery(query: string): boolean {
  const q = normalizeResolveText(query);
  if (q.length < MIN_QUERY_LEN) return false;
  // UPC / barcode-ish — not USDA's job here.
  if (/^\d{8,14}$/.test(q.replace(/\s/g, ''))) return false;
  // Very long paste (label dump) — estimate/label capture, not FDC search.
  if (q.length > 80) return false;
  return true;
}

/** Strong local name/brand match → treat as cache hit (no external call). */
export function hasStrongLocalHit(query: string, foods: readonly Food[]): boolean {
  const q = normalizeResolveText(query);
  if (!q) return false;
  for (const f of foods) {
    if (lexicalMatchScore(q, f) >= LOCAL_HIT_THRESHOLD) return true;
  }
  return false;
}

/** Should we call USDA for this search/resolve? */
export function shouldQueryUsda(query: string, localFoods: readonly Food[]): boolean {
  if (!isGenericWholeFoodQuery(query)) return false;
  return !hasStrongLocalHit(query, localFoods);
}
