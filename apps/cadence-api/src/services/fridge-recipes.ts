/**
 * Req 5 Phase 4 — fridge/pantry photo → ingredient list → recipe draft ideas.
 * Confirm-before-save: parse + generate never persist; caller uses POST /nutrition/recipes.
 */
import { runJobBySlug } from '../ai/aim.ts';
import { getDietaryProfile, getUser } from '../repos/users.ts';
import { logAi } from './ai-log.ts';
import {
  formatIngredientsForJob,
  parseFridgePhotoResult,
  parseGenerateRecipeResult,
  type FridgeIngredient,
  type ParsedFridgePhoto,
} from './fridge-parse.ts';
import { putMealPhoto, signMealPhotoUrl } from './meal-photos.ts';
import { buildDraftFromStructured, type RecipeDraft } from './recipe.ts';

const today = (): string => new Date().toISOString().slice(0, 10);

export type { FridgeIngredient, ParsedFridgePhoto };

export interface FridgeGenerateResult {
  drafts: RecipeDraft[];
  /** Warm coach line from the job (or app fallback when nothing safe to suggest). */
  notes: string | null;
  /** Count of ideas dropped for allergen hard-flags (never silently suggested). */
  filtered_allergy: number;
}

async function uploadAndSign(userId: string, photoDataUrl: string): Promise<{ photoRef: string; signedUrl: string }> {
  const photoRef = await putMealPhoto(userId, today(), photoDataUrl);
  const signedUrl = await signMealPhotoUrl(photoRef);
  return { photoRef, signedUrl };
}

/**
 * Fridge/pantry photo → visible ingredient list (unsaved). User reviews before generate.
 */
export async function parseFridgePhoto(
  userId: string,
  input: { photo: string; hint?: string },
): Promise<ParsedFridgePhoto> {
  const { photoRef, signedUrl } = await uploadAndSign(userId, input.photo);
  let rawOut = '';
  try {
    const res = await runJobBySlug(
      userId,
      'parse-fridge-photo',
      { hint: (input.hint ?? '').trim().slice(0, 200) },
      { images: [signedUrl] },
    );
    rawOut = res.formatted ?? res.raw ?? '';
    const shaped = parseFridgePhotoResult(rawOut, photoRef);
    void logAi(userId, {
      kind: 'parse_fridge_photo',
      input: { hint: input.hint ?? null },
      output: { raw: rawOut.slice(0, 2000) },
      meta: {
        photo_ref: photoRef,
        photo_readable: shaped.photo_readable,
        confidence: shaped.confidence,
        ingredients: shaped.ingredients.length,
      },
    });
    return shaped;
  } catch (e) {
    console.warn('[fridge-recipes] parse-fridge-photo failed:', e);
    void logAi(userId, {
      kind: 'parse_fridge_photo',
      input: { hint: input.hint ?? null },
      output: { raw: rawOut.slice(0, 500), error: e instanceof Error ? e.message : String(e) },
      meta: { photo_ref: photoRef },
    });
    throw e instanceof Error ? e : new Error('parse-fridge-photo failed');
  }
}

function dietaryJobVars(profile: Awaited<ReturnType<typeof getDietaryProfile>>): {
  allergies: string;
  diet: string;
  dislikes: string;
} {
  return {
    allergies: (profile?.allergies ?? []).join(', '),
    diet: profile?.diet?.trim() || '',
    dislikes: (profile?.dislikes ?? []).join(', '),
  };
}

/**
 * Confirmed ingredient list → 1–3 recipe drafts with resolved macros + dietary flags.
 * Allergen-unsafe ideas are dropped (hard safety — never silently suggested).
 */
export async function generateRecipesFromIngredients(
  userId: string,
  input: { ingredients: FridgeIngredient[]; meal_hint?: string },
): Promise<FridgeGenerateResult> {
  const ingredients = input.ingredients
    .map((i) => ({
      name: i.name.trim().slice(0, 80),
      ...(typeof i.qty === 'number' && i.qty > 0 ? { qty: i.qty } : {}),
      ...(i.unit?.trim() ? { unit: i.unit.trim().slice(0, 24) } : {}),
    }))
    .filter((i) => i.name);
  if (ingredients.length === 0) throw new Error('at least one ingredient required');

  const profile = await getDietaryProfile(userId);
  const user = await getUser(userId);
  const targets = user?.macro_targets ? JSON.stringify(user.macro_targets) : '';
  const dietVars = dietaryJobVars(profile);

  let rawOut = '';
  try {
    const res = await runJobBySlug(userId, 'generate-recipe', {
      ingredients: formatIngredientsForJob(ingredients),
      allergies: dietVars.allergies,
      diet: dietVars.diet,
      dislikes: dietVars.dislikes,
      targets,
      meal_hint: (input.meal_hint ?? '').trim().slice(0, 200),
    });
    rawOut = res.formatted ?? res.raw ?? '';
  } catch (e) {
    console.warn('[fridge-recipes] generate-recipe failed:', e);
    throw e instanceof Error ? e : new Error('generate-recipe failed');
  }

  const bundle = parseGenerateRecipeResult(rawOut);
  const drafts: RecipeDraft[] = [];
  let filtered_allergy = 0;

  for (let i = 0; i < bundle.recipes.length; i++) {
    const structured = bundle.recipes[i]!;
    const tags = bundle.tags[i] ?? [];
    const draft = await buildDraftFromStructured(userId, structured, 'ai_from_fridge_photo', tags);
    if (!draft.dietary.safe) {
      filtered_allergy += 1;
      console.info('[fridge-recipes] dropped allergen-flagged recipe idea:', draft.name);
      continue;
    }
    drafts.push(draft);
  }

  let notes = bundle.notes;
  if (drafts.length === 0) {
    notes =
      notes ||
      (filtered_allergy > 0
        ? "I couldn't suggest anything that stays clear of your allergies with what's there — tweak the list or tell me what else you have."
        : "I couldn't shape a recipe from that list — add a couple more foods or a note about what you're in the mood for.");
  }

  void logAi(userId, {
    kind: 'generate_recipe',
    input: {
      ingredients: ingredients.map((i) => i.name),
      meal_hint: input.meal_hint ?? null,
    },
    output: { raw: rawOut.slice(0, 2000) },
    meta: {
      drafts: drafts.length,
      filtered_allergy,
      generated: bundle.recipes.length,
    },
  });

  return { drafts, notes, filtered_allergy };
}
