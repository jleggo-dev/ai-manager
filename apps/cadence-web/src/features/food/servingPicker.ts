/**
 * MP3 — which of a food's servings the unit picker leads with, and MP39 — how to label a package
 * serving so it means something next to a volume one. Pure formatting over `Food['servings']`; no
 * pricing, no schema change.
 *
 * Owner ruling (test case 3, 2026-08-23): "If, as a user, I'm deterministically selecting a portion
 * size, volume is probably a lot easier than weight. I HATE it when MyFitnessPal offers me to select
 * based on weight. Unless I'm eating packaged food or meat (which is pre-weighed and on the
 * package), it's really annoying to break out a scale... The user needs to select against both
 * deterministically, if we have it available." That is two rules, not one:
 *   - packaged food and meat lead with weight — the number is already printed, no scale needed;
 *   - produce, grains, anything cooked from scratch leads with volume or count;
 *   - offer BOTH whenever both are held — this only ever reorders, it never drops a serving.
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
// "1 bottle (341ml)" — so the "word" branch alone (safe for spaced-out forms like "3 oz") would
// miss most of the real data. The "digit, optional space, unit" branch catches the glued form too.
const VOLUME_RE =
  /\b(?:milliliters?|millilitres?|liters?|litres?|cups?|tablespoons?|tbsp|teaspoons?|tsp|fl\.?\s?oz|fluid\s?ounces?|pints?|quarts?)\b|\d\s*m?l\b/i;
const MASS_RE = /\b(?:grams?|kilograms?|ounces?|oz|pounds?|lbs?)\b|\d\s*(?:g|kg)\b/i;

/**
 * Which axis a serving measures in. Reads `.unit`, never `.label` — CNF always appends "(NNNg)" to
 * the LABEL for display (`cnf-map.ts`), so testing the label would read every serving as mass, count
 * measures included. `.unit` is the food's own "unit key, e.g. 'container' | 'g' | 'cup'".
 */
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

/**
 * There is no category field to read, so this reads the same signals a person would: a brand name
 * (a branded product's weight is printed on it), a source that only ever carries retail products, or
 * the name itself naming a cut of meat. False positives/negatives both just change display order —
 * every serving is still offered either way.
 */
const MEAT_WORDS =
  /\b(chicken|beef|pork|turkey|lamb|veal|bacon|sausage|ham|steak|salmon|tuna|shrimp|prawns?|cod|fish|meat|poultry|bison|venison|duck|goat|ribs?)\b/i;

export function leadsWithWeight(food: Pick<Food, 'brand' | 'source' | 'name'>): boolean {
  if (food.brand?.trim()) return true;
  if (food.source === 'off' || food.source === 'fatsecret' || food.source === 'label_photo') return true;
  return MEAT_WORDS.test(food.name);
}

/**
 * Display order for `food.servings` — MP3. Returns ORIGINAL indices, never a reordered copy of the
 * array: every caller downstream (`macrosForLog`, a log write, a plan item) addresses a serving by
 * its index into `food.servings`, so reordering the array itself would silently point an existing
 * index at the wrong row. This only decides what order the picker WALKS those same indices in — a
 * count-axis serving ("1 container") sorts last either way, since it answers neither "how heavy" nor
 * "how much" on its own.
 */
export function orderServingIndices(food: Pick<Food, 'brand' | 'source' | 'name' | 'servings'>): number[] {
  const weightFirst = leadsWithWeight(food);
  const rank = (axis: ServingAxis): number => {
    if (axis === 'mass') return weightFirst ? 0 : 1;
    if (axis === 'volume') return weightFirst ? 1 : 0;
    return 2;
  };
  return food.servings
    .map((_, i) => i)
    .sort(
      (a, b) => rank(classifyServingUnit(food.servings[a]?.unit)) - rank(classifyServingUnit(food.servings[b]?.unit)),
    );
}

type VolumeNoun = 'cup' | 'tablespoon' | 'teaspoon' | 'ml' | 'liter';

const VOLUME_NOUN_PLURAL: Record<VolumeNoun, string> = {
  cup: 'cups',
  tablespoon: 'tablespoons',
  teaspoon: 'teaspoons',
  ml: 'ml',
  liter: 'liters',
};

/** The volume noun a serving's raw unit text names, or null when it doesn't clearly name one. */
function volumeNoun(unit: string | undefined): VolumeNoun | null {
  const u = (unit ?? '').trim().toLowerCase();
  if (!u) return null;
  if (/\bcups?\b/.test(u)) return 'cup';
  if (/\btablespoons?\b|\btbsp\b/.test(u)) return 'tablespoon';
  if (/\bteaspoons?\b|\btsp\b/.test(u)) return 'teaspoon';
  if (/\bliters?\b|\blitres?\b/.test(u)) return 'liter';
  if (/\bmilliliters?\b|\bmillilitres?\b/.test(u) || /\d\s*ml\b/.test(u) || u === 'ml') return 'ml';
  return null;
}

/**
 * "1 container" says nothing next to "1 cup" — MP39. When a food carries both a package-style
 * serving and a volume one, express the package in the volume too: "1 container (4 cups ea.)".
 * Pure arithmetic over `amount_g` two sibling servings already carry; no new data, no pricing
 * change. Degrades to the plain label whenever the numbers or the words aren't clean enough to say
 * for sure — a guessed compound label would be worse than none.
 *
 * Deliberately count-axis-only: relating a MASS serving to a volume one is a density conversion
 * ("how many cups is 250 g of shallots"), which is exactly the invented-cup problem the recipe
 * yield model was closed to avoid. A count/package serving has no such ambiguity — it is just N of
 * the smaller unit, read straight off amount_g.
 */
export function compoundLabel(serving: FoodServing, servings: FoodServing[]): string {
  if (classifyServingUnit(serving.unit) !== 'count') return serving.label;
  if (!(serving.amount_g > 0)) return serving.label;
  const ref = servings.find((s) => s !== serving && classifyServingUnit(s.unit) === 'volume' && s.amount_g > 0);
  const noun = ref ? volumeNoun(ref.unit) : null;
  if (!ref || !noun) return serving.label;
  const ratio = Math.round((serving.amount_g / ref.amount_g) * 4) / 4; // quarter-unit precision
  if (!(ratio > 0)) return serving.label;
  const word = ratio === 1 ? noun : VOLUME_NOUN_PLURAL[noun];
  return `${serving.label} (${ratio} ${word} ea.)`;
}
