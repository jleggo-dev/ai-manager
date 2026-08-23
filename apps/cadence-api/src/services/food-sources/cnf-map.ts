import type { FoodBaseUnit, FoodNutrients, FoodServing } from '@cadence/shared';
import { applyNormalization } from './normalized.ts';
import { USDA_LEGACY_NUMBERS } from './usda-map.ts';

/**
 * Adapter for Health Canada's Canadian Nutrient File — the bulk-import corpus.
 *
 * CNF is 5,690 generic foods with full LAB panels (measured: ~106 nutrient rows per food, all
 * seven tracked micros), household measures with conversion factors, and an Open Government
 * Licence, so unlike FatSecret the numbers may be kept forever. Its API is dump-shaped — there is
 * no search endpoint — which is what makes it import-once data rather than a runtime rung.
 *
 * The lucky part, verified live 2026-08-23: CNF's `nutrient_name_id`s ARE the historical USDA
 * nutrient numbers — 208 energy, 203 protein, 401 vitamin C — the exact legacy table already
 * built for USDA's Branded records. Two agencies, one numbering, one map.
 *
 * Provenance note for `completeness.ts`: CNF rows routinely carry zinc, B-12 and vitamin C, so
 * they read as MEASURED — an absence on a CNF row is a real "negligible", never a label's silence.
 */
export interface CnfFoodRow {
  food_code: number;
  food_description: string;
}

export interface CnfNutrientRow {
  food_code: number;
  nutrient_name_id: number;
  nutrient_value: number;
}

export interface CnfServingRow {
  food_code: number;
  measure_name: string;
  conversion_factor_value: number;
}

export interface CnfMappedFood {
  cnf_id: number;
  name: string;
  brand: null;
  source: 'cnf';
  base_unit: FoodBaseUnit;
  macros_per_base: FoodNutrients;
  servings: FoodServing[];
  default_serving: number;
  confidence: number;
}

/** CNF nutrient code for ethyl alcohol — exempts drinks from the Atwater cross-check. */
const CNF_ALCOHOL_CODE = 221;

/** Values are per 100 g of edible portion; a measure's grams are conversion_factor × 100. */
const GRAMS_PER_FACTOR = 100;

const MAX_SERVINGS = 8;

function mapNutrients(rows: CnfNutrientRow[]): { nutrients: FoodNutrients; alcoholic: boolean } {
  const byCode = new Map<number, number>();
  for (const r of rows) {
    if (typeof r.nutrient_value === 'number' && Number.isFinite(r.nutrient_value)) {
      byCode.set(r.nutrient_name_id, r.nutrient_value);
    }
  }
  const nutrients: FoodNutrients = {};
  for (const [key, code] of Object.entries(USDA_LEGACY_NUMBERS) as Array<[keyof typeof USDA_LEGACY_NUMBERS, number]>) {
    const v = byCode.get(code);
    if (typeof v !== 'number') continue;
    const places = key === 'kcal' || (key.endsWith('_g') && !key.endsWith('_ug')) ? 1 : 2;
    const f = 10 ** places;
    nutrients[key] = Math.round(v * f) / f;
  }
  return { nutrients, alcoholic: (byCode.get(CNF_ALCOHOL_CODE) ?? 0) > 0.5 };
}

function mapServings(rows: CnfServingRow[]): { servings: FoodServing[]; default_serving: number } {
  const servings: FoodServing[] = [];
  for (const r of rows) {
    const cf = r.conversion_factor_value;
    const label = r.measure_name?.trim();
    if (!label || typeof cf !== 'number' || !Number.isFinite(cf) || cf <= 0) continue;
    const grams = Math.round(cf * GRAMS_PER_FACTOR * 10) / 10;
    servings.push({ label: `${label} (${grams}g)`, unit: label, amount_g: grams });
    if (servings.length >= MAX_SERVINGS) break;
  }
  if (!servings.some((s) => s.amount_g === 100)) {
    servings.push({ label: '100 g', unit: 'g', amount_g: 100 });
  }
  // A household "1 ..." measure reads better than "100 g" as the preselected portion.
  const household = servings.findIndex((s) => /^1\s/.test(s.unit));
  return { servings, default_serving: household >= 0 ? household : servings.length - 1 };
}

/** Map one CNF food (with its nutrient + serving rows) into an importable shape, or null. */
export function mapCnfFood(
  food: CnfFoodRow,
  nutrientRows: CnfNutrientRow[],
  servingRows: CnfServingRow[],
): CnfMappedFood | null {
  const name = food.food_description?.trim();
  if (!name || !Number.isInteger(food.food_code) || food.food_code <= 0) return null;

  const { nutrients, alcoholic } = mapNutrients(nutrientRows);
  const { servings, default_serving } = mapServings(servingRows);

  const normalized = applyNormalization('cnf', {
    name: name.slice(0, 200),
    brand: null,
    base_unit: 'g' as FoodBaseUnit,
    macros_per_base: nutrients,
    servings,
    default_serving,
    alcoholic,
  });
  if (!normalized) return null;

  return {
    cnf_id: food.food_code,
    name: normalized.name,
    brand: null,
    source: 'cnf',
    base_unit: normalized.base_unit,
    macros_per_base: normalized.macros_per_base,
    servings: normalized.servings,
    default_serving: normalized.default_serving,
    confidence: 1,
  };
}
