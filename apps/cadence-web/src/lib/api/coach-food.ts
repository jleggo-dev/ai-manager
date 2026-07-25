/**
 * Coach food surface (Req 5) — POST /coach/food-actions.
 * Confirm drafts only; commit uses existing nutrition routes.
 */
import type { DietaryProfile, MealKind } from '@cadence/shared';
import { BASE, headers } from './http.ts';
import type { ResolveCandidate } from './foods-resolve.ts';
import { parseRecipeDraft, type RecipeDraft } from './recipes.ts';

export type CoachFoodLogAction = {
  kind: 'log_food';
  query: string;
  mealHint?: MealKind;
  usualMeal?: MealKind;
  resolve: {
    candidates: ResolveCandidate[];
    preselected: ResolveCandidate | null;
  };
};

export type CoachFoodRecipeAction = {
  kind: 'save_recipe';
  recipeText: string;
  draft: RecipeDraft;
};

export type CoachFoodDietaryAction = {
  kind: 'dietary_update';
  current: DietaryProfile;
  proposed: DietaryProfile;
};

export type CoachFoodAction = CoachFoodLogAction | CoachFoodRecipeAction | CoachFoodDietaryAction;

export type CoachFoodActionResult =
  | { status: 'ok'; action: CoachFoodAction | null }
  | { status: 'unavailable' | 'error'; action: null; message?: string };

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object';
}

function parseCandidate(raw: unknown): ResolveCandidate | null {
  if (!isRecord(raw)) return null;
  if (raw.kind !== 'food' && raw.kind !== 'recipe' && raw.kind !== 'new') return null;
  if (typeof raw.label !== 'string' || !raw.label.trim()) return null;
  return {
    kind: raw.kind,
    score: typeof raw.score === 'number' ? raw.score : 0,
    label: raw.label.trim(),
    ...(typeof raw.food_id === 'string' ? { food_id: raw.food_id } : {}),
    ...(typeof raw.recipe_id === 'string' ? { recipe_id: raw.recipe_id } : {}),
    brand: typeof raw.brand === 'string' ? raw.brand : raw.brand === null ? null : undefined,
    ...(typeof raw.preselected_serving === 'number' ? { preselected_serving: raw.preselected_serving } : {}),
    ...(typeof raw.inferred_quantity === 'number' ? { inferred_quantity: raw.inferred_quantity } : {}),
  };
}

function parseDietary(raw: unknown): DietaryProfile | null {
  if (!isRecord(raw)) return null;
  return {
    allergies: Array.isArray(raw.allergies) ? raw.allergies.filter((x): x is string => typeof x === 'string') : [],
    diet: typeof raw.diet === 'string' ? raw.diet : null,
    dislikes: Array.isArray(raw.dislikes) ? raw.dislikes.filter((x): x is string => typeof x === 'string') : [],
    notes: typeof raw.notes === 'string' ? raw.notes : null,
  };
}

function parseAction(raw: unknown): CoachFoodAction | null {
  if (!isRecord(raw) || typeof raw.kind !== 'string') return null;
  if (raw.kind === 'log_food') {
    const resolveRaw = isRecord(raw.resolve) ? raw.resolve : null;
    const candidates = Array.isArray(resolveRaw?.candidates)
      ? resolveRaw.candidates.map(parseCandidate).filter((c): c is ResolveCandidate => !!c)
      : [];
    const preselected = resolveRaw?.preselected ? parseCandidate(resolveRaw.preselected) : null;
    return {
      kind: 'log_food',
      query: typeof raw.query === 'string' ? raw.query : '',
      resolve: { candidates, preselected },
      ...(raw.mealHint === 'breakfast' ||
      raw.mealHint === 'lunch' ||
      raw.mealHint === 'dinner' ||
      raw.mealHint === 'snack' ||
      raw.mealHint === 'drink' ||
      raw.mealHint === 'other'
        ? { mealHint: raw.mealHint }
        : {}),
      ...(raw.usualMeal === 'breakfast' ||
      raw.usualMeal === 'lunch' ||
      raw.usualMeal === 'dinner' ||
      raw.usualMeal === 'snack'
        ? { usualMeal: raw.usualMeal }
        : {}),
    };
  }
  if (raw.kind === 'save_recipe') {
    const draft = parseRecipeDraft(raw.draft);
    if (!draft) return null;
    return {
      kind: 'save_recipe',
      recipeText: typeof raw.recipeText === 'string' ? raw.recipeText : '',
      draft,
    };
  }
  if (raw.kind === 'dietary_update') {
    const current = parseDietary(raw.current);
    const proposed = parseDietary(raw.proposed);
    if (!current || !proposed) return null;
    return { kind: 'dietary_update', current, proposed };
  }
  return null;
}

/** Prepare a confirm-first food action from a coach turn. Soft-fails to null. */
export async function prepareCoachFoodAction(input: {
  message: string;
  window?: string;
}): Promise<CoachFoodActionResult> {
  try {
    const res = await fetch(`${BASE}/coach/food-actions`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({
        message: input.message,
        ...(input.window ? { window: input.window } : {}),
      }),
    });
    if (res.status === 404) return { status: 'unavailable', action: null };
    if (!res.ok) return { status: 'error', action: null, message: `food-actions ${res.status}` };
    const body = (await res.json()) as { action?: unknown };
    return { status: 'ok', action: parseAction(body.action) };
  } catch {
    return { status: 'unavailable', action: null };
  }
}
