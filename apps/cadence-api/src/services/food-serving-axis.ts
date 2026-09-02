/**
 * Which axis a serving measures in (mass / volume / count), server-side.
 *
 * The rule mirrors the web client's serving picker (apps/cadence-web/src/features/food/
 * servingPicker.ts, `classifyServingUnit`) rather than importing it — server code never imports
 * client code — and both read `.unit`, never `.label`: CNF appends "(NNNg)" to every LABEL for
 * display, so testing labels would read every serving as mass, count measures included.
 *
 * Used for the meal-logging rework's `ambiguous` flag (B2): a food whose servings span more than
 * one axis carries several serving sizes worth asking about, so the ＋ opens the serving sheet
 * instead of one-tap adding. One axis (or none) = the default serving is a safe one-tap add.
 */
import type { Food, FoodServing } from '@cadence/shared';

export type ServingAxis = 'mass' | 'volume' | 'count';

const EXACT_MASS = new Set([
  'g',
  'gram',
  'grams',
  'kg',
  'kilogram',
  'kilograms',
  'oz',
  'ounce',
  'ounces',
  'lb',
  'lbs',
  'pound',
  'pounds',
]);

const EXACT_VOLUME = new Set([
  'ml',
  'milliliter',
  'milliliters',
  'millilitre',
  'millilitres',
  'l',
  'liter',
  'liters',
  'litre',
  'litres',
  'cup',
  'cups',
  'tbsp',
  'tablespoon',
  'tablespoons',
  'tsp',
  'teaspoon',
  'teaspoons',
  'floz',
  'fl oz',
  'pint',
  'pints',
  'quart',
  'quarts',
]);

// Health Canada's household-measure text glues a short unit straight onto its number — "100ml",
// "1 bottle (341ml)" — so the word branch alone would miss most of the real data.
const VOLUME_RE =
  /\b(?:milliliters?|millilitres?|liters?|litres?|cups?|tablespoons?|tbsp|teaspoons?|tsp|fl\.?\s?oz|fluid\s?ounces?|pints?|quarts?)\b|\d\s*m?l\b/i;
const MASS_RE = /\b(?:grams?|kilograms?|ounces?|oz|pounds?|lbs?)\b|\d\s*(?:g|kg)\b/i;

/** Which axis a serving's unit key measures in. */
export function classifyServingUnit(unit: string | undefined): ServingAxis {
  const u = (unit ?? '').trim().toLowerCase();
  if (!u) return 'count';
  if (EXACT_MASS.has(u)) return 'mass';
  if (EXACT_VOLUME.has(u)) return 'volume';
  // Volume first: "fl oz" contains "oz" and must land as volume, not mass.
  if (VOLUME_RE.test(u)) return 'volume';
  if (MASS_RE.test(u)) return 'mass';
  return 'count';
}

/** True when the servings span more than one axis — several serving sizes worth asking about. */
export function hasAmbiguousServings(servings: FoodServing[] | undefined): boolean {
  if (!Array.isArray(servings) || servings.length < 2) return false;
  return new Set(servings.map((s) => classifyServingUnit(s.unit))).size > 1;
}

/** Stamp the flag onto a food row headed for a list response (search / recents / frequents). */
export function withAmbiguousFlag<T extends Pick<Food, 'servings'>>(food: T): T & { ambiguous: boolean } {
  return { ...food, ambiguous: hasAmbiguousServings(food.servings) };
}
