/**
 * Coach food surface (Req 5) — POST /coach/food-actions.
 * Confirm drafts only; commit uses existing nutrition routes.
 */
import type { DietaryProfile } from '@cadence/shared';
import { BASE, headers } from './http.ts';
import { parseRecipeDraft, type RecipeDraft } from './recipes.ts';

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

export type CoachFoodAction = CoachFoodRecipeAction | CoachFoodDietaryAction;

export type CoachFoodActionResult =
  | { status: 'ok'; action: CoachFoodAction | null }
  | { status: 'unavailable' | 'error'; action: null; message?: string };

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object';
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
