/**
 * The answer to a question row (docs/cadence/FOOD-LOGGING-COACH-LED.md, "chips in her voice";
 * owner 2026-11-01). When the read could not tell what a part was ("whole or skim?"), the card
 * asks in the coach's words and offers the answers as buttons, with typing kept open. A tap or
 * a typed answer comes here: the words the question was about and the answer become ONE part,
 * and that part goes through the same read as a whole meal — the phrase memory first, the
 * fan-out, one food-check call, the store pricing (food-described-meal.ts `readParts`) — so the
 * answered row is a priced row like any other, and nothing about the read is built twice.
 *
 * One part, whatever its punctuation: an answer with a comma in it is not split into two parts.
 *
 * What the priced row's `said` is decides what the confirm teaches the memory:
 *   - a CHOSEN answer (one of the buttons) keeps the words the question was about ("milk"), so
 *     the confirm teaches "milk" → the record they chose and the next "milk" is a memory hit with
 *     no question (the brand promise: never make them repeat themselves). The row can still be
 *     changed on the card, and a later confirm with another food replaces the memory.
 *   - a TYPED answer keeps the combined words ("lactose-free milk"): a free-text answer can name
 *     a different food altogether, and "milk" must not learn to mean that.
 */
import type { MealKind } from '@cadence/shared';
import { stripAmount, type MealPartLookup } from './food-candidate-book.ts';
import { productionDeps, readParts, type DescribedMealPreview } from './food-described-meal.ts';
import type { DescribedMealDeps } from './food-described-rows.ts';
import { isMeal } from './nutrition-parse.ts';

/** The caps the wire carries (validation/body.ts): a row's words, and a button's or a typed line's worth. */
export const ASKED_ABOUT_MAX = 200;
export const ANSWER_MAX = 120;

/** An answer that joins onto the food's words from behind: "coffee" + "with milk" → "coffee with milk". */
const JOINING = /^(?:with|without|no|in|on|plus|and|from|at|of|for)\b/i;
/** Filler a typed answer may start with — "it was 2%" is "2%". */
const FILLER = /^(?:actually|it was|it's|it is|i think|i had|maybe|probably|the|a|an)\s+/i;
/** "the small one" is "small". */
const TRAILING_ONE = /\s+ones?$/i;

const squash = (s: string): string => s.replace(/\s+/g, ' ').trim();
/** "Whole milk" → "whole milk", "A shake" → "a shake" mid-sentence; "2%", "USDA" untouched. */
const lowerFirst = (s: string): string => (/^[A-Z](?:[a-z]|\s)/.test(s) ? s[0]!.toLowerCase() + s.slice(1) : s);
const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const includesWords = (haystack: string, needle: string): boolean =>
  new RegExp(`(^|\\W)${escapeRe(needle)}(\\W|$)`, 'i').test(haystack);

/**
 * The words the question was about and the answer, as one part: the amount kept in front, the
 * answer merged into the food's words. Table-tested; the rule is what a person would have typed
 * had they said it in one go:
 *   "milk" + "Whole milk" → "whole milk"                   (the answer names the food: it stands alone)
 *   "a glass of milk" + "Skim" → "a glass of skim milk"    (a qualifier goes in front of the food,
 *                                                           after a container the split does not know)
 *   "coffee" + "With milk" → "coffee with milk"            (a joining word goes behind it)
 *   "a parfait" + "The small one" → "a small parfait"
 *   "a glass of milk" + "a glass of oat milk" → "a glass of oat milk"  (the answer carries its own amount)
 */
export function answeredWords(askedAbout: string, answer: string): string {
  const about = squash(askedAbout);
  let a = lowerFirst(squash(answer));
  if (!a) return about;
  let { q } = stripAmount(about);
  if (!q) return a.slice(0, ASKED_ABOUT_MAX);
  let prefix = about.slice(0, about.length - q.length);
  // A container the split does not know ("a glass of milk", "a bowl of rice") stays in front:
  // the food is what follows the last "of", and the answer goes with the food.
  const ofAt = q.toLowerCase().lastIndexOf(' of ');
  if (ofAt >= 0) {
    prefix += q.slice(0, ofAt + 4);
    q = q.slice(ofAt + 4);
  }
  if (prefix.trim() && a.toLowerCase().startsWith(prefix.trim().toLowerCase())) return a.slice(0, ASKED_ABOUT_MAX);
  if (!includesWords(a, q)) {
    a = squash(a.replace(FILLER, '').replace(TRAILING_ONE, ''));
    if (!a) return about;
    if (!includesWords(a, q)) a = JOINING.test(a) ? `${q} ${a}` : `${a} ${q}`;
  }
  return squash(`${prefix}${a}`).slice(0, ASKED_ABOUT_MAX);
}

/** The one lookup for the answered words: never split, the amount peeled off as the split would. */
export function answeredLookup(words: string): MealPartLookup {
  const { q, measure } = stripAmount(words);
  return { said: words, q: q.slice(0, 80), measure, brand: null };
}

export interface AnsweredPartInput {
  /** The row's `asked_about`: their words for the part, amount included. */
  asked_about: string;
  answer: string;
  /** True when the answer was one of the offered choices; false (or absent) when it was typed. */
  chosen?: boolean;
  meal?: MealKind;
}

/**
 * Re-read ONE part with its answer. The preview that comes back holds the row(s) for that part
 * alone — usually one, priced; a question row again when the model still cannot tell — and the
 * card puts them where the asked row was. Throws only when the words are missing.
 */
export async function previewAnsweredPart(
  userId: string,
  input: AnsweredPartInput,
  deps: DescribedMealDeps = productionDeps(userId),
): Promise<DescribedMealPreview> {
  const askedAbout = input.asked_about.trim().slice(0, ASKED_ABOUT_MAX);
  const answer = input.answer.trim().slice(0, ANSWER_MAX);
  if (!askedAbout) throw new Error('an answer needs the words it answers');
  if (!answer) throw new Error('an answer needs words');
  const words = answeredWords(askedAbout, answer);
  const meal: MealKind = input.meal && isMeal(input.meal) ? input.meal : 'other';
  const preview = await readParts(
    userId,
    {
      text: words,
      meal,
      mealHint: input.meal,
      lookups: [answeredLookup(words)],
      not_read: [],
      answered: { asked_about: askedAbout, answer },
    },
    deps,
  );
  if (!input.chosen) return preview;
  // A chosen answer: the priced row's words are the ones the question was about, so the confirm
  // teaches the memory those. A row still waiting (no `said`) is left as it is.
  return { ...preview, items: preview.items.map((r) => (r.said ? { ...r, said: askedAbout } : r)) };
}
