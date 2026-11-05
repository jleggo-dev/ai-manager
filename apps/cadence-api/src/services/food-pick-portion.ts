/**
 * A pick becomes a row: the model said WHICH record and WHICH of its measures, how many; the
 * store says how much that is. `priceFood` does the arithmetic, never the model
 * (TOOL-HARNESS.md: "the model says WHAT, the store says HOW MUCH").
 *
 * The row also has to survive the round trip to the card and back — the confirm re-prices every
 * linked item from its food with the row's own `qty`/`unit` (food-pricing.ts). So the portion
 * written on the row is chosen to re-price to the same numbers: the measure's own word when
 * `priceFood` reads it back the same ("1 medium", "1.5 cup"), grams otherwise — and the word only
 * ever counts what the label counts, so half a breast is never called one. A portion that
 * cannot be read back at all is still priced here, and the confirm keeps the card's numbers for
 * it rather than re-guessing (`portionReadsBack` says which happened).
 */
import { scaleNutrients, servingFactor, type Food, type FoodNutrients, type FoodServing } from '@cadence/shared';
import { priceFood } from './food-pricing-portion.ts';
import { parseMeasure } from './portion-measure.ts';
import type { MeasureOption } from './food-source-report.ts';

export interface PickPortion {
  qty: number;
  unit: string;
  est: FoodNutrients;
  /** True when the confirm's re-pricing (`priceFood` with qty/unit) gives these same numbers. */
  reads_back: boolean;
}

type PricedFood = Pick<Food, 'base_unit' | 'macros_per_base' | 'servings' | 'default_serving'>;

const round1 = (n: number): number => Math.round(n * 10) / 10;

function sameNumbers(a: FoodNutrients, b: FoodNutrients): boolean {
  const keys = Object.keys(b) as Array<keyof FoodNutrients>;
  if (!keys.length) return false;
  return keys.every((k) => {
    const x = a[k];
    const y = b[k];
    return typeof x === 'number' && typeof y === 'number' && Math.abs(x - y) <= Math.max(0.05, Math.abs(y) * 0.005);
  });
}

function servingByLabel(food: PricedFood, label: string): FoodServing | null {
  const want = label.trim().toLowerCase();
  return (Array.isArray(food.servings) ? food.servings : []).find((s) => s.label.trim().toLowerCase() === want) ?? null;
}

/**
 * The row for one pick. `measure` is the book's entry (label + grams per one), `count` how many.
 * Grams picks pass `{ label: 'g', grams: 1 }`. Null only when the food cannot price the measure
 * at all (a per-item food asked for in grams).
 */
export function portionForPick(food: PricedFood, measure: MeasureOption, count: number): PickPortion | null {
  const grams = measure.grams * count;
  const byGrams = food.base_unit === 'g' || food.base_unit === 'ml';
  const serving = measure.label === 'g' ? null : servingByLabel(food, measure.label);

  let est: FoodNutrients;
  if (byGrams) est = scaleNutrients(food.macros_per_base, grams / 100);
  else if (serving) est = scaleNutrients(food.macros_per_base, servingFactor(food.base_unit, serving, count));
  else return null;
  if (!Object.keys(est).length) return null;

  // Candidates in the order a person would rather read them; the first that reads back wins.
  const candidates: Array<{ qty: number; unit: string }> = [];
  if (serving) {
    // The number the label opens with belongs to the amount. FatSecret's "1/2 medium" keeps the half
    // in its label and not in its unit, so two of them read "2 medium breast" for one breast, the
    // right 196 g under the wrong words (2026-11-04). In the label's own count the word must still
    // read back; when it does not, the row says grams.
    const measure = parseMeasure(serving.label);
    const qty = count * measure.qty;
    const unitWord = serving.unit?.trim();
    // A researched food keeps its whole label as its unit ("1 wrap", "12 fl oz"): the row would say
    // "0.5 1 wrap". The noun below is that word without its number.
    if (unitWord && !/^\d/.test(unitWord) && !['g', 'ml', 'item', 'serving'].includes(unitWord.toLowerCase()))
      candidates.push({ qty, unit: unitWord });
    const noun = measure.countOf.split(/\s+/)[0] ?? '';
    if (noun && noun !== unitWord) candidates.push({ qty, unit: noun });
  }
  if (byGrams) candidates.push({ qty: round1(grams), unit: food.base_unit });
  else if (serving) candidates.push({ qty: count, unit: serving.unit || 'serving' });

  for (const c of candidates) {
    const back = priceFood(food, { qty: c.qty, unit: c.unit, text: `${c.qty} ${c.unit}` });
    if (sameNumbers(back, est)) return { ...c, est, reads_back: true };
  }
  const fallback = candidates[candidates.length - 1] ?? { qty: count, unit: 'serving' };
  return { ...fallback, est, reads_back: false };
}
