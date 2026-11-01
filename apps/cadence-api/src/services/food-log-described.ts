/**
 * The coach's one-call write, coach-led (docs/cadence/FOOD-LOGGING-COACH-LED.md, build step 3,
 * 2026-11-01). `log_meal` runs the SAME read as `preview_meal` and the meal screen's doors —
 * `previewDescribedMeal`: the phrase memory first, one fan-out per part, one call to the
 * food-check model, the store pricing — and logs its rows through the SAME confirm path the card
 * uses, `logMeal({ parsed })`, after the SAME validation the card's rows pass
 * (`parsedMealSchema`): a row that names its food is priced from that food and never re-matched,
 * and only a confirmed pick teaches the memory. So what she logs is what she previewed, and the
 * two tools can no longer price the same words differently (the "venti latte" logged as Matcha,
 * #426).
 *
 * A row the read left OPEN is not logged: one waiting on a question ("whole or 2%?"), or one she
 * could not count (no record fits and no estimate was given). Those come back to her with the
 * words and the question, so she asks in conversation and calls again with the answered words.
 * Never a tentative pick. The settled rows of the same meal ARE logged — a person who said "milk
 * and a banana" has eaten the banana whatever the milk turns out to be — so a second call for the
 * answered part lands as its own row at the same slot.
 *
 * What the confirm did to a row is read back for the answer: a row the read left unlinked (an
 * estimate, a fallback row) that the store then matched by name and priced from a food is told as
 * priced from that food, never as the coach's estimate it no longer is.
 *
 * The same words previewed a moment ago run the read AGAIN. A preview writes nothing, and the
 * words can change between the two calls (a size named, a detail added); the repeat costs one
 * food-check call, once — the confirm then teaches the memory, and the next time those words
 * price from it with no call at all. A cache keyed on the words would save that one call and add
 * a staleness rule nobody has measured a need for, so none is built (the doc says what would
 * change that).
 */
import type { MealKind, NutritionLog } from '@cadence/shared';
import { getFoodsByIds } from '../repos/foods.ts';
import { parsedMealSchema } from '../validation/body.ts';
import { previewDescribedMeal, type DescribedMealPreview } from './food-described-meal.ts';
import type { CoachRow } from './food-described-render.ts';
import { describedTotals, type DescribedMealDeps, type DescribedMealItem } from './food-described-rows.ts';
import { logMeal, type ParsedMealInput } from './nutrition.ts';

/** The card's own bound on a row's words (validation/body.ts): the phrase memory keys on them. */
const SAID_MAX = 200;
const BRAND_MAX = 120;

export interface DescribedMealLog {
  preview: DescribedMealPreview;
  /** The rows the read settled, as the read produced them. */
  logged: DescribedMealItem[];
  /** The rows handed back: an open question, or a part that could not be counted. */
  open: DescribedMealItem[];
  /** The meal as written, read back from the store; null when nothing was logged. */
  row: NutritionLog | null;
  /**
   * The logged rows as the answer tells them: the stored row (name, amount, numbers, link) with
   * the read's notes beside it, and `priced_by_name` on a row the confirm linked that the read had
   * not. Empty when nothing was logged.
   */
  written: CoachRow[];
}

/** The read's rows did not pass the card's own caps — the reason names the row and the rule. */
export class DescribedMealRejected extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = 'DescribedMealRejected';
  }
}

/** A row the read left open: it waits on an answer, or it counted nothing. Never logged. */
export const isOpenRow = (row: DescribedMealItem): boolean => !!row.question || row.basis === 'none';

/**
 * The card's wire shape for a row — what the confirm reads, none of what the read noted for the
 * card. Their words are cut at the card's bound, as the card's are.
 */
function asParsedItem(row: DescribedMealItem): ParsedMealInput['items'][number] {
  return {
    name: row.name,
    ...(row.brand ? { brand: row.brand.slice(0, BRAND_MAX) } : {}),
    ...(typeof row.qty === 'number' ? { qty: row.qty } : {}),
    ...(row.unit ? { unit: row.unit } : {}),
    ...(row.est ? { est: row.est } : {}),
    ...(row.food_id ? { food_id: row.food_id } : {}),
    ...(row.said ? { said: row.said.slice(0, SAID_MAX) } : {}),
  };
}

/** The rows through the card's validator — one set of caps for both doors. */
function validated(parsed: ParsedMealInput): ParsedMealInput {
  const result = parsedMealSchema.safeParse(parsed);
  if (!result.success) {
    const why = result.error.issues
      .slice(0, 3)
      .map((i) => `${i.path.join('.') || 'meal'}: ${i.message}`)
      .join('; ');
    throw new DescribedMealRejected(why);
  }
  return result.data as ParsedMealInput;
}

/**
 * The logged rows as the answer tells them. The confirm keeps order and drops none, so the stored
 * rows pair with the read's by position; a count mismatch falls back to the read's rows. A stored
 * row linked to a food the read had not linked was matched by name on the confirm: its number is
 * the store's now, and the row says so, with the food's name when it can be read.
 */
async function writtenRows(
  logged: DescribedMealItem[],
  row: NutritionLog,
  deps: Pick<DescribedMealDeps, 'foods'>,
): Promise<CoachRow[]> {
  if (row.items.length !== logged.length) return logged;
  const byName = row.items.flatMap((s, i) => (s.food_id && !logged[i]!.food_id ? [s.food_id] : []));
  let names = new Map<string, string>();
  if (byName.length) {
    try {
      names = new Map((await deps.foods(byName)).map((f) => [f.food_id, f.name]));
    } catch (e) {
      console.warn('[food-log-described] matched foods read failed — naming none:', e instanceof Error ? e.message : e);
    }
  }
  return logged.map((r, i) => {
    const stored = row.items[i]!;
    const matched = !!stored.food_id && !r.food_id;
    return { ...r, ...stored, ...(matched ? { priced_by_name: names.get(stored.food_id!) ?? null } : {}) };
  });
}

/**
 * Read the words the coach-led way and log every settled row through the card's confirm path.
 * Throws when the read itself fails past its fallback, the rows fail the card's caps
 * (`DescribedMealRejected`, with the reason), or the write fails — a fault, never an empty
 * answer; the caller says so.
 */
export async function logDescribedMeal(
  userId: string,
  input: { text: string; meal?: MealKind; date?: string },
  deps?: DescribedMealDeps,
): Promise<DescribedMealLog> {
  const preview = await previewDescribedMeal(userId, input.text, input.meal, deps);
  const open = preview.items.filter(isOpenRow);
  const logged = preview.items.filter((r) => !isOpenRow(r));
  if (!logged.length) return { preview, logged, open, row: null, written: [] };

  const parsed = validated({
    meal: preview.meal,
    items: logged.map(asParsedItem),
    // The total of what is logged, not of the card: an open row is left behind here.
    macros: describedTotals(logged),
    confidence: preview.confidence,
    flags: preview.flags,
    raw_text: preview.raw_text,
    ...(input.date ? { date: input.date } : {}),
  });
  const row = await logMeal(userId, { parsed });
  const written = await writtenRows(logged, row, deps ?? { foods: (ids) => getFoodsByIds(userId, ids) });
  return { preview, logged, open, row, written };
}
