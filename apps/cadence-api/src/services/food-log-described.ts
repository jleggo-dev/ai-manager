/**
 * The coach's one-call write, coach-led (docs/cadence/FOOD-LOGGING-COACH-LED.md, build step 3,
 * 2026-11-01). `log_meal` runs the SAME read as `preview_meal` and the meal screen's doors —
 * `previewDescribedMeal`: the phrase memory first, one fan-out per part, one call to the
 * food-check model, the store pricing — and logs its rows through the SAME confirm path the card
 * uses, `logMeal({ parsed })`: a row that names its food is priced from that food and never
 * re-matched, and only a confirmed pick teaches the memory. So what she logs is what she
 * previewed, and the two tools can no longer price the same words differently (the "venti latte"
 * logged as Matcha, #426).
 *
 * A row the read left OPEN is not logged: one waiting on a question ("whole or 2%?"), or one she
 * could not count (no record fits and no estimate was given). Those come back to her with the
 * words and the question, so she asks in conversation and calls again with the answered words.
 * Never a tentative pick. The settled rows of the same meal ARE logged — a person who said "milk
 * and a banana" has eaten the banana whatever the milk turns out to be — so a second call for the
 * answered part lands as its own row at the same slot.
 *
 * The same words previewed a moment ago run the read AGAIN. A preview writes nothing, and the
 * words can change between the two calls (a size named, a detail added); the repeat costs one
 * food-check call, once — the confirm then teaches the memory, and the next time those words
 * price from it with no call at all. A cache keyed on the words would save that one call and add
 * a staleness rule nobody has measured a need for, so none is built (the doc says what would
 * change that).
 */
import type { MealKind, NutritionLog } from '@cadence/shared';
import { previewDescribedMeal, type DescribedMealPreview } from './food-described-meal.ts';
import { describedTotals, type DescribedMealDeps, type DescribedMealItem } from './food-described-rows.ts';
import { logMeal, type ParsedMealInput } from './nutrition.ts';

export interface DescribedMealLog {
  preview: DescribedMealPreview;
  /** The rows that were logged, as the read produced them — basis and source kept for the answer. */
  logged: DescribedMealItem[];
  /** The rows handed back: an open question, or a part that could not be counted. */
  open: DescribedMealItem[];
  /** The meal as written, read back from the store; null when nothing was logged. */
  row: NutritionLog | null;
}

/** A row the read left open: it waits on an answer, or it counted nothing. Never logged. */
export const isOpenRow = (row: DescribedMealItem): boolean => !!row.question || row.basis === 'none';

/** The card's wire shape for a row — what the confirm reads, none of what the read noted for the card. */
function asParsedItem(row: DescribedMealItem): ParsedMealInput['items'][number] {
  return {
    name: row.name,
    ...(row.brand ? { brand: row.brand } : {}),
    ...(typeof row.qty === 'number' ? { qty: row.qty } : {}),
    ...(row.unit ? { unit: row.unit } : {}),
    ...(row.est ? { est: row.est } : {}),
    ...(row.food_id ? { food_id: row.food_id } : {}),
    ...(row.said ? { said: row.said } : {}),
  };
}

/**
 * Read the words the coach-led way and log every settled row through the card's confirm path.
 * Throws when the read itself fails past its fallback or the write fails — a fault, never an
 * empty answer; the caller says so.
 */
export async function logDescribedMeal(
  userId: string,
  input: { text: string; meal?: MealKind; date?: string },
  deps?: DescribedMealDeps,
): Promise<DescribedMealLog> {
  const preview = await previewDescribedMeal(userId, input.text, input.meal, deps);
  const open = preview.items.filter(isOpenRow);
  const logged = preview.items.filter((r) => !isOpenRow(r));
  if (!logged.length) return { preview, logged, open, row: null };

  const row = await logMeal(userId, {
    parsed: {
      meal: preview.meal,
      items: logged.map(asParsedItem),
      // The total of what is logged, not of the card: an open row is left behind here.
      macros: describedTotals(logged),
      confidence: preview.confidence,
      flags: preview.flags,
      raw_text: preview.raw_text,
      ...(input.date ? { date: input.date } : {}),
    },
  });
  return { preview, logged, open, row };
}
