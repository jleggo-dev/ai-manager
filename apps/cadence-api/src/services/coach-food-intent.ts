/**
 * Req 5 coach food surface — prepare confirm-first actions from a chat turn.
 * Reuses resolve / recipes from-chat / dietary profile; never commits.
 */
import type { DietaryProfile, MealKind } from '@cadence/shared';
import { getDietaryProfile } from '../repos/users.ts';
import { recipeFromChat, type RecipeDraft } from './recipe.ts';
import type { ResolveResult } from './food-resolver.ts';
import {
  classifyFoodIntent,
  mergeDietaryProposal,
  recipeTextFromWindow,
  type ClassifiedFoodIntent,
} from './coach-food-classify.ts';

export {
  classifyFoodIntent,
  FOOD_CONFIRM_CONTEXT,
  mergeDietaryProposal,
  parseUsualMeal,
  type ClassifiedFoodIntent,
  type CoachFoodIntentKind,
} from './coach-food-classify.ts';

export type CoachFoodLogAction = {
  kind: 'log_food';
  query: string;
  mealHint?: MealKind;
  usualMeal?: MealKind;
  resolve: ResolveResult;
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
    /**
     * **No sheet for a meal any more** (owner ruling 2026-08-19): *"logging food should probably
     * just have the AI tell the user to go into the nutrition module… I don't care to have a log
     * nutrition popup like that, it breaks our new nutrition UI."*
     *
     * The Food home is now a real screen with a diary, slot rows and one-tap confirm, so a sheet
     * arriving over the conversation competes with it — and when the classifier is wrong, it
     * interrupts to ask someone to affirm something absurd. The intent is still DETECTED, because
     * the coach is told to point at the module (`FOOD_CONFIRM_CONTEXT`); it just no longer draws
     * anything. Recipes and dietary updates keep their sheets: neither has a screen of its own.
     */
    case 'log_food':
      return null;
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
