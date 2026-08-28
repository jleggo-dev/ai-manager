/**
 * Pure portion arithmetic for the food ledger (A23 §1a) — no DB, no AI, no clock.
 *
 * Two inverse operations, and they must stay inverse:
 *   • `portionFactor` — how much of a saved food's base a logged "3 eggs" / "170 g yogurt" is.
 *   • `nutrientsPerBase` — the reverse, used when PINNING a one-off estimate as a reusable food.
 *
 * The trap this module exists to contain: a unit can name an ABSOLUTE AMOUNT ("170 g") or a
 * SERVING ("1 bowl"), and treating the first like the second multiplies the meal by 170. So the
 * unit decides the branch, explicitly, in one tested place.
 *
 * FOOD-ENGINE.md §2.1 named the bug this file used to have: `absoluteAmount` ran whenever a food's
 * `base_unit` was g OR ml, with no check that the unit ASKED FOR was the same kind — so "500 ml"
 * of a `base_unit:'g'` food read as 500 g (MP0a). And where that path didn't fire, the servings
 * match had exactly one failure mode: not recognising a unit fell through to the food's OWN
 * default serving, multiplied by whatever quantity was asked — "3 shallots" priced at 3× the
 * food's 100 g fallback, "1 tbsp rosemary" at its 100 g fallback outright. Two different silent
 * substitutions, same shape: *not knowing* came out as *a plausible number* instead of a question.
 * `portionFactor` now returns `unresolved: true` with a `reason` in that case — see the module's
 * final section for the design and MP1 for why the servings match now reaches further than it did.
 */
import { scaleNutrients, servingFactor, type Food, type FoodNutrients, type FoodServing } from '@cadence/shared';
import { inferQuantity, normalizeResolveText } from './food-resolver-rank.ts';
import { matchMeasure, parseMeasure, scaleFromOwnMeasures } from './portion-measure.ts';

/** Units naming an absolute amount of mass/volume, in base units (g or ml). */
const ABSOLUTE_UNITS: Record<string, { amount: number; kind: 'mass' | 'volume' }> = {
  g: { amount: 1, kind: 'mass' },
  gm: { amount: 1, kind: 'mass' },
  gram: { amount: 1, kind: 'mass' },
  grams: { amount: 1, kind: 'mass' },
  kg: { amount: 1000, kind: 'mass' },
  kilogram: { amount: 1000, kind: 'mass' },
  kilograms: { amount: 1000, kind: 'mass' },
  oz: { amount: 28.3495, kind: 'mass' },
  ounce: { amount: 28.3495, kind: 'mass' },
  ounces: { amount: 28.3495, kind: 'mass' },
  lb: { amount: 453.592, kind: 'mass' },
  lbs: { amount: 453.592, kind: 'mass' },
  pound: { amount: 453.592, kind: 'mass' },
  pounds: { amount: 453.592, kind: 'mass' },
  ml: { amount: 1, kind: 'volume' },
  milliliter: { amount: 1, kind: 'volume' },
  millilitre: { amount: 1, kind: 'volume' },
  milliliters: { amount: 1, kind: 'volume' },
  millilitres: { amount: 1, kind: 'volume' },
  l: { amount: 1000, kind: 'volume' },
  liter: { amount: 1000, kind: 'volume' },
  litre: { amount: 1000, kind: 'volume' },
  liters: { amount: 1000, kind: 'volume' },
  litres: { amount: 1000, kind: 'volume' },
};

/**
 * "cup", "bowl", "slice" and friends are deliberately NOT here: a food that has a cup serving
 * should use its own cup, and one that doesn't should not have a volume invented for it.
 */
export function absoluteAmount(unit: string | undefined, qty: number | undefined): number | null {
  if (!unit || typeof qty !== 'number' || !Number.isFinite(qty) || qty <= 0) return null;
  const key = normalizeResolveText(unit).replace(/\s+/g, '');
  const hit = ABSOLUTE_UNITS[key];
  return hit ? qty * hit.amount : null;
}

/** Which kind of absolute unit this word names, or null when it isn't one — "tbsp"/"cup"/"can"
 *  are never absolute units (see the comment above `absoluteAmount`), so this returns null for
 *  them and `portionFactor` treats them as named servings instead. */
function absoluteUnitKind(unit: string | undefined): 'mass' | 'volume' | null {
  if (!unit) return null;
  const key = normalizeResolveText(unit).replace(/\s+/g, '');
  return ABSOLUTE_UNITS[key]?.kind ?? null;
}

/** The food's own preselect index, bounds-checked — used ONLY when nobody named a unit at all
 *  (see the "nothing was said" branch in `portionFactor`). Not a resolution fallback: there is
 *  nothing to have failed to resolve when nothing was asked. */
function defaultServingIndex(defaultServing: number, length: number): number {
  return Number.isInteger(defaultServing) && defaultServing >= 0 && defaultServing < length ? defaultServing : 0;
}

export interface PortionInput {
  /** Quantity the user ate, when the parse gave one. */
  qty?: number;
  /** Unit as spoken/parsed ("g", "bowl", "container"). */
  unit?: string;
  /** Free text for serving inference when the unit alone is not enough. */
  text?: string;
}

export interface Portion {
  /** Multiplier against `macros_per_base`. */
  factor: number;
  /** servings[] index describing this portion, or null when the amount was absolute or derived. */
  serving_index: number | null;
  /** Unit label for the log row. */
  unit: string;
  /** Quantity for the log row (servings, or the absolute amount). */
  quantity: number;
  /** Set when nothing legitimate matched — `factor` is 0 and must NOT be read as "zero of this
   *  food". A caller that sees this should ask (`resolve_portion`) rather than log the factor. */
  unresolved?: true;
  /** Why, for a caller to act on. Only ever set alongside `unresolved`; never swallowed. */
  reason?: string;
}

type PricedFood = Pick<Food, 'base_unit' | 'servings' | 'default_serving'>;

/**
 * How much of `food`'s base one logged portion is. Absolute mass/volume bypasses servings[]
 * entirely — 170 g of a per-100 g food is 1.7 bases, whatever servings the food happens to carry.
 *
 * FOOD-ENGINE.md §2.2's flow, applied here: an absolute unit of the food's OWN kind wins outright
 * (step 1); failing that, an EXISTING serving the food already names wins next (step 2,
 * `matchMeasure` — never a substring test, MP0b); failing THAT, a nearby measure the food itself
 * reported (CNF's "15 mL (16 g)" rows, which already answer "1 tbsp" under a different spelling)
 * is read off the same line through the origin (step 3, MP1); and only when none of those apply
 * does this return `unresolved` (step 4) instead of a number nobody asked for. `resolve_portion`
 * (`portion-resolve.ts`) is the next rung after that — buying an answer, guarding it with physics,
 * and writing it back — but it needs a model and a database, so it is not called from here; a
 * caller that sees `unresolved` is the one positioned to reach for it.
 */
export function portionFactor(food: PricedFood, input: PortionInput): Portion {
  const text = input.text ?? '';
  const quantity = typeof input.qty === 'number' && input.qty > 0 ? input.qty : inferQuantity(text);

  // Step 1 (MP0a): an absolute unit converts ONLY when its kind matches this food's own base — a
  // volume word must never reach in and multiply a gram-based food directly, which is exactly how
  // 500 ml of evaporated milk priced as 500 g. "170 g" of an item-based food, or "500 ml" of a
  // gram-based one, both correctly fall through to step 3 instead.
  const baseKind = food.base_unit === 'g' ? 'mass' : food.base_unit === 'ml' ? 'volume' : null;
  if (baseKind && absoluteUnitKind(input.unit) === baseKind) {
    const absolute = absoluteAmount(input.unit, input.qty);
    if (absolute !== null) {
      return {
        factor: absolute / 100,
        serving_index: null,
        unit: food.base_unit,
        quantity: Math.round(absolute * 100) / 100,
      };
    }
  }

  const servings = Array.isArray(food.servings) ? food.servings : [];
  if (servings.length === 0) {
    return {
      factor: 0,
      serving_index: null,
      unit: input.unit ?? 'serving',
      quantity,
      unresolved: true,
      reason: 'this food has no measures on file at all',
    };
  }

  const unitWord = input.unit?.trim();

  // Nobody named a unit or described one, AND the amount is at most one serving — not "failed to
  // understand", nothing was said. A quick-add of "just log a serving of X" (or half of one) is a
  // real, common request, and the food's own default is the correct answer to it, bounded by the
  // size of ONE serving either way. This is the ONLY place `default_serving` is read outside of
  // pinning — everywhere below, an unmatched unit reports `unresolved` instead.
  //
  // `quantity > 1` is EXCLUDED on purpose, even with no unit/text: "3" of an unnamed default is
  // exactly how "3 shallots" became 300 g when a caller (recipe.ts's 3-arg call shape, still true
  // today for a bare count — see recipe-macros.ts) drops the unit/name and keeps only the number.
  // Multiplying an unrelated default by an arbitrary count is the bug this file exists to remove;
  // scaling it by at most 1 is not, because the error is bounded by one serving's own uncertainty
  // either way. A caller with more than "1" to say has to say what it is more than one OF.
  if (!unitWord && !text.trim() && quantity <= 1) {
    const index = defaultServingIndex(food.default_serving, servings.length);
    const serving = servings[index]!;
    return {
      factor: servingFactor(food.base_unit, serving, quantity),
      serving_index: index,
      unit: serving.unit || 'serving',
      quantity,
    };
  }

  const requested = unitWord ? `${quantity} ${unitWord}` : text;
  const measure = parseMeasure(requested);

  // Step 2: an exact serving the food already carries — a literal label, a source's own named
  // unit ("can", or "tbsp" when a source spelled it that way), or a count noun ("3 eggs" → "1
  // egg"). Bare mass/volume unit WORDS (g, ml, kg, l, oz, lb, mg) are excluded here on purpose:
  // every CNF household measure is ALSO spelled in ml ("15 mL", "100 mL", "250 mL" all coexist on
  // one food), so matching bare "ml" against "the first ml-shaped row" answers the wrong quantity
  // — this is precisely how the recipe path priced 500 ml of evaporated milk at 8,000 g (matched
  // its 15 ml row, then multiplied by the raw 500 as if it were 500 OF that serving) while the log
  // path's different bug landed on 500 g — 16× apart on the same input, MP0c's headline case. Bare
  // units go to step 3 instead, which picks by CLOSENESS to what was asked, never array order.
  const isBareUnit = measure.kind !== 'count' && absoluteUnitKind(measure.unit) !== null;
  if (!isBareUnit) {
    const matched = matchMeasure({ servings }, requested);
    if (matched) {
      const idx = servings.indexOf(matched);
      return {
        factor: servingFactor(food.base_unit, matched, quantity),
        serving_index: idx,
        unit: matched.unit || unitWord || 'serving',
        quantity,
      };
    }
  }

  /**
   * A count-shaped request against an ITEM-based food with exactly one serving has no ambiguity to
   * resolve, whether or not the words matched — the base unit already IS "one of this specific
   * thing" (per-item foods carry `amount_g: 1` on their one serving by convention; see
   * `nutrientsPerBase`), so there is no other-sized candidate it could have meant instead. This is
   * what makes a freshly-pinned one-off estimate price back out: `nutrientsPerBase` gives an
   * unnamed item ("1 venti latte", no `unit` given) a single generic "1 serving" row, and the very
   * next call re-describes it by its NAME ("venti latte"), which correctly does not match the word
   * "serving" — yet there is nothing else it could be.
   *
   * Deliberately scoped to `base_unit === 'item'` and not e.g. `beans()` carrying a single "1 can
   * (400g)" row: a mass/volume food's one named serving is an ARBITRARY-SIZED convenience label
   * (a can happens to be 400 g), and "bowl" silently becoming "can" because it is the only option
   * on file is exactly the shallots bug in miniature — see the recipe-macros.test.ts case this
   * would otherwise reintroduce. An item-based food has no size to have mismatched.
   */
  if (measure.kind === 'count' && food.base_unit === 'item' && servings.length === 1) {
    const only = servings[0]!;
    return {
      factor: servingFactor(food.base_unit, only, quantity),
      serving_index: 0,
      unit: only.unit || unitWord || 'serving',
      quantity,
    };
  }

  // Step 3 (MP1): reach the food's own OTHER mass/volume measures — CNF's ml/count servings,
  // scaled from whichever point is closest, never a generic density. See scaleFromOwnMeasures.
  if (measure.kind === 'mass' || measure.kind === 'volume') {
    const amount = measure.kind === 'mass' ? measure.grams : measure.ml;
    if (amount !== null) {
      const derived = scaleFromOwnMeasures(servings, measure.kind, amount);
      if (derived !== null) {
        return {
          factor: derived / 100,
          serving_index: null,
          unit: food.base_unit,
          quantity: Math.round(derived * 100) / 100,
        };
      }
    }
  }

  // Step 4: nothing legitimate matched. A wrong number nobody can see is worse than no number —
  // see the module header — so this reports instead of guessing.
  const available = servings.map((s) => s.label).join(', ');
  return {
    factor: 0,
    serving_index: null,
    unit: unitWord || 'serving',
    quantity,
    unresolved: true,
    reason: requested.trim()
      ? `no "${requested}" measure on file for this food — it only has: ${available}`
      : `asked for ${quantity} with no unit or description to resolve it against — this food's measures are: ${available}`,
  };
}

/** Nutrients for one logged portion of a saved food. */
export function priceFood(food: Pick<Food, 'macros_per_base'> & PricedFood, input: PortionInput): FoodNutrients {
  const { factor } = portionFactor(food, input);
  return factor > 0 ? scaleNutrients(food.macros_per_base, factor) : {};
}

export interface PinShape {
  base_unit: Food['base_unit'];
  macros_per_base: FoodNutrients;
  servings: FoodServing[];
  default_serving: number;
}

/**
 * Turn a ONE-OFF estimate for an eaten portion into a reusable food row — the inverse of
 * `portionFactor`, and the operation that converts a model's variance into a stable price.
 *
 * The pinned row's default serving is what they actually ate, so the next log of the same words
 * reproduces these exact numbers (see the round-trip test — that invariant is the contract).
 * Returns null when the estimate cannot be divided back out (no quantity, or nothing to scale).
 */
export function nutrientsPerBase(est: FoodNutrients, input: PortionInput): PinShape | null {
  if (!est || Object.keys(est).length === 0) return null;
  const qty = typeof input.qty === 'number' && input.qty > 0 ? input.qty : inferQuantity(input.text ?? '');
  if (!(qty > 0)) return null;

  const unitKey = input.unit ? normalizeResolveText(input.unit).replace(/\s+/g, '') : '';
  const absolute = absoluteAmount(input.unit, qty);
  if (absolute !== null && absolute > 0) {
    const kind = ABSOLUTE_UNITS[unitKey]?.kind ?? 'mass';
    const base_unit = kind === 'volume' ? 'ml' : 'g';
    return {
      base_unit,
      // Per 100 base units, which is what macros_per_base means for g/ml.
      macros_per_base: scaleNutrients(est, 100 / absolute),
      servings: [
        { label: `${trimNum(absolute)} ${base_unit}`, unit: base_unit, amount_g: absolute },
        { label: `100 ${base_unit}`, unit: base_unit, amount_g: 100 },
      ],
      default_serving: 0,
    };
  }

  // Countable/serving-shaped: base is ONE of whatever they said ("1 bowl", "1 latte").
  const unitLabel = input.unit?.trim() || 'serving';
  return {
    base_unit: 'item',
    macros_per_base: scaleNutrients(est, 1 / qty),
    servings: [{ label: `1 ${unitLabel}`, unit: unitLabel, amount_g: 1 }],
    default_serving: 0,
  };
}

function trimNum(n: number): string {
  return String(Math.round(n * 100) / 100);
}
