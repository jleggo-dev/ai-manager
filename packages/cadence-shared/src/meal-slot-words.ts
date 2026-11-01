/**
 * The ONE regex that decides whether the words of a described meal name the slot it belongs to —
 * "two eggs and toast for breakfast", "a salad at lunch", "chicken with dinner", "an apple as a
 * snack", "Breakfast: eggs" (FOOD-LOGGING-COACH-LED.md, step 3 review 2026-11-01).
 *
 * The coach-led read takes the slot as an input and no step of it guesses one, where the old
 * `parse-meal` path inferred it from the words. So when the caller names no slot, the words are
 * asked once, here, and the same rule serves the read, its fallback and the coach's tools — the
 * fallback must never take `parse-meal`'s own guess, or the same words would land in different
 * slots depending on provider health.
 *
 * Named EXPLICITLY means a preposition (or a leading "Slot:") in front of the slot word: "a
 * breakfast bar", "lunchbox", "a dinner roll", "the lunch special" and "brunch" name a food or a
 * time, not a slot, and leave it unset. The compound nouns a slot word can lead are listed in the
 * lookahead; a new one that reads wrong gets a row in the test before it ships.
 *
 * The phrase that named the slot is not food: `readMealSlot` hands back the words without it, so
 * the lookups are made for "a banana", not "a banana for breakfast", and the phrase memory keys on
 * the same words whichever way the slot was said.
 */
import type { MealKind } from './types/nutrition.ts';

const SLOT = '(breakfast|lunch|dinner|supper|snacks?)';
/** "…for breakfast", "at lunch", "with dinner", "as a snack", "after my supper". */
const AFTER_PREPOSITION = new RegExp(
  `\\b(?:for|at|with|as|after|before|during)\\s+(?:(?:a|an|my|the|our|today's|tonight's)\\s+)?${SLOT}\\b` +
    `(?!\\s*(?:bars?|rolls?|box(?:es)?|burritos?|sandwich(?:es)?|specials?|wraps?|bowls?|plates?|menus?|meetings?|tables?|party|parties|dates?|time|breaks?|hour)\\b)`,
  'i',
);
/** "Breakfast: eggs", "lunch — a salad", "Dinner was chicken". */
const LEADING = new RegExp(`^\\s*${SLOT}\\s*(?:[:=\\-–—]|was|is)\\s`, 'i');

const SLOT_KIND: Record<string, MealKind> = {
  breakfast: 'breakfast',
  lunch: 'lunch',
  dinner: 'dinner',
  supper: 'dinner',
  snack: 'snack',
  snacks: 'snack',
};

export interface MealSlotRead {
  /** The slot the words name explicitly, or null when they name none. */
  slot: MealKind | null;
  /** The words with the slot phrase taken out (whitespace and a stray comma tidied); the words as given when none was named. */
  rest: string;
}

/** The slot the words name, and the words without the phrase that named it. */
export function readMealSlot(text: string): MealSlotRead {
  const hit = AFTER_PREPOSITION.exec(text) ?? LEADING.exec(text);
  const word = hit?.[1];
  const slot = word ? (SLOT_KIND[word.toLowerCase()] ?? null) : null;
  if (!hit || !slot) return { slot: null, rest: text };
  const rest = (text.slice(0, hit.index) + ' ' + text.slice(hit.index + hit[0].length))
    .replace(/\s+,/g, ',')
    .replace(/^\s*,\s*/, '')
    .replace(/\s*,\s*$/, '')
    .replace(/\s+/g, ' ')
    .trim();
  return { slot, rest: rest || text };
}

/** The slot the words name explicitly, or null when they name none. */
export function mealSlotInWords(text: string): MealKind | null {
  return readMealSlot(text).slot;
}
