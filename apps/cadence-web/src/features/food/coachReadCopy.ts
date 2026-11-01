/**
 * What the described-meal doors say about who read the meal (FOOD-LOGGING-COACH-LED.md). One
 * module for the chat door, the quick-log sheet and the photo door, so the wording cannot drift
 * between them. UI copy names the role — "the coach" — never the product (owner, 2026-09-06).
 */

/**
 * Said while the read runs — plain, and about what is actually happening. It said "Reading
 * that…", which named nothing (owner, 2026-09-07: "it should clearly say what it's doing").
 * Since 2026-11-01 the reading is the coach's: the software checks every source, she decides once.
 */
export const READING = 'The coach is checking your foods and the food databases…';

/**
 * When she could not be reached: the old automatic estimate priced it, and the notice says so.
 * The sentence alone, so a surface without tap-to-edit (the quick-log sheet) can show it as is.
 */
export const NOT_REACHED = "The coach couldn't be reached just now, so these are automatic estimates.";

/** The confirm card's version: its rows open an editor, so it adds the hint. */
export const NOT_REACHED_CARD = `${NOT_REACHED} Tap a row to change anything.`;

/** On the card when an answer's re-read fell back to the automatic estimate: that one row is not hers. */
export const NOT_REACHED_ANSWER =
  "The coach couldn't be reached for that answer, so that row is an automatic estimate.";

/** The line above the confirm card when she read it. */
export const FOUND_CARD = "Here's what I found — an amount you gave I've kept; anything you didn't, I'll ask.";
