/**
 * Req 5 §5.6 — Food Resolver (WS-R).
 *
 * Any input → ranked candidates across own foods + shared DB → pre-select when
 * clearly best (usual serving + inferred qty) → confirm → log; or "new" →
 * capture (estimate / parse-label). Recipes land with WS3.
 *
 * Deterministic ranking first; embeddings / AI disambiguation later.
 */
import { assessDietarySafety, type DietaryProfile, type Food } from '@cadence/shared';
import { listFoodUsageRows, listFrequentFoods, listRecentFoods, searchFoods } from '../repos/foods.ts';
import { getDietaryProfile } from '../repos/users.ts';
import { foodLabel, newFoodCandidate, rankFoods, type FoodRankContext, type RankedFood } from './food-resolver-rank.ts';
import { pickPreselected, type ResolveCandidate, type ResolveInput } from './food-resolver-types.ts';

export type {
  ResolveCandidate,
  ResolveCandidateKind,
  ResolveCaptureHint,
  ResolveInput,
} from './food-resolver-types.ts';
export { pickPreselected, PRESELECT_SCORE_MARGIN } from './food-resolver-types.ts';
export {
  inferQuantity,
  inferServingIndex,
  lexicalMatchScore,
  normalizeResolveText,
  rankFoods,
} from './food-resolver-rank.ts';

const SEARCH_LIMIT = 20;
const USAGE_LIMIT = 40;

export interface ResolveResult {
  candidates: ResolveCandidate[];
  /** Set when one candidate is clearly best (safe + score margin). */
  preselected: ResolveCandidate | null;
}

function toCandidate(ranked: RankedFood, profile: DietaryProfile | null): ResolveCandidate {
  const { food, score, preselected_serving, inferred_quantity } = ranked;
  const dietary = assessDietarySafety(profile, [food.name, food.brand ?? '']);
  // Hard-flagged allergens stay visible but are heavily down-ranked so they never win preselect.
  const adjusted = dietary.safe ? score : Math.min(score, 0.05);
  return {
    kind: 'food',
    score: adjusted,
    label: foodLabel(food),
    food_id: food.food_id,
    brand: food.brand,
    preselected_serving,
    inferred_quantity,
    dietary,
  };
}

function mergeFoodPools(pools: Food[][]): Food[] {
  const byId = new Map<string, Food>();
  for (const pool of pools) {
    for (const f of pool) {
      if (!byId.has(f.food_id)) byId.set(f.food_id, f);
    }
  }
  return [...byId.values()];
}

async function loadRankContext(userId: string): Promise<{ ctx: FoodRankContext; recents: Food[]; frequents: Food[] }> {
  const [recents, frequents, usageRows] = await Promise.all([
    listRecentFoods(userId, USAGE_LIMIT),
    listFrequentFoods(userId, USAGE_LIMIT),
    listFoodUsageRows(userId, USAGE_LIMIT),
  ]);
  const useCountById = new Map<string, number>();
  for (const row of usageRows) useCountById.set(row.food_id, Number(row.use_count) || 0);
  const recentRankById = new Map<string, number>();
  recents.forEach((f, i) => recentRankById.set(f.food_id, i));
  return {
    ctx: { userId, useCountById, recentRankById },
    recents,
    frequents,
  };
}

/**
 * Resolve text (and optional photo hint) into ranked candidates + optional preselect.
 * Always appends a "new food" escape hatch when there is text and/or a photo.
 */
export async function resolveFoods(userId: string, input: ResolveInput): Promise<ResolveResult> {
  const text = typeof input.text === 'string' ? input.text.trim() : '';
  const hasPhoto = typeof input.photo === 'string' && input.photo.startsWith('data:image/');
  const [{ ctx, recents, frequents }, profile] = await Promise.all([
    loadRankContext(userId),
    getDietaryProfile(userId),
  ]);

  let pool: Food[];
  if (!text) {
    pool = mergeFoodPools([recents, frequents]);
  } else {
    const hits = await searchFoods(userId, text, SEARCH_LIMIT);
    // Also consider recents/frequents that may fuzzy-match beyond SQL LIKE.
    pool = mergeFoodPools([hits, recents, frequents]);
  }

  const ranked = rankFoods(text, pool, ctx).slice(0, 12);
  const candidates: ResolveCandidate[] = ranked.map((r) => toCandidate(r, profile));

  // Re-sort after dietary demotion so allergen rows sink.
  candidates.sort((a, b) => b.score - a.score);

  if (text || hasPhoto) candidates.push(newFoodCandidate({ text, photo: input.photo }));

  return { candidates, preselected: pickPreselected(candidates) };
}

/** @deprecated Prefer resolveFoods — kept for callers that only need the list. */
export async function resolveCandidates(userId: string, input: ResolveInput): Promise<ResolveCandidate[]> {
  const { candidates } = await resolveFoods(userId, input);
  return candidates;
}
