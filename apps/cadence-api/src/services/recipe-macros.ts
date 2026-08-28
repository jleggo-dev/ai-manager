/**
 * Pure per-serving recipe macro math (Req 5 WS3).
 * Σ(ingredient macros) ÷ servings — never free-guessed for the whole dish. (Owner ruling
 * 2026-08-25, FOOD-ENGINE.md §1: a recipe's servings are user-stated, not derived from a yield —
 * even division is immune to however much the pan gave up as steam. `computeMacrosPerServing`
 * below is exactly that division and stays exactly that; there is no yield model to add here.)
 */
import { FOOD_NUTRIENT_KEYS, scaleNutrients, type Food, type FoodNutrients, type Macros } from '@cadence/shared';
import { portionFactor, type PortionInput } from './food-pricing-portion.ts';

function asPositive(n: unknown): number {
  return typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * Round macro fields the same way the food ledger's own `scaleNutrients` does — kcal and grams to
 * 1 decimal, everything else (the micros this file used to drop, see below) to 2. Kept local
 * rather than importing `scaleNutrients`' internal rounding because `Macros` carries `source`,
 * which `FoodNutrients` does not.
 */
export function toMacros(nutrients: FoodNutrients, source: Macros['source'] = 'ai'): Macros {
  const out: Macros = { source };
  for (const key of FOOD_NUTRIENT_KEYS) {
    const v = nutrients[key];
    if (typeof v !== 'number' || !Number.isFinite(v)) continue;
    const places = key === 'kcal' || (key.endsWith('_g') && !key.endsWith('_ug')) ? 1 : 2;
    const f = 10 ** places;
    out[key] = Math.round(v * f) / f;
  }
  return out;
}

/** Sum macro blobs (ignores missing keys). */
export function sumMacros(parts: readonly Macros[]): Macros {
  const acc: FoodNutrients = {};
  for (const part of parts) {
    for (const key of FOOD_NUTRIENT_KEYS) {
      const v = part[key];
      if (typeof v === 'number' && Number.isFinite(v)) acc[key] = (acc[key] ?? 0) + v;
    }
  }
  return toMacros(acc, 'ai');
}

/** Scale macros by a linear factor (e.g. N recipe servings logged). */
export function scaleMacros(macros: Macros, factor: number): Macros {
  const f = Number.isFinite(factor) ? factor : 0;
  if (f === 0) return { source: macros.source ?? 'ai' };
  const nutrients: FoodNutrients = {};
  for (const key of FOOD_NUTRIENT_KEYS) {
    const v = macros[key];
    if (typeof v === 'number' && Number.isFinite(v)) nutrients[key] = v;
  }
  return toMacros(scaleNutrients(nutrients, f), macros.source ?? 'ai');
}

export interface IngredientPricing {
  nutrients: FoodNutrients;
  /** Set when the quantity/unit could not be resolved against this food — see `reason`, and see
   *  `portionFactor` in `food-pricing-portion.ts` for the full decision this summarises. */
  unresolved?: true;
  /** Why, for a caller to act on (a coach tool can surface it, or call `resolve_portion`). Recipe
   *  capture (`recipe.ts`, outside this parcel's file list — see the PR description) does not read
   *  this yet; `macrosForIngredientAmount` below is its current call shape and quietly drops it. */
  reason?: string;
}

/**
 * Macros contributed by one ingredient amount of a known Food, WITH the resolution outcome.
 *
 * MP0c: this used to be a second, independently-written unit resolver — its own g/ml/item checks,
 * its own `servings[].label.includes(unit)` (an unbounded substring test — the exact bug
 * `matchMeasure` was fixed for: a request for "ml" matched a "15ml (16g)" label), and its own
 * silent-default-serving fallback when nothing matched. It disagreed with the log path's
 * `portionFactor` by up to 16× on the same input: 500 ml of evaporated milk matched this food's
 * FIRST ml-labelled serving (15 ml) by substring, then multiplied by the raw request of 500 as if
 * it were 500 OF that serving — 8,000 g, against the log path's already-wrong-but-smaller 500 g.
 * There is exactly one way to turn a quantity and a unit into a mass now (`portionFactor`), and
 * this is a thin caller of it — `text` is threaded through so a bare count with no separate unit
 * field ("3 shallots", `unit` undefined) still has something to resolve against instead of
 * silently defaulting; see `macrosForIngredientAmount` below for callers that don't have it.
 */
export function priceIngredientAmount(
  food: Pick<Food, 'base_unit' | 'macros_per_base' | 'servings' | 'default_serving'>,
  qty: number,
  unit?: string | null,
  text?: string,
): IngredientPricing {
  const q = asPositive(qty);
  if (q === 0) return { nutrients: {} };

  const input: PortionInput = { qty: q, unit: unit ?? undefined, text };
  const portion = portionFactor(food, input);
  const nutrients = portion.factor > 0 ? scaleNutrients(food.macros_per_base, portion.factor) : {};
  return portion.unresolved ? { nutrients, unresolved: true, reason: portion.reason } : { nutrients };
}

/**
 * Backward-compatible shape for `recipe.ts`'s existing three call sites (outside this parcel —
 * P1 owns `recipe-macros.ts`, not `recipe.ts`; MP2 is the call-site work of wiring `resolve_portion`
 * into the recipe path, tracked in PLAN.md against P6). An ingredient whose unit cannot be resolved
 * now returns `{}` — no macros contributed — rather than the food's default serving priced as if it
 * were the answer. `{}` is a safe under-count (recipe.ts already skips missing keys when summing);
 * the old behaviour was a silent, unbounded OVER-count in either direction, which is strictly worse.
 * Prefer `priceIngredientAmount` above for any new caller: it keeps the reason instead of dropping it.
 */
export function macrosForIngredientAmount(
  food: Pick<Food, 'base_unit' | 'macros_per_base' | 'servings' | 'default_serving'>,
  qty: number,
  unit?: string | null,
): FoodNutrients {
  return priceIngredientAmount(food, qty, unit).nutrients;
}

/**
 * Per-serving macros = Σ(ingredient contributions) ÷ servings.
 * Empty when servings ≤ 0 or no ingredient macros.
 */
export function computeMacrosPerServing(ingredientMacros: readonly Macros[], servings: number): Macros {
  const n = Number.isFinite(servings) && servings > 0 ? servings : 0;
  if (n <= 0) return { source: 'ai' };
  const total = sumMacros(ingredientMacros);
  if (
    total.kcal === undefined &&
    total.protein_g === undefined &&
    total.carbs_g === undefined &&
    total.fat_g === undefined
  )
    return { source: 'ai' };
  return scaleMacros(total, 1 / n);
}
