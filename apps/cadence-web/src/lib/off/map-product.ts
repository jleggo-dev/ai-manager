/**
 * Map Open Food Facts product JSON → Cadence Food import payload (source='off').
 * Pure — no network. Micros only when OFF provides real numbers (never invent).
 */
import type { FoodBaseUnit, FoodNutrients, FoodServing } from '@cadence/shared';

export interface OffMappedFood {
  name: string;
  brand: string | null;
  off_id: string;
  base_unit: FoodBaseUnit;
  macros_per_base: FoodNutrients;
  servings: FoodServing[];
  default_serving: number;
  confidence: number | null;
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' ? (v as Record<string, unknown>) : null;
}

function asFinite(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function asTrimmed(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t || null;
}

/** Digits-only barcode / OFF code (8–14 typical). */
export function normalizeBarcode(raw: string): string | null {
  const digits = raw.replace(/\D/g, '');
  if (digits.length < 8 || digits.length > 14) return null;
  return digits;
}

function pickNutrient(nutriments: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const n = asFinite(nutriments[key]);
    if (n !== null) return n;
  }
  return null;
}

/** OFF sodium_* is grams; Cadence stores sodium_mg. */
function sodiumMgFromOff(nutriments: Record<string, unknown>): number | undefined {
  const g = pickNutrient(nutriments, ['sodium_100g', 'sodium']);
  if (g === null) return undefined;
  return Math.round(g * 1000 * 10) / 10;
}

/**
 * OFF often stores micros as grams per 100g (e.g. iron_100g: 0.0039).
 * Values already > 1 are treated as mg (label-style).
 */
function microMgFromOff(nutriments: Record<string, unknown>, keys: string[]): number | undefined {
  const n = pickNutrient(nutriments, keys);
  if (n === null) return undefined;
  if (n > 1) return Math.round(n * 100) / 100;
  return Math.round(n * 1000 * 100) / 100;
}

export function nutrientsFromOffNutriments(raw: unknown): FoodNutrients | null {
  const nutriments = asRecord(raw);
  if (!nutriments) return null;
  const out: FoodNutrients = {};
  const kcal = pickNutrient(nutriments, ['energy-kcal_100g', 'energy-kcal', 'energy_kcal_100g']);
  if (kcal !== null) out.kcal = Math.round(kcal);
  const protein = pickNutrient(nutriments, ['proteins_100g', 'proteins']);
  if (protein !== null) out.protein_g = Math.round(protein * 10) / 10;
  const carbs = pickNutrient(nutriments, ['carbohydrates_100g', 'carbohydrates']);
  if (carbs !== null) out.carbs_g = Math.round(carbs * 10) / 10;
  const fat = pickNutrient(nutriments, ['fat_100g', 'fat']);
  if (fat !== null) out.fat_g = Math.round(fat * 10) / 10;
  const fiber = pickNutrient(nutriments, ['fiber_100g', 'fiber']);
  if (fiber !== null) out.fiber_g = Math.round(fiber * 10) / 10;
  const sodium = sodiumMgFromOff(nutriments);
  if (sodium !== undefined) out.sodium_mg = sodium;
  const iron = microMgFromOff(nutriments, ['iron_100g', 'iron']);
  if (iron !== undefined) out.iron_mg = iron;
  const zinc = microMgFromOff(nutriments, ['zinc_100g', 'zinc']);
  if (zinc !== undefined) out.zinc_mg = zinc;
  const vitC = microMgFromOff(nutriments, ['vitamin-c_100g', 'vitamin_c_100g', 'vitamin-c']);
  if (vitC !== undefined) out.vitamin_c_mg = vitC;
  const calcium = microMgFromOff(nutriments, ['calcium_100g', 'calcium']);
  if (calcium !== undefined) out.calcium_mg = calcium;
  const potassium = microMgFromOff(nutriments, ['potassium_100g', 'potassium']);
  if (potassium !== undefined) out.potassium_mg = potassium;

  if (out.kcal === undefined && out.protein_g === undefined && out.carbs_g === undefined && out.fat_g === undefined)
    return null;
  return out;
}

function baseUnitFromProduct(product: Record<string, unknown>): FoodBaseUnit {
  const per = (asTrimmed(product.nutrition_data_per) ?? '').toLowerCase();
  if (per.includes('100ml') || per === 'ml') return 'ml';
  const servingUnit = (asTrimmed(product.serving_quantity_unit) ?? '').toLowerCase();
  if (servingUnit === 'ml' || servingUnit === 'cl' || servingUnit === 'l') return 'ml';
  return 'g';
}

function parseServingAmountG(product: Record<string, unknown>, baseUnit: FoodBaseUnit): number | null {
  const qty = asFinite(product.serving_quantity);
  if (qty !== null && qty > 0) {
    const unit = (asTrimmed(product.serving_quantity_unit) ?? baseUnit).toLowerCase();
    if (unit === 'kg') return qty * 1000;
    if (unit === 'l') return qty * 1000;
    if (unit === 'cl') return qty * 10;
    return qty;
  }
  const size = asTrimmed(product.serving_size);
  if (!size) return null;
  const m = size.match(/([\d.]+)\s*(g|ml|kg|l|cl)\b/i);
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n) || n <= 0) return null;
  const u = m[2]!.toLowerCase();
  if (u === 'kg' || u === 'l') return n * 1000;
  if (u === 'cl') return n * 10;
  return n;
}

export function buildOffServings(product: Record<string, unknown>, baseUnit: FoodBaseUnit): FoodServing[] {
  const servings: FoodServing[] = [];
  const amount = parseServingAmountG(product, baseUnit);
  const sizeLabel = asTrimmed(product.serving_size);
  if (amount !== null) {
    servings.push({
      label: sizeLabel || `1 serving (${amount}${baseUnit})`,
      unit: 'serving',
      amount_g: amount,
    });
  }
  servings.push({
    label: `100 ${baseUnit}`,
    unit: baseUnit,
    amount_g: 100,
  });
  return servings;
}

/**
 * Map a v2/v3 OFF product object (+ barcode) into an import payload.
 * Returns null when name or macros are missing.
 */
export function mapOffProductToFood(barcode: string, productRaw: unknown): OffMappedFood | null {
  const offId = normalizeBarcode(barcode);
  if (!offId) return null;
  const product = asRecord(productRaw);
  if (!product) return null;

  const name = asTrimmed(product.product_name) || asTrimmed(product.generic_name) || `Product ${offId}`;
  const brandRaw = asTrimmed(product.brands);
  const brand = brandRaw ? brandRaw.split(',')[0]!.trim() || null : null;
  const macros = nutrientsFromOffNutriments(product.nutriments);
  if (!macros) return null;

  const base_unit = baseUnitFromProduct(product);
  const servings = buildOffServings(product, base_unit);
  return {
    name,
    brand,
    off_id: offId,
    base_unit,
    macros_per_base: macros,
    servings,
    default_serving: 0,
    confidence: 0.95,
  };
}
