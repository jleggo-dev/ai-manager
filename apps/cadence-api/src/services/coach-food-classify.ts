/**
 * Pure coach food-intent classification (Req 5 coach surface).
 * Deterministic — no DB / AIM. prepareCoachFoodAction runs the side effects.
 */
import type { DietaryProfile, MealKind } from '@cadence/shared';
import { DIET_OPTIONS, EMPTY_DIETARY_PROFILE } from '@cadence/shared';

export type CoachFoodIntentKind = 'log_food' | 'save_recipe' | 'dietary_update';

export interface ClassifiedLogFood {
  kind: 'log_food';
  /** Text to resolve (after stripping "I had" / "usual …"). */
  query: string;
  /** When the user said "usual breakfast" etc. */
  usualMeal?: MealKind;
  mealHint?: MealKind;
}

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

export type ClassifiedFoodIntent = ClassifiedLogFood | ClassifiedSaveRecipe | ClassifiedDietary;

const MEAL_WORDS: MealKind[] = ['breakfast', 'lunch', 'dinner', 'snack'];

/** Context injected so the coach never claims a log/save before the user confirms. */
export const FOOD_CONFIRM_CONTEXT = [
  'FOOD SURFACE (app confirm sheet): the user may be logging food, saving a recipe, or updating dietary prefs.',
  'Acknowledge what you heard and wait — the app shows a confirm sheet. Nothing is logged or saved until they confirm.',
  'Never claim you already logged a meal, saved a recipe, or updated allergies/diet.',
].join(' ');

function hasDietaryIntent(t: string): boolean {
  return (
    /\b(allergic to|allergy to|allergies?\b|can'?t eat|cannot eat|intoleran)/i.test(t) ||
    /\bi'?m (a )?(vegan|vegetarian|pescatarian|halal|kosher)\b/i.test(t) ||
    /\bi (follow|eat|am) (a )?(vegan|vegetarian|pescatarian|gluten[- ]free|dairy[- ]free)\b/i.test(t) ||
    /\b(dislike|don'?t like|hate)\b/i.test(t)
  );
}

function hasSaveRecipeIntent(t: string): boolean {
  return (
    /\bsave (that |this |it |them )?as a recipe\b/i.test(t) ||
    /\b(make|structure|turn) (this |that |it )?into a recipe\b/i.test(t) ||
    /\bi made\b.+\b(makes?|serves?)\s*\d+/i.test(t) ||
    /\b(makes?|serves?)\s*\d+\b.+\bi made\b/i.test(t)
  );
}

/**
 * Words that mean this turn is about TRAINING, sleep or mood — not eating. Their presence vetoes a
 * "had"-based guess outright, because someone describing a session is not describing a meal.
 */
const NOT_FOOD_CONTEXT =
  /\b(run|runs|running|ran|walk|walked|jog|ride|rode|cycl\w*|swim|swam|lift\w*|workout|training|session|reps?|sets?|pace|tempo|zone \d|heart ?rate|hr\b|bpm|km|kms|kilometers?|miles?|mins? of|stretch\w*|mobility|yoga|meditat\w*|breathwork|journal\w*|sleep|slept|nap|mood|stress|anxious|physio|injur\w*|knee|shoulder|elbow|ankle|back pain)\b/i;

/** Nouns that follow "had a/an" and are never food, however they are modified. */
const NOT_FOOD_NOUN =
  /\b(time|day|week|weekend|month|year|morning|afternoon|evening|night|go|chat|talk|think|rest|break|nap|shower|call|meeting|look|feeling|sense|moment|problem|issue|setback|flare|episode)\b/i;

/**
 * Does this turn say what they ATE?
 *
 * "had" is an auxiliary verb far more often than it is eating, and every version of this function
 * that tried to enumerate the non-eating phrasings has eventually lost to English. Two shipped
 * failures paid for the rules below:
 *  - "I do at least one beast a year, but I HAD TO skip it this year" → a confirm sheet offering
 *    to log one Spartan Beast, for breakfast, at ~2000 kcal.
 *  - "That last run was good but I HAD A REALLY HARD TIME keeping my HR in zone 2" → the food
 *    estimator was handed a run and dutifully priced it as `{"name":"That last run"}`. The old
 *    guard listed adjectives immediately after "had a", so a single adverb walked straight past it.
 *
 * So the shape changed. A blocklist of phrasings cannot win; what these rules do instead is demand
 * that "had" be UNCONTRADICTED — the turn must not be about training, sleep or mood, and the thing
 * had must not be one of the nouns nobody eats. `ate`/`drank` need no such help: they are specific
 * verbs that mean one thing. A wrong draft is expensive here — the sheet interrupts a conversation
 * to ask someone to affirm something absurd, which is exactly how confirm-first loses trust rather
 * than earning it — so when the signal is only "had", silence is the correct answer.
 */
function hasLogFoodIntent(t: string): boolean {
  if (/\b(my )?usual\s+(breakfast|lunch|dinner|snack)\b/i.test(t)) return true;
  if (/\blog (my |this |that |the )?(breakfast|lunch|dinner|snack|meal|food|it)\b/i.test(t)) return true;

  // Specific verbs: eating is the only thing they mean.
  if (/\b(ate|drank)\b/i.test(t) && !/\bwant to (eat|drink|have)\b/i.test(t)) return true;

  // "had": only when nothing in the turn contradicts it.
  if (!/\bhad\b/i.test(t)) return false;
  if (/\bwant to (eat|have)\b/i.test(t)) return false;
  if (/\bhad\s+(to|been|enough)\b/i.test(t)) return false;
  // "had a really hard time", "had an absolutely brutal week" — any modifiers, then a non-food noun.
  if (/\bhad\s+(a|an|the)\s+(?:\w+\s+){0,3}?(?=\w)/i.test(t) && NOT_FOOD_NOUN.test(t)) return false;
  // A meal word makes it unambiguous even in a busy sentence ("after my run I had breakfast").
  if (/\bhad\s+(my\s+|a\s+|an\s+|the\s+)?(breakfast|lunch|dinner|snack|meal|coffee|tea)\b/i.test(t)) return true;
  if (NOT_FOOD_CONTEXT.test(t)) return false;
  return true;
}

/** Extract "usual breakfast" → breakfast. */
export function parseUsualMeal(message: string): MealKind | undefined {
  const m = message.match(/\b(?:my )?usual\s+(breakfast|lunch|dinner|snack)\b/i);
  if (!m) return undefined;
  const meal = m[1]!.toLowerCase() as MealKind;
  return MEAL_WORDS.includes(meal) ? meal : undefined;
}

/** Soft meal hint from phrasing ("for lunch", "this morning"). */
export function parseMealHint(message: string): MealKind | undefined {
  const usual = parseUsualMeal(message);
  if (usual) return usual;
  const forMeal = message.match(/\b(?:for|as)\s+(breakfast|lunch|dinner|snack)\b/i);
  if (forMeal) return forMeal[1]!.toLowerCase() as MealKind;
  if (/\bthis morning\b/i.test(message)) return 'breakfast';
  if (/\btonight\b/i.test(message)) return 'dinner';
  return undefined;
}

/** Strip lead-ins so the resolver sees the food phrase. */
export function extractLogQuery(message: string): string {
  let q = message.trim();
  q = q.replace(/^(hey[,.]?\s+|ok[,.]?\s+|yeah[,.]?\s+)/i, '');
  q = q.replace(/^(i\s+)?(just\s+)?(had|ate|drank|logged)\s+(my\s+)?/i, '');
  q = q.replace(/^log\s+(my\s+|this\s+|that\s+|the\s+)?/i, '');
  q = q.replace(/\bfor\s+(breakfast|lunch|dinner|snack)\s*$/i, '');
  q = q.replace(/\s+/g, ' ').trim();
  return q;
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
 * Classify a coach turn for food surface actions.
 * Priority: dietary → save_recipe → log_food (most specific first).
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

  if (hasLogFoodIntent(t)) {
    const usualMeal = parseUsualMeal(t);
    const mealHint = parseMealHint(t);
    const query = usualMeal ? usualMeal : extractLogQuery(t);
    if (!query && !usualMeal) return null;
    return {
      kind: 'log_food',
      query: query || usualMeal || t,
      ...(usualMeal ? { usualMeal } : {}),
      ...(mealHint ? { mealHint } : {}),
    };
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
