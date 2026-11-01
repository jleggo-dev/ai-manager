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
 * What the confirm teaches the memory is the priced row's `said`, and it is the COMBINED words
 * the read ran on ("whole milk"), whether the answer was tapped or typed — owner's ruling,
 * 2026-11-02: "No, ask each time." The confirm teaches "whole milk" → the record, so the next
 * "whole milk" is a hit with no call; the bare words ("milk") are never taught, and the next
 * "milk" is asked again. `chosen` rides to the ai_log row only, to tell taps from typing.
 *
 * A row that comes back as a question AGAIN carries those combined words as its `asked_about`
 * — our own merge, never the model's echo of it — so the next answer builds on this one ("whole
 * milk" + "Light" → "light whole milk"). The card caps the re-asks (REASKS_MAX on the web) and
 * falls back to the amount chips.
 */
import { ANSWER_MAX_CHARS, ASKED_ABOUT_MAX_CHARS, type MealKind } from '@cadence/shared';
import { stripAmount, type MealPartLookup } from './food-candidate-book.ts';
import { productionDeps, readParts, type DescribedMealPreview } from './food-described-meal.ts';
import type { DescribedMealDeps } from './food-described-rows.ts';
import { isMeal } from './nutrition-parse.ts';

/** The caps the wire carries (validation/body.ts and the card's field share them through @cadence/shared). */
export const ASKED_ABOUT_MAX = ASKED_ABOUT_MAX_CHARS;
export const ANSWER_MAX = ANSWER_MAX_CHARS;

/** An answer that joins onto the food's words from behind: "coffee" + "with milk" → "coffee with milk". */
const JOINING = /^(?:with|without|no|in|on|plus|and|from|at|of|for)\b/i;
/** Filler a typed answer may start with — "it was 2%" is "2%", "I think skim" is "skim". Taken off once. */
const FILLER = /^(?:actually|it was|it's|it is|i think|i had|maybe|probably|just)\s+/i;
/** An article in front of the answer, taken off once after the filler: "it was a yogurt bowl" → "yogurt bowl". */
const ARTICLE = /^(?:the|a|an)\s+/i;
/** "the small one" is "small". */
const TRAILING_ONE = /\s+ones?$/i;
/**
 * Words that qualify a food rather than name one: "skim milk", "black coffee", "cooked rice",
 * "whole wheat bread". A one-word answer that is none of these and reads as a plural ("Almonds",
 * "Oats") names a food of its own and replaces the question's food.
 */
const QUALIFIERS = new Set([
  'skim',
  'whole',
  'plain',
  'regular',
  'large',
  'small',
  'medium',
  'black',
  'cooked',
  'raw',
  'dry',
  'uncooked',
  'sweetened',
  'unsweetened',
  'decaf',
  'iced',
  'hot',
  'light',
  'lite',
  'nonfat',
  'lowfat',
  'low-fat',
  'fat-free',
  'full-fat',
  'sugar-free',
  'fried',
  'boiled',
  'grilled',
  'baked',
  'roasted',
  'toasted',
  'fresh',
  'frozen',
  'canned',
  'homemade',
  'white',
  'brown',
  'wholemeal',
  'half',
  'double',
  'single',
  'tall',
  'grande',
  'venti',
  'extra',
  'mini',
  'diet',
  'zero',
  'crispy',
  'soft',
  'hard',
  'ripe',
  'green',
  'red',
  'sweet',
  'salted',
  'unsalted',
  'smoked',
  'lean',
  'thick',
  'thin',
  'scrambled',
  'poached',
  'steamed',
  'instant',
  'wild',
]);
/** Things that go INTO a food rather than replace it: "a latte" + "oat milk" → "a latte with oat milk". */
const INGREDIENT_TAIL =
  /\b(?:milk|cream|creamer|sugar|syrup|sauce|dressing|cheese|butter|ice|honey|jam|mayo|mayonnaise|ketchup|mustard|gravy|oil|sweetener)$/i;
/** One-word answers that end in "s" but are not a plural noun. */
const NOT_PLURAL = /^(?:plus|minus|less|yes|this|its|always|sometimes)$/i;

const squash = (s: string): string => s.replace(/\s+/g, ' ').trim();
/** "Whole milk" → "whole milk", "A shake" → "a shake" mid-sentence; "2%", "USDA" untouched. */
const lowerFirst = (s: string): string => (/^[A-Z](?:[a-z]|\s)/.test(s) ? s[0]!.toLowerCase() + s.slice(1) : s);
const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const includesWords = (haystack: string, needle: string): boolean =>
  new RegExp(`(^|\\W)${escapeRe(needle)}(\\W|$)`, 'i').test(haystack);
/** "a" before a vowel sound reads "an", and the other way round — "a orange" never reaches the model. */
function article(prefix: string, next: string): string {
  const vowel = /^[aeiou]/i.test(next);
  if (/(^|\s)a $/i.test(prefix) && vowel) return prefix.replace(/a $/i, 'an ');
  if (/(^|\s)an $/i.test(prefix) && !vowel) return prefix.replace(/an $/i, 'a ');
  return prefix;
}
/** A one-word answer that reads as a plural noun ("Almonds", "Oats") rather than a qualifier ("Skinless", "Plus"). */
const pluralNoun = (w: string): boolean => /[a-z]s$/i.test(w) && !/ss$/i.test(w) && !NOT_PLURAL.test(w);

/**
 * The words the question was about and the answer, as one part: the amount kept in front, the
 * answer merged into the food's words. Table-tested (food-described-answer.test.ts); the rule is
 * what a person would have typed had they said it in one go, decided by what the answer is:
 *   - it restates the amount ("a glass of oat milk" for "a glass of milk") → it stands alone;
 *   - it names the food's words ("whole milk" for "milk") → it stands in for them;
 *   - a joining word ("with milk") → behind the food: "coffee with milk";
 *   - a list that starts with a part or a cut ("breast, no skin") → the food first: "chicken breast, no skin";
 *   - one qualifying word ("skim", "2%", "cooked", "large") → in front: "a glass of skim milk";
 *   - one plural noun ("almonds") → a food of its own, it REPLACES the question's: "a handful of almonds";
 *   - several words ending in something that goes into a food ("oat milk" for a latte) → "a latte with oat milk";
 *   - several words starting with a qualifier ("whole wheat") → in front: "whole wheat bread";
 *   - several words naming a food of their own ("almond beverage", "yogurt bowl") → they REPLACE it.
 * Filler ("it was"), one article and "the … one" are taken off a typed answer first, once each.
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
  const cut = (s: string): string => squash(s).slice(0, ASKED_ABOUT_MAX);
  const inFront = (w: string): string => cut(`${article(prefix, w)}${w} ${q}`);
  const behind = (w: string): string => cut(`${prefix}${q} ${w}`);
  const instead = (w: string): string => cut(`${article(prefix, w)}${w}`);

  // The answer restates the amount ("a glass of oat milk" for "a glass of milk"): it stands alone.
  // A lone article is not an amount — "A large one" for "a latte" is a size, not a restatement.
  const pre = prefix.trim().toLowerCase();
  const lower = a.toLowerCase();
  if (pre && !/^(?:a|an|the|one)$/.test(pre) && (lower === pre || lower.startsWith(`${pre} `))) return cut(a);
  if (includesWords(a, q)) return instead(a);
  if (includesWords(q, a)) return cut(`${prefix}${q}`);
  a = squash(a.replace(FILLER, '').replace(ARTICLE, '').replace(TRAILING_ONE, ''));
  if (!a) return about;
  if (includesWords(a, q)) return instead(a);
  if (JOINING.test(a)) return behind(a);
  if (a.includes(',')) return behind(a);
  const words = a.split(' ');
  if (words.length === 1) {
    const w = words[0]!;
    if (QUALIFIERS.has(w.toLowerCase()) || /%$/.test(w) || !pluralNoun(w)) return inFront(w);
    return instead(w);
  }
  if (QUALIFIERS.has(words[0]!.toLowerCase())) return inFront(a);
  if (INGREDIENT_TAIL.test(a)) return behind(`with ${a}`);
  return instead(a);
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
  /** True when the answer was one of the offered choices; false (or absent) when typed. Logged only. */
  chosen?: boolean;
  meal?: MealKind;
}

/**
 * Re-read ONE part with its answer. The preview that comes back holds the row(s) for that part
 * alone — usually one, priced; a question row again when the model still cannot tell, carrying
 * the ORIGINAL words to re-read with — and the card puts them where the asked row was. Throws
 * only when the words are missing.
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
      // The merged words ride on the log, so a merge that misfired is visible on the ai_log row;
      // `chosen` tells a tapped answer from a typed one there, and nowhere else.
      answered: { asked_about: askedAbout, answer, words, chosen: !!input.chosen },
      // The photo reader's notes belong to the whole reading and never reach the client: an
      // answered part is read like typed words, with no notes.
      notes: '',
    },
    deps,
  );
  // A question again: it is about the words the read ran on (our merge, not the model's echo),
  // so the next answer builds on this one. Every other row keeps the combined words as `said`.
  const items = preview.items.map((r) => (r.question ? { ...r, asked_about: words } : r));
  return { ...preview, items };
}
