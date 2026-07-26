/**
 * Req 5 WS3 — Recipes: CRUD, from-chat via structure_recipe, ingredient resolve,
 * computed per-serving macros, allergen safety pass. Confirm-before-save for chat drafts.
 */
import { assessDietarySafety, type DietarySafetyAssessment, type Macros, type Recipe } from '@cadence/shared';
import { runJobBySlug } from '../ai/aim.ts';
import { getFood } from '../repos/foods.ts';
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
import { resolveFoods } from './food-resolver.ts';
import { computeMacrosPerServing, macrosForIngredientAmount, toMacros } from './recipe-macros.ts';
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
        const nutrients = macrosForIngredientAmount(food, qtyNum, unit);
        const est = toMacros(nutrients, 'ai');
        base.est = est;
        contributions.push(est);
        resolved.push(base);
        continue;
      }
    }

    // Ad-hoc: keep stored/caller est so recomputation doesn't drop estimated components.
    if (ing.est && typeof ing.est === 'object') {
      base.est = ing.est;
      contributions.push(ing.est);
    }
    resolved.push(base);
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
 * Resolve one structured ingredient via the food resolver; estimate inline when unresolved.
 */
async function resolveOneIngredient(userId: string, ing: StructuredIngredient): Promise<ResolvedRecipeIngredient> {
  const qty = ing.qty;
  const unit = ing.unit;
  const text = [ing.name, qty, unit].filter((x) => x !== undefined && x !== '').join(' ');

  try {
    // Prefer the top food candidate even when allergen-down-ranked (recipe build
    // still needs the food_id + macros; the safety pass flags the draft separately).
    const { candidates } = await resolveFoods(userId, { text: ing.name });
    const topFood = candidates.find((c) => c.kind === 'food' && c.food_id);
    if (topFood?.food_id) {
      const food = await getFood(userId, topFood.food_id);
      if (food) {
        const nutrients = macrosForIngredientAmount(food, qty, unit);
        return {
          food_id: food.food_id,
          name: food.name,
          qty,
          ...(unit ? { unit } : {}),
          est: toMacros(nutrients, 'ai'),
        };
      }
    }
  } catch (e) {
    console.warn('[recipe] resolve ingredient failed — estimating:', ing.name, e);
  }

  // Unresolved → estimate_food inline (offer "save as food" is a UI concern).
  try {
    const candidate = await estimateFood(userId, text || ing.name);
    const nutrients = macrosForIngredientAmount(candidate, qty, unit ?? candidate.servings[0]?.unit);
    return {
      name: candidate.name || ing.name,
      qty,
      ...(unit ? { unit } : {}),
      est: toMacros(nutrients, 'ai'),
      estimated: true,
    };
  } catch (e) {
    console.warn('[recipe] estimate ingredient failed:', ing.name, e);
    return { name: ing.name, qty, ...(unit ? { unit } : {}), estimated: true };
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
  const ingredients: ResolvedRecipeIngredient[] = [];
  for (const ing of structured.ingredients) {
    ingredients.push(await resolveOneIngredient(userId, ing));
  }

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
      dietary_safe: draft.dietary.safe,
    },
  });

  return draft;
}

/** Persist food_id / est for recomputation; drop ephemeral `estimated` flag. */
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
