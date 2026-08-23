/**
 * Pure USDA FoodData Central → Cadence Food shape mapping (no HTTP / DB).
 * Nutrients are per 100g for Foundation / SR Legacy (our Phase 3 whole-food target).
 */
import type { FoodBaseUnit, FoodNutrients, FoodServing } from '@cadence/shared';

/**
 * FDC nutrient **ids** we care about (`foodNutrients[].nutrient.id`), NOT the legacy
 * `nutrient.number` codes — live payloads carry both (B12: id 1178, number "418").
 */
export const USDA_NUTRIENT_NUMBERS = {
  kcal: 1008,
  protein_g: 1003,
  carbs_g: 1005,
  fat_g: 1004,
  fiber_g: 1079,
  sodium_mg: 1093,
  iron_mg: 1089,
  zinc_mg: 1095,
  vitamin_c_mg: 1162,
  calcium_mg: 1087,
  potassium_mg: 1092,
  // Total B-12 in µg; 1246 ("added") is the fortification subset already inside this total.
  vitamin_b12_ug: 1178,
} as const;

export type UsdaNutrientKey = keyof typeof USDA_NUTRIENT_NUMBERS;

/**
 * The SAME nutrients under USDA's older numbering, which BRANDED records still use.
 *
 * Foundation and SR Legacy answer with the modern four-digit numbers above; a Branded food comes
 * back with the legacy three-digit set — 208 for energy where Foundation says 1008. Nothing warns
 * you: `mapUsdaNutrients` simply finds none of the numbers it is looking for, every macro comes
 * back undefined, and `mapUsdaFoodDetail` rejects the food as unmappable. Every packaged product
 * would have been silently unimportable while the search that found them worked perfectly.
 */
const USDA_LEGACY_NUMBERS: Record<UsdaNutrientKey, number> = {
  kcal: 208,
  protein_g: 203,
  carbs_g: 205,
  fat_g: 204,
  fiber_g: 291,
  sodium_mg: 307,
  iron_mg: 303,
  zinc_mg: 309,
  vitamin_c_mg: 401,
  calcium_mg: 301,
  potassium_mg: 306,
  vitamin_b12_ug: 418,
};

export interface UsdaSearchHit {
  fdc_id: number;
  name: string;
  brand: string | null;
  data_type: string;
}

export interface UsdaMappedFood {
  fdc_id: number;
  name: string;
  brand: string | null;
  source: 'usda';
  base_unit: FoodBaseUnit;
  macros_per_base: FoodNutrients;
  servings: FoodServing[];
  default_serving: number;
  confidence: number;
  photo_ref: null;
  off_id: null;
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' ? (v as Record<string, unknown>) : null;
}

function asNumber(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim()) {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function asString(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t || null;
}

function nutrientNumber(entry: Record<string, unknown>): number | null {
  // Live FDC payloads always carry the id AND a legacy `number` code ("208" for Energy 1008,
  // "418" for B-12 1178); our map keys are ids, so the id must win when both are present.
  const nested = asRecord(entry.nutrient);
  const fromNested = asNumber(nested?.id) ?? asNumber(nested?.number);
  if (fromNested !== null) return fromNested;
  return asNumber(entry.nutrientId) ?? asNumber(entry.nutrientNumber);
}

function nutrientAmount(entry: Record<string, unknown>): number | null {
  return asNumber(entry.amount) ?? asNumber(entry.value);
}

function nutrientUnit(entry: Record<string, unknown>): string {
  const nested = asRecord(entry.nutrient);
  const u = asString(nested?.unitName) ?? asString(entry.unitName) ?? '';
  return u.toLowerCase();
}

function roundNutrient(key: UsdaNutrientKey, value: number): number {
  // '_ug' also ends with '_g' — micrograms must keep 2dp (B12's whole daily reference is 2.4µg).
  const places = key === 'kcal' || (key.endsWith('_g') && !key.endsWith('_ug')) ? 1 : 2;
  const f = 10 ** places;
  return Math.round(value * f) / f;
}

/** Extract macros + micros per 100g from a USDA foodNutrients array. */
export function mapUsdaNutrients(foodNutrients: unknown): FoodNutrients {
  if (!Array.isArray(foodNutrients)) return {};
  const byNumber = new Map<number, { amount: number; unit: string }>();
  for (const raw of foodNutrients) {
    const entry = asRecord(raw);
    if (!entry) continue;
    const num = nutrientNumber(entry);
    const amount = nutrientAmount(entry);
    if (num === null || amount === null) continue;
    const unit = nutrientUnit(entry);
    const prev = byNumber.get(num);
    // Energy (1008) appears as both kcal and kJ — keep kcal.
    if (prev && prev.unit.includes('kcal') && unit.includes('kj')) continue;
    if (prev && !prev.unit.includes('kj') && unit.includes('kj')) continue;
    byNumber.set(num, { amount, unit });
  }

  const out: FoodNutrients = {};
  for (const [key, num] of Object.entries(USDA_NUTRIENT_NUMBERS) as Array<[UsdaNutrientKey, number]>) {
    // Modern numbering first, then the legacy number Branded records use for the same nutrient.
    const hit = byNumber.get(num) ?? byNumber.get(USDA_LEGACY_NUMBERS[key]);
    if (!hit) continue;
    if (key === 'kcal' && hit.unit.includes('kj') && !hit.unit.includes('kcal')) continue;
    out[key] = roundNutrient(key, hit.amount);
  }
  return out;
}

function portionLabel(amount: number, modifier: string, unitName: string, gramWeight: number): string {
  const qty = Number.isInteger(amount) ? String(amount) : String(Math.round(amount * 100) / 100);
  const parts = [qty, modifier, unitName].filter((p) => p && p !== 'undetermined').join(' ');
  const base = parts || 'serving';
  return `${base} (${Math.round(gramWeight)}g)`;
}

function portionUnit(modifier: string, unitName: string): string {
  const m = modifier.toLowerCase().trim();
  if (m) return m.slice(0, 40);
  const u = unitName.toLowerCase().trim();
  return (u || 'serving').slice(0, 40);
}

/**
 * The label serving on a BRANDED food, which does not use foodPortions at all.
 *
 * A packaged product declares `servingSize` + `servingSizeUnit` with `householdServingFullText` as
 * its human label — "1 oz" over 28 GRM. Note the unit arrives UPPERCASE and abbreviated (`GRM`,
 * `MLT`), not as the `g`/`ml` the rest of this file speaks, which is the kind of mismatch that
 * silently produces a food whose only serving is "100 g".
 *
 * Anything not expressed in grams or millilitres is skipped rather than converted: a branded
 * serving given in `IU` or `oz` is ambiguous by weight-versus-volume, and A23 pins what it prices.
 */
export function brandedLabelServing(o: Record<string, unknown>): FoodServing | null {
  const amount = asNumber(o.servingSize);
  if (amount === null || amount <= 0) return null;
  const rawUnit = (asString(o.servingSizeUnit) ?? '').trim().toUpperCase();
  const metric = rawUnit === 'GRM' || rawUnit === 'G' ? 'g' : rawUnit === 'MLT' || rawUnit === 'ML' ? 'ml' : null;
  if (!metric) return null;
  const household = asString(o.householdServingFullText) ?? '';
  const label = household ? `${household} (${Math.round(amount * 10) / 10}${metric})` : `${amount}${metric}`;
  return {
    label: label.slice(0, 80),
    unit: household ? household.slice(0, 24) : metric,
    amount_g: Math.round(amount * 10) / 10,
  };
}

/** Map foodPortions → MFP-style servings; always include a 100 g option. */
export function mapUsdaPortions(foodPortions: unknown): FoodServing[] {
  const servings: FoodServing[] = [];
  const seen = new Set<string>();

  if (Array.isArray(foodPortions)) {
    for (const raw of foodPortions) {
      const p = asRecord(raw);
      if (!p) continue;
      const gramWeight = asNumber(p.gramWeight);
      if (gramWeight === null || gramWeight <= 0) continue;
      const amount = asNumber(p.amount) ?? 1;
      const modifier = asString(p.modifier) ?? '';
      const measure = asRecord(p.measureUnit);
      const unitName = asString(measure?.name) ?? asString(p.measureUnitName) ?? '';
      const label = portionLabel(amount, modifier, unitName, gramWeight);
      const unit = portionUnit(modifier, unitName);
      const key = `${unit}:${Math.round(gramWeight * 10)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      servings.push({ label, unit, amount_g: Math.round(gramWeight * 10) / 10 });
      if (servings.length >= 12) break;
    }
  }

  const hundredKey = 'g:1000';
  if (!seen.has(hundredKey)) {
    servings.push({ label: '100 g', unit: 'g', amount_g: 100 });
  }

  // Prefer household measures first; keep 100 g as a stable fallback index when alone.
  const hundredIdx = servings.findIndex((s) => s.unit === 'g' && s.amount_g === 100);
  if (hundredIdx > 0 && servings.length > 1) {
    // leave 100g where it is (usually last) — default_serving will pick first household
  }
  return servings;
}

export function defaultServingIndex(servings: FoodServing[]): number {
  if (servings.length === 0) return 0;
  // Prefer first non-"100 g" household measure when present.
  const household = servings.findIndex((s) => !(s.unit === 'g' && s.amount_g === 100));
  return household >= 0 ? household : 0;
}

/** Parse a USDA /foods/search foods[] row into a lightweight hit. */
export function parseUsdaSearchHit(raw: unknown): UsdaSearchHit | null {
  const o = asRecord(raw);
  if (!o) return null;
  const fdc_id = asNumber(o.fdcId);
  const name = asString(o.description) ?? asString(o.lowercaseDescription);
  if (fdc_id === null || !Number.isInteger(fdc_id) || fdc_id <= 0 || !name) return null;
  const brand = asString(o.brandOwner) ?? asString(o.brandName) ?? asString(o.additionalDescriptions) ?? null;
  const data_type = asString(o.dataType) ?? '';
  return { fdc_id, name, brand: brand && brand.length < 80 ? brand : null, data_type };
}

/** Map a USDA /food/{fdcId} payload into an importable Food shape (no food_id yet). */
export function mapUsdaFoodDetail(raw: unknown): UsdaMappedFood | null {
  const o = asRecord(raw);
  if (!o) return null;
  const fdc_id = asNumber(o.fdcId);
  const name = asString(o.description);
  if (fdc_id === null || !Number.isInteger(fdc_id) || fdc_id <= 0 || !name) return null;

  const macros = mapUsdaNutrients(o.foodNutrients);
  if (
    macros.kcal === undefined &&
    macros.protein_g === undefined &&
    macros.carbs_g === undefined &&
    macros.fat_g === undefined
  ) {
    return null;
  }

  const servings = mapUsdaPortions(o.foodPortions);
  // A branded product's label serving leads: "1 oz (28g)" is how somebody eats it, and without
  // this a packaged food offers nothing but "100 g" to log against.
  const labelServing = brandedLabelServing(o);
  if (labelServing && !servings.some((sv) => Math.abs(sv.amount_g - labelServing.amount_g) < 0.5)) {
    servings.unshift(labelServing);
  }
  if (servings.length === 0) return null;

  // brandName is the product's own name ("CLOVER VALLEY"); brandOwner is the company behind it.
  // The name on the packet is the one a person would recognise, so it goes first.
  const brand = asString(o.brandName) ?? asString(o.brandOwner) ?? null;
  return {
    fdc_id,
    name: name.slice(0, 200),
    brand: brand && brand.length < 80 ? brand : null,
    source: 'usda',
    base_unit: 'g',
    macros_per_base: macros,
    servings,
    default_serving: defaultServingIndex(servings),
    confidence: 1,
    photo_ref: null,
    off_id: null,
  };
}
