/**
 * Req 5 Phase 2 / WS3 + Phase 4 fridge — recipes API client (thin Food-tab UI).
 *
 * Routes:
 *   GET    /nutrition/recipes
 *   GET    /nutrition/recipes/:id
 *   POST   /nutrition/recipes
 *   POST   /nutrition/recipes/from-chat  body: { text }
 *   POST   /nutrition/recipes/parse-fridge  body: { photo, hint? }
 *   POST   /nutrition/recipes/generate  body: { ingredients, meal_hint? }
 *   POST   /nutrition/meals { recipe_id, servings|quantity, meal }
 *
 * Soft-handles 404/network so the Food tab stays usable on transient outages.
 */

import type { Macros, Recipe } from '@cadence/shared';
import { BASE, headers } from './http.ts';
import type { ApiAvailability } from './foods.ts';

export type RecipeSource = Recipe['source'];

/** Ingredient row on drafts/recipes — `est` is WS3 inline estimate before a food_id exists. */
export type RecipeIngredientRow = {
  food_id?: string;
  name: string;
  qty: number | string;
  unit?: string;
  est?: Macros;
};

/** Unsaved / draft shape from from-chat — confirm before POST /nutrition/recipes. */
export interface RecipeDraft {
  name: string;
  source: RecipeSource;
  servings: number;
  ingredients: RecipeIngredientRow[];
  steps: string[];
  macros_per_serving: Macros;
  tags: string[];
  /** Present when the API persisted a draft row before confirm. */
  recipe_id?: string;
  saved?: boolean;
}

export type RecipeListResult = { status: ApiAvailability; recipes: Recipe[] };
export type RecipeDetailResult =
  { status: 'ok'; recipe: Recipe } | { status: 'unavailable' | 'error' | 'not_found'; recipe: null };

export type RecipeFromChatResult =
  { status: 'ok'; draft: RecipeDraft } | { status: 'unavailable' | 'error'; message: string };

export type FridgeIngredient = {
  name: string;
  qty?: number;
  unit?: string;
};

export type ParseFridgeResult =
  | {
      status: 'ok';
      ingredients: FridgeIngredient[];
      summary: string;
      confidence: number;
      photo_readable: boolean;
      photo_ref: string | null;
    }
  | { status: 'unavailable' | 'error'; message: string };

export type GenerateRecipesResult =
  | { status: 'ok'; drafts: RecipeDraft[]; notes: string | null; filtered_allergy: number }
  | { status: 'unavailable' | 'error'; message: string };

export type SaveRecipeResult = { status: 'ok'; recipe: Recipe } | { status: 'unavailable' | 'error'; message: string };

async function readJson(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object';
}

function parseMacros(raw: unknown): Macros {
  if (!isRecord(raw)) return {};
  const out: Macros = {};
  if (typeof raw.kcal === 'number') out.kcal = raw.kcal;
  if (typeof raw.protein_g === 'number') out.protein_g = raw.protein_g;
  if (typeof raw.carbs_g === 'number') out.carbs_g = raw.carbs_g;
  if (typeof raw.fat_g === 'number') out.fat_g = raw.fat_g;
  if (raw.source === 'ai' || raw.source === 'user') out.source = raw.source;
  return out;
}

function parseIngredients(raw: unknown): RecipeIngredientRow[] {
  if (!Array.isArray(raw)) return [];
  const out: RecipeIngredientRow[] = [];
  for (const row of raw) {
    if (!isRecord(row)) continue;
    const name = typeof row.name === 'string' ? row.name.trim() : '';
    if (!name) continue;
    const qty = typeof row.qty === 'number' || typeof row.qty === 'string' ? row.qty : 1;
    const ing: RecipeIngredientRow = {
      name,
      qty,
      ...(typeof row.food_id === 'string' ? { food_id: row.food_id } : {}),
      ...(typeof row.unit === 'string' ? { unit: row.unit } : {}),
    };
    // WS3 drafts may attach inline estimate macros before a food_id exists.
    if (isRecord(row.est)) ing.est = parseMacros(row.est);
    out.push(ing);
  }
  return out;
}

function parseSource(raw: unknown): RecipeSource {
  if (raw === 'user' || raw === 'ai' || raw === 'ai_from_fridge_photo' || raw === 'ai_from_chat') return raw;
  return 'user';
}

function parseSteps(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((s): s is string => typeof s === 'string' && s.trim().length > 0);
}

function parseTags(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((t): t is string => typeof t === 'string' && t.trim().length > 0);
}

/** Parse a full Recipe (requires recipe_id). */
export function parseRecipe(raw: unknown): Recipe | null {
  if (!isRecord(raw)) return null;
  const recipe_id = typeof raw.recipe_id === 'string' ? raw.recipe_id : typeof raw.id === 'string' ? raw.id : '';
  const name = typeof raw.name === 'string' ? raw.name.trim() : '';
  if (!recipe_id || !name) return null;
  const servings =
    typeof raw.servings === 'number' && Number.isFinite(raw.servings) && raw.servings > 0
      ? Math.max(1, Math.round(raw.servings))
      : 1;
  return {
    recipe_id,
    name,
    source: parseSource(raw.source),
    servings,
    ingredients: parseIngredients(raw.ingredients),
    steps: parseSteps(raw.steps),
    macros_per_serving: parseMacros(raw.macros_per_serving),
    tags: parseTags(raw.tags),
    saved: raw.saved !== false,
  };
}

/** Parse draft / from-chat body (recipe_id optional). */
export function parseRecipeDraft(raw: unknown): RecipeDraft | null {
  if (!isRecord(raw)) return null;
  const name = typeof raw.name === 'string' ? raw.name.trim() : '';
  if (!name) return null;
  const servings =
    typeof raw.servings === 'number' && Number.isFinite(raw.servings) && raw.servings > 0
      ? Math.max(1, Math.round(raw.servings))
      : 1;
  const recipe_id = typeof raw.recipe_id === 'string' ? raw.recipe_id : undefined;
  return {
    name,
    source: parseSource(raw.source || 'ai_from_chat'),
    servings,
    ingredients: parseIngredients(raw.ingredients),
    steps: parseSteps(raw.steps),
    macros_per_serving: parseMacros(raw.macros_per_serving),
    tags: parseTags(raw.tags),
    ...(recipe_id ? { recipe_id } : {}),
    saved: raw.saved === true,
  };
}

function unwrapRecipeBody(body: unknown): unknown {
  if (isRecord(body) && 'recipe' in body) return body.recipe;
  if (isRecord(body) && 'draft' in body) return body.draft;
  return body;
}

function parseRecipeList(body: unknown): Recipe[] {
  const list = isRecord(body) && Array.isArray(body.recipes) ? body.recipes : Array.isArray(body) ? body : [];
  const out: Recipe[] = [];
  for (const row of list) {
    const r = parseRecipe(row);
    if (r) out.push(r);
  }
  return out;
}

/** GET /nutrition/recipes — pass savedOnly for the Food-tab log-again list. */
export async function listRecipes(opts?: { savedOnly?: boolean }): Promise<RecipeListResult> {
  try {
    const qs = opts?.savedOnly ? '?saved=1' : '';
    const res = await fetch(`${BASE}/nutrition/recipes${qs}`, { headers: headers() });
    if (res.status === 404) return { status: 'unavailable', recipes: [] };
    if (!res.ok) return { status: 'error', recipes: [] };
    return { status: 'ok', recipes: parseRecipeList(await readJson(res)) };
  } catch {
    return { status: 'error', recipes: [] };
  }
}

/** GET /nutrition/recipes/:id */
export async function getRecipeById(recipeId: string): Promise<RecipeDetailResult> {
  if (!recipeId.trim()) return { status: 'error', recipe: null };
  try {
    const res = await fetch(`${BASE}/nutrition/recipes/${encodeURIComponent(recipeId)}`, {
      headers: headers(),
    });
    if (res.status === 404) {
      const body = await readJson(res);
      if (!body) return { status: 'unavailable', recipe: null };
      return { status: 'not_found', recipe: null };
    }
    if (!res.ok) return { status: 'error', recipe: null };
    const recipe = parseRecipe(unwrapRecipeBody(await readJson(res)));
    if (!recipe) return { status: 'error', recipe: null };
    return { status: 'ok', recipe };
  } catch {
    return { status: 'error', recipe: null };
  }
}

/**
 * POST /nutrition/recipes/from-chat — `{ text }` → structured draft with computed macros.
 * Confirm before save (brand: provisional until confirmed). Body is the draft (or `{ recipe }`/`{ draft }`).
 */
export async function structureRecipeFromChat(description: string): Promise<RecipeFromChatResult> {
  const text = description.trim();
  if (!text) {
    return { status: 'error', message: 'Tell me what you made — ingredients and how many it serves help.' };
  }
  try {
    const res = await fetch(`${BASE}/nutrition/recipes/from-chat`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ text }),
    });
    if (res.status === 404) {
      return {
        status: 'unavailable',
        message: "Recipe structure isn't reachable just now — try again in a moment, or describe it in Coach.",
      };
    }
    if (!res.ok) {
      return { status: 'error', message: "Couldn't shape that into a recipe just now — try a bit more detail." };
    }
    const body = await readJson(res);
    const draft = parseRecipeDraft(unwrapRecipeBody(body));
    if (!draft) {
      return { status: 'error', message: "I couldn't shape that into a recipe — try naming the dish and ingredients." };
    }
    return { status: 'ok', draft };
  } catch {
    return { status: 'error', message: "Couldn't reach recipe structure — try again in a moment." };
  }
}

/**
 * POST /nutrition/recipes/parse-fridge — fridge/pantry photo → ingredient list for review.
 */
export async function parseFridgePhoto(input: { photo: string; hint?: string }): Promise<ParseFridgeResult> {
  if (!input.photo?.startsWith('data:image/')) {
    return { status: 'error', message: 'I need a fridge or pantry photo to read.' };
  }
  try {
    const res = await fetch(`${BASE}/nutrition/recipes/parse-fridge`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({
        photo: input.photo,
        ...(input.hint?.trim() ? { hint: input.hint.trim() } : {}),
      }),
    });
    if (res.status === 404) {
      return {
        status: 'unavailable',
        message: "Fridge scan isn't reachable just now — try again in a moment, or structure a recipe from text.",
      };
    }
    if (!res.ok) {
      return { status: 'error', message: "Couldn't read that fridge photo — try a clearer shot." };
    }
    const body = await readJson(res);
    if (!isRecord(body)) {
      return { status: 'error', message: "Couldn't read that fridge photo — try a clearer shot." };
    }
    const ingredients: FridgeIngredient[] = [];
    const rawList = Array.isArray(body.ingredients) ? body.ingredients : [];
    for (const row of rawList) {
      if (!isRecord(row)) continue;
      const name = typeof row.name === 'string' ? row.name.trim() : '';
      if (!name) continue;
      const ing: FridgeIngredient = { name };
      if (typeof row.qty === 'number' && Number.isFinite(row.qty) && row.qty > 0) ing.qty = row.qty;
      if (typeof row.unit === 'string' && row.unit.trim()) ing.unit = row.unit.trim();
      ingredients.push(ing);
    }
    return {
      status: 'ok',
      ingredients: ingredients.slice(0, 40),
      summary: typeof body.summary === 'string' ? body.summary : '',
      confidence: typeof body.confidence === 'number' ? body.confidence : 0,
      photo_readable: body.photo_readable !== false,
      photo_ref: typeof body.photo_ref === 'string' ? body.photo_ref : null,
    };
  } catch {
    return { status: 'error', message: "Couldn't reach fridge scan — try again in a moment." };
  }
}

/**
 * POST /nutrition/recipes/generate — reviewed ingredients → recipe draft ideas.
 * Confirm before save (brand: provisional until confirmed).
 */
export async function generateRecipesFromIngredients(input: {
  ingredients: FridgeIngredient[];
  meal_hint?: string;
}): Promise<GenerateRecipesResult> {
  const ingredients = input.ingredients
    .map((i) => ({
      name: i.name.trim(),
      ...(typeof i.qty === 'number' && i.qty > 0 ? { qty: i.qty } : {}),
      ...(i.unit?.trim() ? { unit: i.unit.trim() } : {}),
    }))
    .filter((i) => i.name);
  if (ingredients.length === 0) {
    return { status: 'error', message: 'Add at least one ingredient so I have something to cook with.' };
  }
  try {
    const res = await fetch(`${BASE}/nutrition/recipes/generate`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({
        ingredients,
        ...(input.meal_hint?.trim() ? { meal_hint: input.meal_hint.trim() } : {}),
      }),
    });
    if (res.status === 404) {
      return {
        status: 'unavailable',
        message: "Recipe ideas aren't reachable just now — try again in a moment.",
      };
    }
    if (!res.ok) {
      return { status: 'error', message: "Couldn't shape recipe ideas just now — try tweaking the list." };
    }
    const body = await readJson(res);
    if (!isRecord(body)) {
      return { status: 'error', message: "Couldn't shape recipe ideas just now — try tweaking the list." };
    }
    const rawDrafts = Array.isArray(body.drafts) ? body.drafts : [];
    const drafts: RecipeDraft[] = [];
    for (const row of rawDrafts) {
      const draft = parseRecipeDraft(row);
      if (draft) {
        draft.source = 'ai_from_fridge_photo';
        drafts.push(draft);
      }
    }
    return {
      status: 'ok',
      drafts: drafts.slice(0, 3),
      notes: typeof body.notes === 'string' ? body.notes : null,
      filtered_allergy: typeof body.filtered_allergy === 'number' ? body.filtered_allergy : 0,
    };
  } catch {
    return { status: 'error', message: "Couldn't reach recipe ideas — try again in a moment." };
  }
}

/** POST /nutrition/recipes — confirm-path save (macros recomputed server-side). */
export async function saveRecipe(draft: RecipeDraft): Promise<SaveRecipeResult> {
  try {
    const res = await fetch(`${BASE}/nutrition/recipes`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({
        name: draft.name,
        source: draft.source,
        servings: draft.servings,
        ingredients: draft.ingredients.map((i) => ({
          name: i.name,
          qty: i.qty,
          ...(i.food_id ? { food_id: i.food_id } : {}),
          ...(i.unit ? { unit: i.unit } : {}),
          ...(i.est ? { est: i.est } : {}),
        })),
        steps: draft.steps,
        tags: draft.tags,
        saved: true,
      }),
    });
    if (res.status === 404) {
      return {
        status: 'unavailable',
        message: "Saving recipes isn't reachable just now — try again in a moment.",
      };
    }
    if (!res.ok) {
      return { status: 'error', message: "Couldn't save that recipe just now — try again in a moment." };
    }
    const recipe = parseRecipe(unwrapRecipeBody(await readJson(res)));
    if (!recipe) {
      return { status: 'error', message: "Saved, but I couldn't read the recipe back — refresh and check Recipes." };
    }
    return { status: 'ok', recipe };
  } catch {
    return { status: 'error', message: "Couldn't reach recipe save — try again in a moment." };
  }
}

/** One-line macros for list/detail (never shame — just the numbers). */
export function recipeMacroHint(m: Macros): string {
  const bits: string[] = [];
  if (m.kcal != null) bits.push(`~${Math.round(m.kcal)} kcal`);
  const pcf = [
    m.protein_g != null ? `P${Math.round(m.protein_g)}` : '',
    m.carbs_g != null ? `C${Math.round(m.carbs_g)}` : '',
    m.fat_g != null ? `F${Math.round(m.fat_g)}` : '',
  ]
    .filter(Boolean)
    .join(' ');
  if (pcf) bits.push(pcf);
  return bits.join(' · ');
}
