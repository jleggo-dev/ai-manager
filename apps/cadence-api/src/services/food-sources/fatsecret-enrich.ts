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
import { namedSizeOf, type Food } from '@cadence/shared';
import { expireFatSecretFood, findFoodByFatSecretId, upsertFatSecretFood } from '../../repos/foods.ts';
import { lexicalMatchScore, normalizeResolveText, tokens } from '../food-resolver-rank.ts';
import { fetchFatSecretFood, isFatSecretConfigured, searchFatSecretFoods } from './fatsecret.ts';
import type { FatSecretHit } from './fatsecret-map.ts';

/** Their ToS: nothing but identifiers may outlive this. */
export const FATSECRET_TTL_MS = 24 * 60 * 60 * 1000;
/**
 * How many hits to consider. One search is one call whatever the page size, so this is not a
 * cost knob — it is how much of the menu we can SEE before deciding. At 5, "Starbucks latte" never
 * showed a single Venti row.
 */
const SEARCH_LIMIT = 10;
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

export interface RankedFatSecretHit {
  hit: FatSecretHit;
  score: number;
  /** Words in the row's name the person never said — "matcha" in "Matcha Latte" for "latte". */
  unasked: number;
}

/** What the rung found: the row it took, or — when it would only be guessing — the rows it could not choose between. */
export interface FatSecretMatch {
  food: Food | null;
  /** Equally close rows, none taken. Empty unless the search was a tie. */
  tied: FatSecretHit[];
}

/** The search words: vendor, then a menu size when one was said ("Venti"), then the food. */
export function fatSecretQuery(query: string, brand?: string | null, size?: string | null): string {
  return [brand?.trim(), namedSizeOf(size) ?? '', query.trim()].filter(Boolean).join(' ').trim();
}

/**
 * Close-enough rows, best first: by match score, then by fewest unasked words.
 *
 * The second key is the fix for "Starbucks latte". Every Starbucks latte contains both words, so
 * Matcha, Chai and Pumpkin Spice all scored the same 0.82 as Caffè Latte, and the tie went to
 * whatever FatSecret listed first. A row that adds a word nobody said is naming a different drink.
 */
export function rankFatSecretHits(q: string, hits: readonly FatSecretHit[]): RankedFatSecretHit[] {
  const said = new Set(tokens(q));
  return hits
    .map((hit) => ({
      hit,
      score: lexicalMatchScore(q, { name: hit.name, brand: hit.brand }),
      unasked: tokens(`${hit.brand ?? ''} ${hit.name}`).filter((t) => !said.has(t)).length,
    }))
    .filter((r) => r.score >= MIN_MATCH)
    .sort((a, b) => b.score - a.score || a.unasked - b.unasked);
}

/**
 * The rows that share the best rank. One row — or several that are the same food listed twice —
 * is a match; two different foods at the same rank is a guess, and a wrong branded match is worse
 * than none (it prices the meal AND switches off the web lookup that would have got it right).
 */
export function topTie(ranked: readonly RankedFatSecretHit[]): RankedFatSecretHit[] {
  const [first] = ranked;
  if (!first) return [];
  const top = ranked.filter((r) => r.score === first.score && r.unasked === first.unasked);
  const distinct = new Set(top.map((r) => normalizeResolveText(`${r.hit.brand ?? ''} ${r.hit.name}`)));
  return distinct.size > 1 ? top : [first];
}

/**
 * The rung itself: given a query nothing local or USDA could answer, try FatSecret and report what
 * it found. `brand` is the strongest signal we have that this is their kind of food, so it joins the
 * query; a menu `size` joins it too, because chains list each size as its own row.
 *
 * It takes a row only when one row is clearly closest. A tie comes back as `tied`, so a caller that
 * reports to the Coach can say so instead of handing her one arbitrary row as if it were the answer.
 */
export async function matchFatSecret(
  query: string,
  brand?: string | null,
  size?: string | null,
): Promise<FatSecretMatch> {
  const none: FatSecretMatch = { food: null, tied: [] };
  const q = fatSecretQuery(query, brand, size);
  if (!q || !isFatSecretConfigured()) return none;
  try {
    const top = topTie(rankFatSecretHits(q, await searchFatSecretFoods(q, SEARCH_LIMIT)));
    if (top.length === 0) return none;
    if (top.length > 1) {
      console.info(`[fatsecret] "${q}" — ${top.length} equally close rows, none taken`);
      return { food: null, tied: top.map((r) => r.hit) };
    }
    return { food: await refreshFatSecretFood(top[0]!.hit.food_id), tied: [] };
  } catch (e) {
    console.warn('[fatsecret] lookup failed — falling through to an estimate:', e);
    return none;
  }
}

/** The row alone, for pricing — which has no one to show a tie to, so a tie is no match. */
export async function findFatSecretMatch(
  query: string,
  brand?: string | null,
  size?: string | null,
): Promise<Food | null> {
  return (await matchFatSecret(query, brand, size)).food;
}
