/**
 * Pure coach food-intent classification for the two surfaces with NO screen of their own: a
 * captured recipe and a dietary-profile change. Both still produce a confirm card via
 * `POST /coach/food-actions` (coach-food-intent.ts) because neither has a Food-tab equivalent to
 * finish on.
 *
 * WHAT USED TO LIVE HERE AND WHY IT DOES NOT ANY MORE (MP21/MP40, FOOD-ENGINE.md §7): a third
 * kind, `log_food`, ran a second, parallel regex pass over every message to decide whether the
 * Coach was told `FOOD_CONFIRM_CONTEXT` — a paragraph whose first job was telling her what she may
 * not say ("you do NOT log food yourself"). That was the software deciding and the Coach being
 * managed around it, exactly the inversion TOOL-HARNESS.md exists to reject. She now has real
 * tools — `preview_meal` and `log_meal` — and calls them herself; nothing needs to classify a
 * message as "about food" first. Deleted with it: `hasLogFoodIntent`, the `NOT_FOOD_CONTEXT` /
 * `SOMEONE_ELSE_HAD` / `NOT_FOOD_NOUN` guards built to keep that regex from firing on training
 * reports and someone else's meal, `parseUsualMeal`, `parseMealHint`, `extractLogQuery`, and
 * `FOOD_CONFIRM_CONTEXT` itself. The burden those guards carried moves to her judgement — see the
 * restraint cases in `scripts/eval-tool-selection-cases.ts`.
 */
import type { DietaryProfile } from '@cadence/shared';
import { DIET_OPTIONS, EMPTY_DIETARY_PROFILE } from '@cadence/shared';

export type CoachFoodIntentKind = 'save_recipe' | 'dietary_update';

export interface ClassifiedSaveRecipe {
  kind: 'save_recipe';
  /** Description for structure_recipe; may be empty when "save that" needs a window. */
  recipeText: string;
  needsWindow: boolean;
}

export interface ClassifiedDietary {
  kind: 'dietary_update';
  patch: Partial<DietaryProfile>;
}

export type ClassifiedFoodIntent = ClassifiedSaveRecipe | ClassifiedDietary;

function hasDietaryIntent(t: string): boolean {
  return (
    /\b(allergic to|allergy to|allergies?\b|can'?t eat|cannot eat|intoleran)/i.test(t) ||
    /\bi'?m (a )?(vegan|vegetarian|pescatarian|halal|kosher)\b/i.test(t) ||
    /\bi (follow|eat|am) (a )?(vegan|vegetarian|pescatarian|gluten[- ]free|dairy[- ]free)\b/i.test(t) ||
    /\b(dislike|don'?t like|hate)\b/i.test(t)
  );
}

/**
 * A line that reads as one recipe ingredient — a leading quantity, then either a unit attached
 * directly ("680g") or at least a space before the next word ("3 shallots"). The second form is
 * deliberately loose (recipes name bare counts constantly — "2 eggs", "3 shallots") but the
 * mandatory boundary is what keeps a rep scheme ("3x10 squats") from reading as one: "3x10" has no
 * space and "x10" is not a recognised unit, so neither branch matches it.
 */
const INGREDIENT_LINE =
  /^[-*•]?\s*[\d½¼¾⅓⅔]+(?:[./]\d+)?\s*(?:g|kg|mg|ml|l|oz)\b|^[-*•]?\s*[\d½¼¾⅓⅔]+(?:[./]\d+)?\s+[a-zA-Z]/;

function looksLikeIngredientList(t: string): boolean {
  const lines = t
    .split(/\n+/)
    .map((l) => l.trim())
    .filter(Boolean);
  return lines.filter((l) => INGREDIENT_LINE.test(l)).length >= 3;
}

/**
 * MP6 — the regex gate on recipe capture, widened rather than removed.
 *
 * Recipes keep a confirm card because they have no Food-screen equivalent to finish on (unlike a
 * plain meal, which now goes through `preview_meal`/`log_meal`), so SOMETHING still has to decide
 * a message described a dish worth structuring. The old gate required a literal "I made" plus a
 * literal "makes N" / "serves N" — and the meal-prep scenario's own message matches neither: it
 * says "Made the mushroom sauce" (no "I"), and "Yields 3 cups" is not "makes" or "serves". The
 * sauce would never have been captured (FOOD-ENGINE.md MP6).
 *
 * Widened on two axes: "yields" now counts as a stated amount alongside "makes"/"serves", and a
 * cooking verb next to a genuine ingredient LIST (3+ lines that read as one ingredient each) is
 * accepted even with no stated yield at all — the shape of "Made the mushroom sauce:" followed by
 * eleven quantity-led lines. A false positive here costs an unwanted confirm CARD the user
 * dismisses, not a silent write, so the bar is lower than it was for the deleted log_food path.
 */
function hasSaveRecipeIntent(t: string): boolean {
  if (/\bsave (that |this |it |them )?as a recipe\b/i.test(t)) return true;
  if (/\b(make|structure|turn) (this |that |it )?into a recipe\b/i.test(t)) return true;
  const hasStatedYield = /\b(yields?|makes?|serves?)\s*\d+/i.test(t);
  const cooked = /\b(made|cooked|prepped|prepared)\b/i.test(t);
  return cooked && (hasStatedYield || looksLikeIngredientList(t));
}

/** Propose a dietary profile patch from chat (merge later with current). */
export function proposeDietaryPatch(message: string): Partial<DietaryProfile> {
  const patch: Partial<DietaryProfile> = {};
  const t = message.trim();

  const allergyMatch = t.match(
    /\b(?:allergic to|allergy to|allergies?(?:\s+to)?|can'?t eat|cannot eat)\s+([^.!?\n]+)/i,
  );
  if (allergyMatch) {
    const terms = allergyMatch[1]!
      .split(/,|\band\b/i)
      .map((s) => s.replace(/\b(please|thanks|though)\b/gi, '').trim())
      .filter((s) => s.length >= 2 && s.length <= 40);
    if (terms.length) patch.allergies = terms;
  }

  for (const opt of DIET_OPTIONS) {
    const re = new RegExp(`\\b${opt.replace('-', '[- ]?')}\\b`, 'i');
    if (re.test(t) && /\b(i'?m|i am|i follow|i eat|going)\b/i.test(t)) {
      patch.diet = opt;
      break;
    }
  }

  const dislikeMatch = t.match(/\b(?:dislike|don'?t like|hate)\s+([^.!?\n]+)/i);
  if (dislikeMatch) {
    const terms = dislikeMatch[1]!
      .split(/,|\band\b/i)
      .map((s) => s.trim())
      .filter((s) => s.length >= 2 && s.length <= 40);
    if (terms.length) patch.dislikes = terms;
  }

  return patch;
}

/** Merge a proposed patch onto the current profile (confirm-before-save). */
export function mergeDietaryProposal(
  current: DietaryProfile | null | undefined,
  patch: Partial<DietaryProfile>,
): DietaryProfile {
  const base = current ?? { ...EMPTY_DIETARY_PROFILE };
  const uniq = (arr: string[]) => [...new Set(arr.map((s) => s.trim().toLowerCase()).filter(Boolean))];
  return {
    allergies: patch.allergies ? uniq([...base.allergies, ...patch.allergies]) : [...base.allergies],
    diet: patch.diet !== undefined ? patch.diet : base.diet,
    dislikes: patch.dislikes ? uniq([...base.dislikes, ...patch.dislikes]) : [...base.dislikes],
    notes: patch.notes !== undefined ? patch.notes : base.notes,
  };
}

/**
 * Classify a coach turn for the two food surfaces with no screen of their own.
 * Priority: dietary → save_recipe (most specific first). Everything else — including every plain
 * meal — is null here and reaches the Coach as an ordinary turn with real tools to call.
 */
export function classifyFoodIntent(message: string): ClassifiedFoodIntent | null {
  const t = message.trim();
  if (!t || t.length > 2000) return null;

  if (hasDietaryIntent(t)) {
    const patch = proposeDietaryPatch(t);
    if (!patch.allergies?.length && patch.diet == null && !patch.dislikes?.length) return null;
    return { kind: 'dietary_update', patch };
  }

  if (hasSaveRecipeIntent(t)) {
    const needsWindow = /\bsave (that |this |it |them )?as a recipe\b/i.test(t) && !/\bi made\b/i.test(t);
    const recipeText = needsWindow ? '' : t;
    return { kind: 'save_recipe', recipeText, needsWindow };
  }

  return null;
}

/** Pull the best recipe description from a conversation window when "save that" has no detail. */
export function recipeTextFromWindow(window: string, fallbackMessage: string): string {
  const lines = window
    .split(/\n+/)
    .map((l) => l.replace(/^(User|Coach):\s*/i, '').trim())
    .filter(Boolean);
  // Prefer the latest user line that looks like a dish description.
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]!;
    if (/\bi made\b/i.test(line) || /\b(ingredients?|serves?|makes?)\b/i.test(line)) return line;
    if (line.length >= 24 && !/\bsave .+as a recipe\b/i.test(line)) return line;
  }
  return fallbackMessage.trim();
}
