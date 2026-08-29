/**
 * Req 5 WS3 — Recipes: CRUD, from-chat via structure_recipe, ingredient resolve,
 * computed per-serving macros, allergen safety pass. Confirm-before-save for chat drafts.
 */
import {
  assessDietarySafety,
  type DietarySafetyAssessment,
  type Food,
  type Macros,
  type Recipe,
} from '@cadence/shared';
import { runJobBySlug } from '../ai/aim.ts';
import { getFood, insertFood } from '../repos/foods.ts';
import {
  deleteRecipe,
  getRecipe,
  insertRecipe,
  listRecipes,
  searchRecipes,
  updateRecipe,
  type CreateRecipeInput,
  type RecipeIngredient,
  type RecipeSource,
  type UpdateRecipeInput,
} from '../repos/recipes.ts';
import { getDietaryProfile } from '../repos/users.ts';
import { logAi } from './ai-log.ts';
import { estimateFood } from './food-capture.ts';
import type { FoodCandidate } from './food-capture-parse.ts';
import { findOwnDuplicate } from './food-pricing.ts';
import { loadResolveShared, resolveFoods, type ResolveShared } from './food-resolver.ts';
import { computeMacrosPerServing, priceIngredientAmount, toMacros } from './recipe-macros.ts';
import { parseStructureRecipeResult, type StructuredIngredient, type StructuredRecipe } from './recipe-parse.ts';

export type { StructuredRecipe } from './recipe-parse.ts';

/** Ingredient after resolve / optional inline estimate (may carry est macros). */
export interface ResolvedRecipeIngredient extends RecipeIngredient {
  /** True when macros came from estimate_food (not a saved Food). */
  estimated?: boolean;
  /** Contribution macros for this ingredient amount (batch, not per-serving). */
  est?: Macros;
}

export type RecipeDraftSource = 'ai_from_chat' | 'ai_from_fridge_photo' | 'ai';

export interface RecipeDraft {
  name: string;
  source: RecipeDraftSource;
  servings: number;
  ingredients: ResolvedRecipeIngredient[];
  steps: string[];
  macros_per_serving: Macros;
  tags: string[];
  saved: false;
  /** Allergen / diet assessment — hard-flagged allergens → safe:false. */
  dietary: DietarySafetyAssessment;
}

async function loadFoodMacros(
  userId: string,
  ingredients: RecipeIngredient[],
): Promise<{ resolved: ResolvedRecipeIngredient[]; contributions: Macros[] }> {
  const resolved: ResolvedRecipeIngredient[] = [];
  const contributions: Macros[] = [];

  for (const ing of ingredients) {
    const qty = typeof ing.qty === 'number' ? ing.qty : Number(ing.qty);
    const qtyNum = Number.isFinite(qty) && qty > 0 ? qty : 0;
    const unit = typeof ing.unit === 'string' ? ing.unit : undefined;
    const base: ResolvedRecipeIngredient = {
      name: ing.name,
      qty: qtyNum || ing.qty,
      ...(unit ? { unit } : {}),
      ...(ing.food_id ? { food_id: ing.food_id } : {}),
    };

    if (ing.food_id) {
      const food = await getFood(userId, ing.food_id);
      if (food && qtyNum > 0) {
        // MP2: thread the ingredient's own name through so a bare count ("3 shallots", re-saved
        // with no unit) still has a noun to match on recompute, and keep unresolved/reason (MP10)
        // instead of silently pricing at {} with no trace of why.
        const text = [qtyNum, unit, ing.name].filter((x) => x !== undefined && x !== '').join(' ');
        const priced = priceIngredientAmount(food, qtyNum, unit, text);
        if (priced.unresolved) {
          resolved.push({ ...base, unresolved: true, ...(priced.reason ? { reason: priced.reason } : {}) });
        } else {
          const est = toMacros(priced.nutrients, 'ai');
          resolved.push({ ...base, est });
          contributions.push(est);
        }
        continue;
      }
    }

    // Ad-hoc: keep stored/caller est, or the honest "no numbers" signal, so recomputation doesn't
    // silently drop either one.
    if (ing.est && typeof ing.est === 'object') {
      contributions.push(ing.est);
      resolved.push({ ...base, est: ing.est });
    } else if (ing.unresolved) {
      resolved.push({ ...base, unresolved: true, ...(ing.reason ? { reason: ing.reason } : {}) });
    } else {
      resolved.push(base);
    }
  }

  return { resolved, contributions };
}

/** Recompute macros_per_serving from ingredients (food_id rows + optional est). */
export async function recomputeRecipeMacros(
  userId: string,
  ingredients: RecipeIngredient[],
  servings: number,
): Promise<{ ingredients: ResolvedRecipeIngredient[]; macros_per_serving: Macros }> {
  const { resolved, contributions } = await loadFoodMacros(userId, ingredients);
  return {
    ingredients: resolved,
    macros_per_serving: computeMacrosPerServing(contributions, servings),
  };
}

export function assessRecipeDietary(
  profile: Awaited<ReturnType<typeof getDietaryProfile>>,
  name: string,
  ingredients: Array<{ name: string }>,
): DietarySafetyAssessment {
  const texts = [name, ...ingredients.map((i) => i.name)];
  return assessDietarySafety(profile, texts);
}

/**
 * MP8: pin an ingredient nothing on file could price as a reusable private Food, so the estimate
 * is made once and reused forever after (owner: *"log and save the profile of each ingredient, if
 * we don't already have it"*) instead of thrown away the moment this recipe is saved. Reuses
 * `findOwnDuplicate` — the same dedup check `food-pricing.ts`'s `pinItem` and `meal-enrich.ts`
 * already share — rather than a second, independently-written one: two dedup checks that could
 * drift is how the duplicate-pin incident happened.
 */
async function pinEstimatedIngredient(userId: string, candidate: FoodCandidate): Promise<Food> {
  const canonical = candidate.name.trim();
  const dupe = await findOwnDuplicate(userId, canonical, candidate.brand ?? null);
  if (dupe) return dupe;
  return insertFood(userId, {
    name: canonical,
    brand: candidate.brand,
    source: candidate.source,
    visibility: 'private',
    base_unit: candidate.base_unit,
    macros_per_base: candidate.macros_per_base,
    servings: candidate.servings,
    default_serving: candidate.default_serving,
    confidence: candidate.confidence,
  });
}

/**
 * Price one ingredient amount against a known food shape (a saved Food OR a not-yet-pinned
 * estimate — both carry the four fields `priceIngredientAmount` needs) into the fields common to
 * every resolution outcome. Callers attach `food_id`/`estimated` themselves since those differ by
 * branch. MP10: an amount that cannot be priced against the food carries `unresolved`/`reason`
 * forward rather than silently becoming a zero contribution with no trace of why.
 */
function priceResolvedIngredient(
  food: Pick<Food, 'base_unit' | 'macros_per_base' | 'servings' | 'default_serving'>,
  name: string,
  qty: number,
  unit: string | undefined,
  text: string,
): ResolvedRecipeIngredient {
  const base: ResolvedRecipeIngredient = { name, qty, ...(unit ? { unit } : {}) };
  const priced = priceIngredientAmount(food, qty, unit, text);
  if (priced.unresolved) return { ...base, unresolved: true, ...(priced.reason ? { reason: priced.reason } : {}) };
  return { ...base, est: toMacros(priced.nutrients, 'ai') };
}

/**
 * Resolve one structured ingredient via the food resolver; estimate + pin inline when unresolved.
 * `shared` (MP9) is the per-user ranking context `buildDraftFromStructured` loads once for the
 * whole recipe, so this never re-runs the four per-user queries `resolveFoods` would otherwise
 * load fresh on every call.
 */
async function resolveOneIngredient(
  userId: string,
  ing: StructuredIngredient,
  shared: ResolveShared,
): Promise<ResolvedRecipeIngredient> {
  const qty = ing.qty;
  const unit = ing.unit;
  // Natural reading order ("3 shallots", "1 tbsp chopped rosemary") — portionFactor only reads
  // this when the ingredient named no unit at all (MP2), but it is also plain English for the
  // estimate-food fallback below, which reads worse as "shallots 3".
  const text = [qty, unit, ing.name].filter((x) => x !== undefined && x !== '').join(' ');

  try {
    // Prefer the top food candidate even when allergen-down-ranked (recipe build
    // still needs the food_id + macros; the safety pass flags the draft separately).
    const { candidates } = await resolveFoods(userId, { text: ing.name }, shared);
    const topFood = candidates.find((c) => c.kind === 'food' && c.food_id);
    if (topFood?.food_id) {
      const food = await getFood(userId, topFood.food_id);
      if (food) {
        return { ...priceResolvedIngredient(food, food.name, qty, unit, text), food_id: food.food_id };
      }
    }
  } catch (e) {
    console.warn('[recipe] resolve ingredient failed — estimating:', ing.name, e);
  }

  // Unresolved → estimate_food inline, then pin it (MP8) so the next recipe naming the same
  // ingredient hits the ledger instead of asking again. A pin failure keeps the estimate itself —
  // consistency is worth losing, the number just given is not (mirrors food-pricing.ts's pinItem).
  try {
    const candidate = await estimateFood(userId, text || ing.name);
    let food: Food | null = null;
    try {
      food = await pinEstimatedIngredient(userId, candidate);
    } catch (e) {
      console.warn('[recipe] pin failed — pricing the estimate unsaved:', ing.name, e);
    }
    const name = food?.name || candidate.name || ing.name;
    const priced = priceResolvedIngredient(food ?? candidate, name, qty, unit, text);
    return { ...priced, ...(food ? { food_id: food.food_id } : {}), estimated: true };
  } catch (e) {
    console.warn('[recipe] estimate ingredient failed:', ing.name, e);
    // MP10: neither a saved food nor an estimate could be produced — this genuinely has no
    // numbers. `estimated` would be the wrong word here (it means numbers came from a guess, not
    // that there are none), so this says so explicitly instead.
    return {
      name: ing.name,
      qty,
      ...(unit ? { unit } : {}),
      unresolved: true,
      reason: 'could not identify or estimate this ingredient',
    };
  }
}

/**
 * Resolve structured ingredients → computed macros + allergen pass.
 * Shared by from-chat and fridge generate. Does NOT persist.
 */
export async function buildDraftFromStructured(
  userId: string,
  structured: StructuredRecipe,
  source: RecipeDraftSource,
  tags: string[] = [],
): Promise<RecipeDraft> {
  /**
   * MP9: `resolveFoods` loads four per-user ranking queries (usage, recents, frequents, dietary
   * profile) whenever nobody hands it a shared context — none of them depend on the ingredient's
   * own text, so resolving eleven ingredients one at a time ran all four eleven times over (44
   * queries for the scenario's own mushroom sauce). Loaded once here and threaded through instead.
   * `priceMealItems` (`food-pricing.ts`, outside this parcel) shares the identical context the same
   * way for the log path — this reuses that exact mechanism at the recipe path's own call site
   * rather than standing up a second batch engine beside it.
   */
  const shared = await loadResolveShared(userId);
  const ingredients = await Promise.all(structured.ingredients.map((ing) => resolveOneIngredient(userId, ing, shared)));

  const contributions = ingredients.map((i) => i.est).filter((m): m is Macros => !!m);
  const macros_per_serving = computeMacrosPerServing(contributions, structured.servings);
  const profile = await getDietaryProfile(userId);
  // Safety pass on structured names (what the model/user said), not only resolved labels —
  // allergen foods are down-ranked by the resolver and may fall through to estimate.
  const dietary = assessRecipeDietary(profile, structured.name, [...structured.ingredients, ...ingredients]);

  return {
    name: structured.name,
    source,
    servings: structured.servings,
    ingredients,
    steps: structured.steps,
    macros_per_serving,
    tags: tags.slice(0, 20),
    saved: false,
    dietary,
  };
}

/**
 * Chat → structure_recipe → resolve ingredients → computed macros + allergen pass.
 * Does NOT persist — caller confirms via POST /nutrition/recipes (brand: confirm-before-save).
 */
export async function recipeFromChat(userId: string, recipeText: string): Promise<RecipeDraft> {
  const text = recipeText.trim().slice(0, 2000);
  if (!text) throw new Error('recipe text required');

  let rawOut = '';
  try {
    const res = await runJobBySlug(userId, 'structure-recipe', { recipe_text: text });
    rawOut = res.formatted ?? res.raw ?? '';
  } catch (e) {
    console.warn('[recipe] structure-recipe failed:', e);
    throw e instanceof Error ? e : new Error('structure-recipe failed');
  }

  const structured = parseStructureRecipeResult(rawOut);
  const draft = await buildDraftFromStructured(userId, structured, 'ai_from_chat');

  void logAi(userId, {
    kind: 'structure_recipe',
    input: { recipe_text: text },
    output: { raw: rawOut.slice(0, 2000) },
    meta: {
      name: draft.name,
      servings: draft.servings,
      ingredients: draft.ingredients.length,
      estimated: draft.ingredients.filter((i) => i.estimated).length,
      // MP10: how many ingredients truly contributed no numbers — an honest trace of what the
      // draft could not count, not just what it guessed at.
      unresolved: draft.ingredients.filter((i) => i.unresolved).length,
      dietary_safe: draft.dietary.safe,
    },
  });

  return draft;
}

/**
 * Persist food_id / est for recomputation; drop the ephemeral `estimated` flag (it describes THIS
 * resolve's provenance, not a fact about the food). `unresolved`/`reason` (MP10) are the opposite
 * of ephemeral — they are the saved row's only record that an ingredient contributed no numbers,
 * so they survive here exactly like `est` does, never silently dropped on the way to the DB.
 */
function stripRuntimeFields(ingredients: ResolvedRecipeIngredient[]): RecipeIngredient[] {
  return ingredients.map((i) => {
    const qty = typeof i.qty === 'number' ? i.qty : Number(i.qty);
    const row: RecipeIngredient = {
      name: i.name,
      qty: Number.isFinite(qty) && qty > 0 ? qty : i.qty,
    };
    if (i.food_id) row.food_id = i.food_id;
    if (typeof i.unit === 'string' && i.unit.trim()) row.unit = i.unit.trim();
    // Keep inline estimate macros so ad-hoc ingredients still contribute on recompute.
    if (i.est && typeof i.est === 'object') row.est = i.est;
    if (i.unresolved) {
      row.unresolved = true;
      if (i.reason) row.reason = i.reason;
    }
    return row;
  });
}

/** Persist a confirmed recipe (macros recomputed server-side). */
export async function createRecipe(
  userId: string,
  input: {
    name: string;
    source?: RecipeSource;
    servings: number;
    ingredients: RecipeIngredient[];
    steps?: string[];
    tags?: string[];
    saved?: boolean;
  },
): Promise<{ recipe: Recipe; dietary: DietarySafetyAssessment }> {
  const servings = Number.isInteger(input.servings) && input.servings > 0 ? input.servings : 1;
  const { ingredients, macros_per_serving } = await recomputeRecipeMacros(userId, input.ingredients, servings);
  const profile = await getDietaryProfile(userId);
  const dietary = assessRecipeDietary(profile, input.name, ingredients);

  const row: CreateRecipeInput = {
    name: input.name.trim().slice(0, 120),
    source: input.source ?? 'user',
    servings,
    ingredients: stripRuntimeFields(ingredients),
    steps: input.steps ?? [],
    macros_per_serving,
    tags: input.tags ?? [],
    saved: input.saved ?? true,
  };
  const recipe = await insertRecipe(userId, row);
  return { recipe, dietary };
}

/** Patch recipe; recompute macros when ingredients or servings change. */
export async function patchRecipe(
  userId: string,
  recipeId: string,
  patch: {
    name?: string;
    servings?: number;
    ingredients?: RecipeIngredient[];
    steps?: string[];
    tags?: string[];
    saved?: boolean;
  },
): Promise<{ recipe: Recipe; dietary: DietarySafetyAssessment } | null> {
  const existing = await getRecipe(userId, recipeId);
  if (!existing) return null;

  const servings = typeof patch.servings === 'number' && patch.servings > 0 ? patch.servings : existing.servings;
  const ingInput = patch.ingredients ?? existing.ingredients;
  const { ingredients, macros_per_serving } = await recomputeRecipeMacros(userId, ingInput, servings);
  const name = patch.name?.trim() || existing.name;

  const update: UpdateRecipeInput = {
    ...(patch.name !== undefined ? { name } : {}),
    ...(patch.servings !== undefined ? { servings } : {}),
    ...(patch.ingredients !== undefined || patch.servings !== undefined
      ? { ingredients: stripRuntimeFields(ingredients), macros_per_serving }
      : {}),
    ...(patch.steps !== undefined ? { steps: patch.steps } : {}),
    ...(patch.tags !== undefined ? { tags: patch.tags } : {}),
    ...(patch.saved !== undefined ? { saved: patch.saved } : {}),
  };

  // Always refresh macros when ingredients were provided.
  if (patch.ingredients !== undefined) {
    update.ingredients = stripRuntimeFields(ingredients);
    update.macros_per_serving = macros_per_serving;
  } else if (patch.servings !== undefined) {
    update.macros_per_serving = macros_per_serving;
  }

  const recipe = await updateRecipe(userId, recipeId, update);
  if (!recipe) return null;
  const profile = await getDietaryProfile(userId);
  const dietary = assessRecipeDietary(profile, recipe.name, recipe.ingredients);
  return { recipe, dietary };
}

export async function removeRecipe(userId: string, recipeId: string): Promise<boolean> {
  return deleteRecipe(userId, recipeId);
}

export async function getRecipeForUser(userId: string, recipeId: string): Promise<Recipe | null> {
  return getRecipe(userId, recipeId);
}

export async function listRecipesForUser(
  userId: string,
  opts?: { savedOnly?: boolean; limit?: number },
): Promise<Recipe[]> {
  return listRecipes(userId, opts);
}

export async function searchRecipesForUser(userId: string, q: string, limit?: number): Promise<Recipe[]> {
  return searchRecipes(userId, q, limit);
}
