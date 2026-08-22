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
 */
import { scaleNutrients, servingFactor, type Food, type FoodNutrients, type FoodServing } from '@cadence/shared';
import { inferQuantity, inferServingIndex, normalizeResolveText } from './food-resolver-rank.ts';

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
  /** servings[] index describing this portion, or null when the amount was absolute. */
  serving_index: number | null;
  /** Unit label for the log row. */
  unit: string;
  /** Quantity for the log row (servings, or the absolute amount). */
  quantity: number;
}

type PricedFood = Pick<Food, 'base_unit' | 'servings' | 'default_serving'>;

/**
 * How much of `food`'s base one logged portion is. Absolute mass/volume bypasses servings[]
 * entirely — 170 g of a per-100 g food is 1.7 bases, whatever servings the food happens to carry.
 */
export function portionFactor(food: PricedFood, input: PortionInput): Portion {
  const text = input.text ?? '';
  const perBase = food.base_unit === 'g' || food.base_unit === 'ml';
  const absolute = perBase ? absoluteAmount(input.unit, input.qty) : null;
  if (absolute !== null) {
    return {
      factor: absolute / 100,
      serving_index: null,
      unit: food.base_unit,
      quantity: Math.round(absolute * 100) / 100,
    };
  }

  const servings = Array.isArray(food.servings) ? food.servings : [];
  const quantity = typeof input.qty === 'number' && input.qty > 0 ? input.qty : inferQuantity(text);
  if (servings.length === 0) return { factor: 0, serving_index: null, unit: input.unit ?? 'serving', quantity };

  const index = inferServingIndex(text || input.unit || '', food);
  const serving = servings[index] ?? servings[0]!;
  return {
    factor: servingFactor(food.base_unit, serving, quantity),
    serving_index: index,
    unit: serving.unit || input.unit || 'serving',
    quantity,
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
