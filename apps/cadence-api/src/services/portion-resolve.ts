/**
 * The shallots rung: how much does "1/4 cup" of THIS food weigh?
 *
 * Owner's case (2026-08-23): *"Cadence looks up 1/4 c shallots. USDA has shallots, but only by oz.
 * Cadence should be able to look up how much 1/4 c of shallots typically weighs (on the internet)
 * and do that math."*
 *
 * TWO HALVES, AND THEY MUST NOT BE THE SAME HALF. The model's job is the fact — *a quarter cup of
 * chopped shallots is about 40 g* — which is exactly what a language model is good at and what no
 * table in this repo contains. The arithmetic is `priceFood`'s, downstream, on a row that now has a
 * quarter-cup serving. So this returns GRAMS and never nutrients: a model that multiplies for us
 * reintroduces the variance the ledger exists to remove (TOOL-HARNESS: the model says WHAT, the
 * store says HOW MUCH).
 *
 * THE ANSWER IS PERMANENT, WHICH IS WHY IT IS WORTH BUYING. A cup of shallots weighs the same next
 * Tuesday and weighs the same for everybody, so the result is appended to the food's `servings[]`
 * and the next log of the same words never asks again. Same manufacture-determinism loop as the
 * food ledger, pointed at portions instead of nutrients — the system gets faster the more it runs.
 *
 * WHAT STOPS A BAD ANSWER STICKING: `checkPlausible` rejects any weight implying a density outside
 * what real food occupies, and the append is idempotent on the label, so a published USDA measure
 * can never be overwritten by a guessed one. A rejected lookup is REPORTED, not swallowed — the
 * Coach is told the number was refused and why, because "I could not convert that" and "I converted
 * it wrong" must never look the same to her.
 */
import { runJobBySlug } from '../ai/aim.ts';
import { appendFoodServing, getFood } from '../repos/foods.ts';
import { logAi } from './ai-log.ts';
import { matchMeasure } from './food-source-report.ts';
import { checkPlausible, gramsPerUnit, parseMeasure, type ParsedMeasure } from './portion-measure.ts';
import type { Food, FoodServing } from '@cadence/shared';

/** Household weights are one short question; nothing here needs a reasoning model's deliberation. */
const PORTION_TIMEOUT_MS = 90_000;

export type PortionOutcome =
  /** The food already carried this measure — free, deterministic, and the common case over time. */
  | { status: 'known'; grams: number; measure: string; food: Food }
  /** Looked up, guarded, and written back so it is `known` from now on. */
  | { status: 'looked_up'; grams: number; measure: string; food: Food; basis: string; stored: boolean }
  /** The measure already names a mass — there was nothing to convert. */
  | { status: 'already_mass'; grams: number; measure: string; food: Food }
  /** Asked and refused, or asked and got nothing. The reason is for the Coach to read. */
  | { status: 'unresolved'; measure: string; food: Food | null; reason: string };

function num(v: unknown): number | null {
  const n = typeof v === 'string' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
}

function firstJsonObject(raw: string): Record<string, unknown> | null {
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    const parsed = JSON.parse(raw.slice(start, end + 1)) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export interface PortionLookup {
  grams: number;
  /** Where the number came from, in the model's words — carried through to the Coach. */
  basis: string;
}

/**
 * Ask for the weight of one household measure of one food. Null on any failure — never throws.
 *
 * Kept separate from `resolvePortion` so the guard, the write-back and the reporting can be tested
 * without a model in the loop.
 */
export async function lookupPortionGrams(
  userId: string,
  foodName: string,
  measure: ParsedMeasure,
): Promise<PortionLookup | null> {
  let rawOut = '';
  try {
    const res = await Promise.race([
      runJobBySlug(userId, 'resolve-portion', {
        food_text: foodName.slice(0, 200),
        measure_text: measure.label,
        measure_ml: measure.ml === null ? '' : String(Math.round(measure.ml * 100) / 100),
      }),
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error(`resolve-portion timed out after ${PORTION_TIMEOUT_MS}ms`)),
          PORTION_TIMEOUT_MS,
        ),
      ),
    ]);
    rawOut = res.formatted ?? res.raw ?? '';
    const parsed = firstJsonObject(rawOut);
    const grams = num(parsed?.grams);
    const basis = typeof parsed?.basis === 'string' ? parsed.basis.slice(0, 300) : '';

    void logAi(userId, {
      kind: 'resolve_portion',
      input: { food_text: foodName, measure_text: measure.label },
      output: { raw: rawOut.slice(0, 1000) },
      meta: { grams, accepted: grams !== null && grams > 0 },
    });

    return grams !== null && grams > 0 ? { grams, basis } : null;
  } catch (e) {
    console.warn('[portion-resolve] resolve-portion failed:', e);
    void logAi(userId, {
      kind: 'resolve_portion',
      input: { food_text: foodName, measure_text: measure.label },
      output: { raw: rawOut.slice(0, 500), error: e instanceof Error ? e.message : String(e) },
      meta: { accepted: false },
    });
    return null;
  }
}

/** The serving row a resolved lookup becomes. Unit is the measure's own word, so it matches again. */
export function servingFor(measure: ParsedMeasure, grams: number): FoodServing {
  return {
    label: measure.label,
    unit: measure.kind === 'count' ? 'item' : measure.unit,
    amount_g: Math.round(grams * 100) / 100,
  };
}

export interface ResolvePortionInput {
  foodId: string;
  /** "1/4 cup", "3 shallots", "1 tbsp chopped" — as the person said it. */
  measure: string;
}

/**
 * Resolve one measure against one food, buying the answer only when the food does not already
 * carry it, and keeping whatever it buys.
 */
export async function resolvePortion(userId: string, input: ResolvePortionInput): Promise<PortionOutcome> {
  const measure = parseMeasure(input.measure);
  const food = await getFood(userId, input.foodId);
  if (!food) {
    return { status: 'unresolved', measure: measure.label, food: null, reason: 'no such food on file' };
  }

  /**
   * A mass is checked FIRST, before the food's own servings.
   *
   * "680 g" needs nothing from anybody — it already IS the answer — and letting it fall through to
   * the servings match was a live bug: a food carrying a "100 g" row matched on the unit and the
   * item priced at 68,000 g. A weight is never a question about this food.
   */
  if (measure.kind === 'mass' && measure.grams !== null) {
    return { status: 'already_mass', grams: measure.grams, measure: measure.label, food };
  }

  /**
   * Already ours — free, and the whole point of writing answers back.
   *
   * Both sides are normalised to ONE unit before multiplying. A stored row may carry its quantity
   * in the label ("1/4 cup" at 40 g) or not ("1 shallot" at 25 g), so reading `amount_g` as
   * per-unit silently divides or multiplies the answer by whatever the label happened to say.
   */
  const existing = matchMeasure(food, measure.label) ?? matchMeasure(food, input.measure);
  if (existing) {
    return { status: 'known', grams: gramsPerUnit(existing) * measure.qty, measure: existing.label, food };
  }

  const name = [food.brand, food.name].filter(Boolean).join(' ');
  const found = await lookupPortionGrams(userId, name, measure);
  if (!found) {
    return {
      status: 'unresolved',
      measure: measure.label,
      food,
      reason: 'the lookup came back with no usable weight',
    };
  }

  /**
   * The guard runs BEFORE the write, and its refusal is reported rather than swallowed. A wrong
   * portion written to a shared row would be wrong for everyone, forever — the one failure worse
   * than not knowing.
   */
  const verdict = checkPlausible(measure, found.grams);
  if (!verdict.ok) {
    console.warn(`[portion-resolve] rejected ${found.grams}g for "${measure.label}" of ${name}: ${verdict.reason}`);
    return {
      status: 'unresolved',
      measure: measure.label,
      food,
      reason: `a weight came back but was refused — ${verdict.reason}`,
    };
  }

  let stored = false;
  try {
    // Store the SINGLE-unit weight, so the row reads "1/4 cup = 40 g" whatever quantity was asked
    // about; `priceFood` multiplies by the quantity at log time.
    const perUnit = found.grams / Math.max(measure.qty, Number.EPSILON);
    const single = parseMeasure(`1 ${measure.kind === 'count' ? measure.countOf : measure.unit}`);
    stored = (await appendFoodServing(food.food_id, servingFor(single, perUnit))) !== null;
  } catch (e) {
    // A failed write costs the next lookup, never this one — the grams are already good.
    console.warn('[portion-resolve] could not store the resolved measure:', e);
  }

  return { status: 'looked_up', grams: found.grams, measure: measure.label, food, basis: found.basis, stored };
}
