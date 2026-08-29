/**
 * Req 5 coach food surface — prepare confirm-first actions from a chat turn, for the two kinds
 * with no screen of their own: a captured recipe and a dietary-profile change.
 *
 * MP21/MP40 (FOOD-ENGINE.md §7): a plain meal used to classify here too (`kind: 'log_food'`) and
 * `materializeAction` always returned null for it — the sheet was retired 2026-08-19 and the kind
 * survived only to drive `FOOD_CONFIRM_CONTEXT` from a different call site (coach-context.ts). Both
 * are gone now: she has `preview_meal` and `log_meal` as real tools and calls them herself, so
 * nothing needs to classify a message as "about food" before she can act on it.
 */
import type { DietaryProfile } from '@cadence/shared';
import { getDietaryProfile } from '../repos/users.ts';
import { recipeFromChat, type RecipeDraft } from './recipe.ts';
import {
  classifyFoodIntent,
  mergeDietaryProposal,
  recipeTextFromWindow,
  type ClassifiedFoodIntent,
} from './coach-food-classify.ts';

export {
  classifyFoodIntent,
  mergeDietaryProposal,
  type ClassifiedFoodIntent,
  type CoachFoodIntentKind,
} from './coach-food-classify.ts';

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

export interface PrepareFoodActionInput {
  message: string;
  /** Recent conversation (user+coach) for "save that as a recipe". */
  window?: string;
}

/**
 * Classify + prepare a confirm-first food action for the coach UI.
 * Returns null when the turn is not a food-surface intent.
 */
export async function prepareCoachFoodAction(
  userId: string,
  input: PrepareFoodActionInput,
): Promise<CoachFoodAction | null> {
  const message = typeof input.message === 'string' ? input.message.trim() : '';
  if (!message) return null;

  const classified = classifyFoodIntent(message);
  if (!classified) return null;

  return materializeAction(userId, classified, message, input.window);
}

async function materializeAction(
  userId: string,
  classified: ClassifiedFoodIntent,
  message: string,
  window: string | undefined,
): Promise<CoachFoodAction | null> {
  switch (classified.kind) {
    case 'save_recipe': {
      const recipeText = classified.needsWindow
        ? recipeTextFromWindow(window ?? '', message)
        : classified.recipeText || message;
      if (!recipeText.trim()) return null;
      try {
        const draft = await recipeFromChat(userId, recipeText);
        return { kind: 'save_recipe', recipeText, draft };
      } catch (e) {
        console.warn('[coach-food] structure recipe failed:', e);
        return null;
      }
    }
    case 'dietary_update': {
      const current = (await getDietaryProfile(userId)) ?? {
        allergies: [],
        diet: null,
        dislikes: [],
        notes: null,
      };
      const proposed = mergeDietaryProposal(current, classified.patch);
      return { kind: 'dietary_update', current, proposed };
    }
    default: {
      const _exhaustive: never = classified;
      return _exhaustive;
    }
  }
}
