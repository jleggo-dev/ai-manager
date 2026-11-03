/**
 * "Not quite" — the person read the card and said what was wrong (owner, 2026-11-02: "I can
 * only really select Looks right — what if it's wrong? How do I fix it or indicate what's
 * wrong?"). The words are read again the same way (food-described-meal.ts), with the previous
 * answer and the correction handed to the food-check as its `notes`, so the model fixes what was
 * named and keeps the rest. Two things differ from a plain read:
 *   - the phrase memory is skipped: a remembered row is exactly what a correction may be about,
 *     and the memory would hand the same row back without a call;
 *   - the correction rides on the ai_log row, so a re-read that still got it wrong can be seen.
 * Nothing is written: the confirm after the re-read teaches the memory, as it always has.
 */
import { CORRECTION_MAX_CHARS, PREVIOUS_ROW_MAX_CHARS, PREVIOUS_ROWS_MAX } from '@cadence/shared';

export interface MealCorrection {
  /** What the person said was wrong, in their words. */
  words: string;
  /** The previous answer's rows as the card showed them, one line each ("Focaccia, 1 piece"). */
  previous: string[];
}

/** The first line of the notes: what the model is to do with what follows. */
export const CORRECTION_LEAD =
  'The person read the previous answer and said what was wrong. Fix what they named and keep the rest; a food the correction names counts as said.';

/**
 * The `notes` variable for a corrected read, bounded by the wire's own caps (the route refuses
 * more, so these cuts only ever trim what a caller other than the card sends).
 */
export function correctionNotes(c: MealCorrection): string {
  const previous = c.previous
    .slice(0, PREVIOUS_ROWS_MAX)
    .map((l) => l.trim().slice(0, PREVIOUS_ROW_MAX_CHARS))
    .filter(Boolean)
    .map((l) => `- ${l}`);
  const words = c.words.trim().slice(0, CORRECTION_MAX_CHARS);
  return [
    CORRECTION_LEAD,
    'Previous answer:',
    ...(previous.length ? previous : ['- (no rows were shown)']),
    `Their correction: "${words}"`,
  ].join('\n');
}
