/**
 * Req 5 §5.6 — Food Resolver (WS-R + WS3 recipes).
 *
 * Any input → ranked candidates across own foods + own recipes + shared DB →
 * pre-select when clearly best → confirm → log; or "new" → capture.
 *
 * Deterministic ranking first; embeddings / AI disambiguation later.
 */
import { assessDietarySafety, type DietaryProfile, type Food, type Recipe } from '@cadence/shared';
import {
  listFoodContextRows,
  listFoodUsageRows,
  listFrequentFoods,
  listRecentFoods,
  searchFoods,
  type FoodUsageSlot,
} from '../repos/foods.ts';
import { listRecipes, searchRecipes } from '../repos/recipes.ts';
import { getDietaryProfile } from '../repos/users.ts';
import { enrichFoodsWithUsda } from './food-sources/usda-enrich.ts';
import {
  foodLabel,
  inferQuantity,
  lexicalMatchScore,
  newFoodCandidate,
  rankFoods,
  type FoodRankContext,
  type RankedFood,
} from './food-resolver-rank.ts';
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
const RECIPE_LIMIT = 12;

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

function toRecipeCandidate(
  recipe: Recipe,
  score: number,
  profile: DietaryProfile | null,
  inferred_quantity: number,
): ResolveCandidate {
  const texts = [recipe.name, ...recipe.ingredients.map((i) => i.name)];
  const dietary = assessDietarySafety(profile, texts);
  const adjusted = dietary.safe ? score : Math.min(score, 0.05);
  return {
    kind: 'recipe',
    score: adjusted,
    label: recipe.name,
    recipe_id: recipe.recipe_id,
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

async function loadRankContext(
  userId: string,
  slot?: FoodUsageSlot,
): Promise<{ ctx: FoodRankContext; recents: Food[]; frequents: Food[] }> {
  const [recents, frequents, usageRows, ctxRows] = await Promise.all([
    listRecentFoods(userId, USAGE_LIMIT),
    listFrequentFoods(userId, USAGE_LIMIT),
    listFoodUsageRows(userId, USAGE_LIMIT),
    slot ? listFoodContextRows(userId, slot, USAGE_LIMIT) : Promise.resolve([]),
  ]);
  const useCountById = new Map<string, number>();
  for (const row of usageRows) useCountById.set(row.food_id, Number(row.use_count) || 0);
  const recentRankById = new Map<string, number>();
  recents.forEach((f, i) => recentRankById.set(f.food_id, i));
  const slotCountById = new Map<string, number>();
  const mealCountById = new Map<string, number>();
  for (const row of ctxRows) {
    slotCountById.set(row.food_id, Number(row.slot_count) || 0);
    mealCountById.set(row.food_id, Number(row.meal_count) || 0);
  }
  return {
    ctx: { userId, useCountById, recentRankById, slotCountById, mealCountById },
    recents,
    frequents,
  };
}

/** Own saved recipes as kind:'recipe' candidates (search when q present, else recent list). */
async function loadRecipeCandidates(
  userId: string,
  text: string,
  profile: DietaryProfile | null,
): Promise<ResolveCandidate[]> {
  const recipes = text
    ? await searchRecipes(userId, text, RECIPE_LIMIT)
    : await listRecipes(userId, { savedOnly: true, limit: RECIPE_LIMIT });
  const qty = text ? inferQuantity(text) : 1;
  const out: ResolveCandidate[] = [];
  recipes.forEach((recipe, index) => {
    let score: number;
    if (text) {
      const lexical = lexicalMatchScore(text, { name: recipe.name, brand: null });
      if (lexical <= 0) return;
      // Slight boost over a bare food lexical hit so a saved dish can win "my chili".
      score = Math.min(1.5, lexical + 0.06);
    } else {
      // Empty query: recents-style — newer recipes score a bit higher.
      score = Math.max(0.2, 0.55 - index * 0.03);
    }
    out.push(toRecipeCandidate(recipe, score, profile, qty));
  });
  return out;
}

/**
 * Per-user ranking inputs (usage projection + dietary profile) — four queries that do NOT depend
 * on the query text. Loaded once and shared when resolving several items of one meal (A23 §1a);
 * `resolveFoods` still loads its own when called for a single lookup.
 */
export interface ResolveShared {
  ctx: FoodRankContext;
  recents: Food[];
  frequents: Food[];
  profile: DietaryProfile | null;
}

export async function loadResolveShared(userId: string, slot?: FoodUsageSlot): Promise<ResolveShared> {
  const [{ ctx, recents, frequents }, profile] = await Promise.all([
    loadRankContext(userId, slot),
    getDietaryProfile(userId),
  ]);
  return { ctx, recents, frequents, profile };
}

async function poolFor(userId: string, text: string, shared: ResolveShared, brand?: string | null): Promise<Food[]> {
  if (!text) return mergeFoodPools([shared.recents, shared.frequents]);
  const hits = await searchFoods(userId, text, SEARCH_LIMIT);
  // Cache-miss → USDA whole foods (always cached on import). Local stays first.
  const withUsda = await enrichFoodsWithUsda(userId, text, hits, { brand });
  // Also consider recents/frequents that may fuzzy-match beyond SQL LIKE.
  return mergeFoodPools([withUsda, shared.recents, shared.frequents]);
}

/**
 * Ranked foods WITH their rows — what pricing needs; `resolveFoods` narrows these to candidates.
 *
 * `brand` is not part of the query text (pricing folds it in there already) — it is a SIGNAL, and
 * the only one that opens USDA's branded dataset. See `usdaDataTypesFor`.
 */
export async function rankedFoodsFor(
  userId: string,
  text: string,
  shared: ResolveShared,
  brand?: string | null,
): Promise<RankedFood[]> {
  return rankFoods(text, await poolFor(userId, text, shared, brand), shared.ctx);
}

/**
 * Resolve text (and optional photo hint) into ranked candidates + optional preselect.
 * Always appends a "new food" escape hatch when there is text and/or a photo.
 */
export async function resolveFoods(
  userId: string,
  input: ResolveInput,
  shared?: ResolveShared,
): Promise<ResolveResult> {
  const text = typeof input.text === 'string' ? input.text.trim() : '';
  const hasPhoto = typeof input.photo === 'string' && input.photo.startsWith('data:image/');
  const s = shared ?? (await loadResolveShared(userId));
  const profile = s.profile;

  const ranked = (await rankedFoodsFor(userId, text, s)).slice(0, 12);
  const candidates: ResolveCandidate[] = [
    ...ranked.map((r) => toCandidate(r, profile)),
    ...(await loadRecipeCandidates(userId, text, profile)),
  ];

  // Re-sort after dietary demotion + recipe merge so allergen rows sink.
  candidates.sort((a, b) => b.score - a.score);

  if (text || hasPhoto) candidates.push(newFoodCandidate({ text, photo: input.photo }));

  return { candidates, preselected: pickPreselected(candidates) };
}

/** @deprecated Prefer resolveFoods — kept for callers that only need the list. */
export async function resolveCandidates(userId: string, input: ResolveInput): Promise<ResolveCandidate[]> {
  const { candidates } = await resolveFoods(userId, input);
  return candidates;
}
