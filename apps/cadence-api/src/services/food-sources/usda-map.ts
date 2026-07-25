/**
 * Pure USDA FoodData Central → Cadence Food shape mapping (no HTTP / DB).
 * Nutrients are per 100g for Foundation / SR Legacy (our Phase 3 whole-food target).
 */
import type { FoodBaseUnit, FoodNutrients, FoodServing } from '@cadence/shared';

/** USDA nutrient numbers we care about (FoodData Central). */
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
} as const;

export type UsdaNutrientKey = keyof typeof USDA_NUTRIENT_NUMBERS;

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
  const nested = asRecord(entry.nutrient);
  const fromNested = asNumber(nested?.number) ?? asNumber(nested?.id);
  if (fromNested !== null) return fromNested;
  return asNumber(entry.nutrientNumber) ?? asNumber(entry.nutrientId);
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
  const places = key === 'kcal' || key.endsWith('_g') ? 1 : 2;
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
    const hit = byNumber.get(num);
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
  if (servings.length === 0) return null;

  const brand = asString(o.brandOwner) ?? asString(o.brandName) ?? null;
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
