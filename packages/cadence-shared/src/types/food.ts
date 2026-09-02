/* ════════════════════════════════════════════════════════════════
   Req 5 §5.1 — Foods (shared-aware, MFP-style servings)
   ════════════════════════════════════════════════════════════════ */

/** Base unit for macros_per_base: g/ml are per 100; item is per 1. */
export type FoodBaseUnit = 'g' | 'ml' | 'item';

/**
 * Every source a food row can carry.
 *
 * 'cnf'      — Health Canada's Canadian Nutrient File, bulk-imported as shared rows (lab panels).
 * 'research' — a web-grounded AI lookup made ONCE at pin time; the pin is what makes an unstable
 *              source usable, because the question is never asked twice.
 *
 * This array is the source of truth and the type is derived from it. Anything that checks a source
 * at runtime must read it from here rather than write the list out again: a hand-copied list in the
 * web client went stale when the store rungs landed, and every `cnf` food it parsed came back null.
 */
export const FOOD_SOURCES = [
  'llm',
  'label_photo',
  'manual',
  'chat',
  'usda',
  'off',
  'fatsecret',
  'cnf',
  'research',
] as const;

export type FoodSource = (typeof FOOD_SOURCES)[number];

/** True when a value off the wire names a real food source. */
export function isFoodSource(value: unknown): value is FoodSource {
  return typeof value === 'string' && (FOOD_SOURCES as readonly string[]).includes(value);
}

/** Foods the app itself did not author — a store or lab row, shared across users. */
export const STORE_FOOD_SOURCES = ['usda', 'off', 'cnf', 'fatsecret', 'research'] as const satisfies ReadonlyArray<
  (typeof FOOD_SOURCES)[number]
>;

/** True for a food that came from a store or lab rather than the user's own saving. */
export function isStoreFoodSource(source: FoodSource): boolean {
  return (STORE_FOOD_SOURCES as readonly string[]).includes(source);
}

export type FoodVisibility = 'private' | 'shared';

/**
 * Nutrient blob stored per base. Macros always; micros optional when the source
 * provides real data (USDA / label / OFF) — never LLM-guessed.
 */
export interface FoodNutrients {
  kcal?: number;
  protein_g?: number;
  carbs_g?: number;
  fat_g?: number;
  fiber_g?: number;
  sodium_mg?: number;
  iron_mg?: number;
  zinc_mg?: number;
  vitamin_c_mg?: number;
  calcium_mg?: number;
  potassium_mg?: number;
  /** B12 is here because of who Cadence is for: someone moving to a vegetarian or vegan diet can
   *  hit every macro perfectly and still run themselves down, and this is the nutrient that tells
   *  them. Micrograms, like every source reports it. */
  vitamin_b12_ug?: number;
}

/** Named serving option mapping to a base amount (MFP Select Unit list). */
export interface FoodServing {
  /** User-facing label, e.g. "1 container (170g)". */
  label: string;
  /** Unit key, e.g. "container" | "g" | "cup". */
  unit: string;
  /**
   * Amount of base this serving represents.
   * For base_unit g|ml: grams / milliliters.
   * For base_unit item: item count in one serving (field name kept for MFP parity).
   */
  amount_g: number;
}

export interface Food {
  food_id: string;
  /** NULL = shared/global (e.g. OpenFoodFacts); set = a user's custom food. */
  owner_user_id: string | null;
  visibility: FoodVisibility;
  name: string;
  brand: string | null;
  source: FoodSource;
  off_id: string | null;
  /** USDA FoodData Central id when source='usda'; null otherwise. */
  fdc_id: number | null;
  /** Canadian Nutrient File food_code when source='cnf'; null otherwise. */
  cnf_id?: number | null;
  /**
   * FatSecret food id when source='fatsecret'; null otherwise. Their ToS lets us keep this
   * indefinitely and almost nothing else — see `source_fetched_at`.
   */
  fatsecret_id?: string | null;
  /**
   * When the perishable half of this row (name, brand, servings, nutrients) was last read from
   * source. NULL means it never expires: USDA is public domain and OFF is ODbL, so both keep their
   * numbers. FatSecret data is 24-hour under their terms, so a row past that must be refreshed
   * before use — and purged if the refresh fails.
   */
  source_fetched_at?: string | null;
  base_unit: FoodBaseUnit;
  macros_per_base: FoodNutrients;
  servings: FoodServing[];
  /** Index into servings[] to pre-select (anti-friction default). */
  default_serving: number;
  confidence: number | null;
  photo_ref: string | null;
  created_at?: string;
}

/** Per-user recents/frequents projection row (optional; ranking falls back to logs). */
export interface FoodUsage {
  user_id: string;
  food_id: string;
  use_count: number;
  last_used_at: string;
}

export const FOOD_NUTRIENT_KEYS = [
  'kcal',
  'protein_g',
  'carbs_g',
  'fat_g',
  'fiber_g',
  'sodium_mg',
  'iron_mg',
  'zinc_mg',
  'vitamin_c_mg',
  'calcium_mg',
  'potassium_mg',
  'vitamin_b12_ug',
] as const satisfies ReadonlyArray<keyof FoodNutrients>;

export type FoodNutrientKey = (typeof FOOD_NUTRIENT_KEYS)[number];

/** Round macros to 1 decimal; keep micros at 2 when small. */
function roundNutrient(key: FoodNutrientKey, value: number): number {
  const places = key === 'kcal' || key.endsWith('_g') ? 1 : 2;
  const f = 10 ** places;
  return Math.round(value * f) / f;
}

/** Scale a nutrient blob by a linear factor (serving × quantity). */
export function scaleNutrients(base: FoodNutrients, factor: number): FoodNutrients {
  if (!Number.isFinite(factor) || factor === 0) return {};
  const out: FoodNutrients = {};
  for (const key of FOOD_NUTRIENT_KEYS) {
    const v = base[key];
    if (typeof v === 'number' && Number.isFinite(v)) out[key] = roundNutrient(key, v * factor);
  }
  return out;
}

/**
 * Convert (serving, quantity) into a multiplier against macros_per_base.
 * g/ml: amount_g/100 × qty · item: amount_g (item count) × qty.
 */
export function servingFactor(baseUnit: FoodBaseUnit, serving: Pick<FoodServing, 'amount_g'>, quantity = 1): number {
  const qty = Number.isFinite(quantity) && quantity > 0 ? quantity : 0;
  const amount = Number.isFinite(serving.amount_g) ? serving.amount_g : 0;
  if (baseUnit === 'item') return amount * qty;
  return (amount / 100) * qty;
}

export interface MacrosForLogOpts {
  /** Index into food.servings; defaults to food.default_serving. */
  servingIndex?: number;
  /** Number of servings (MFP "Number of Servings"); default 1. */
  quantity?: number;
}

/**
 * Macros for a logged amount of a food = macros_per_base × servingFactor × quantity.
 * Matches MyFitnessPal: pick a serving unit, then a quantity multiplier.
 */
export function macrosForLog(
  food: Pick<Food, 'base_unit' | 'macros_per_base' | 'servings' | 'default_serving'>,
  opts: MacrosForLogOpts = {},
): FoodNutrients {
  const servings = Array.isArray(food.servings) ? food.servings : [];
  if (servings.length === 0) return {};
  const rawIdx = opts.servingIndex ?? food.default_serving ?? 0;
  const idx = Number.isInteger(rawIdx) && rawIdx >= 0 && rawIdx < servings.length ? rawIdx : 0;
  const serving = servings[idx];
  if (!serving) return {};
  const factor = servingFactor(food.base_unit, serving, opts.quantity ?? 1);
  return scaleNutrients(food.macros_per_base, factor);
}

/** Resolve the serving row the UI/resolver should pre-select. */
export function resolveDefaultServing(food: Pick<Food, 'servings' | 'default_serving'>): FoodServing | null {
  const servings = Array.isArray(food.servings) ? food.servings : [];
  if (servings.length === 0) return null;
  const idx =
    Number.isInteger(food.default_serving) && food.default_serving >= 0 && food.default_serving < servings.length
      ? food.default_serving
      : 0;
  return servings[idx] ?? null;
}
