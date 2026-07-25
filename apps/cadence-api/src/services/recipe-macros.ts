/**
 * Pure per-serving recipe macro math (Req 5 WS3).
 * Σ(ingredient macros) ÷ servings — never free-guessed for the whole dish.
 */
import { macrosForLog, scaleNutrients, type Food, type FoodNutrients, type Macros } from '@cadence/shared';

const MACRO_KEYS = ['kcal', 'protein_g', 'carbs_g', 'fat_g'] as const;

function asPositive(n: unknown): number {
  return typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : 0;
}

function normalizeUnit(unit: string | null | undefined): string {
  return (unit ?? '').toLowerCase().trim();
}

/** Round macro fields the same way food logs do (kcal whole-ish, grams 1 decimal). */
export function toMacros(nutrients: FoodNutrients, source: Macros['source'] = 'ai'): Macros {
  const out: Macros = { source };
  for (const key of MACRO_KEYS) {
    const v = nutrients[key];
    if (typeof v !== 'number' || !Number.isFinite(v)) continue;
    out[key] = key === 'kcal' ? Math.round(v * 10) / 10 : Math.round(v * 10) / 10;
  }
  return out;
}

/** Sum macro blobs (ignores missing keys). */
export function sumMacros(parts: readonly Macros[]): Macros {
  const acc: FoodNutrients = {};
  for (const part of parts) {
    for (const key of MACRO_KEYS) {
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
  for (const key of MACRO_KEYS) {
    const v = macros[key];
    if (typeof v === 'number' && Number.isFinite(v)) nutrients[key] = v;
  }
  return toMacros(scaleNutrients(nutrients, f), macros.source ?? 'ai');
}

/**
 * Macros contributed by one ingredient amount of a known Food.
 * Prefer direct g/ml/item against macros_per_base; else named serving match; else default × qty.
 */
export function macrosForIngredientAmount(
  food: Pick<Food, 'base_unit' | 'macros_per_base' | 'servings' | 'default_serving'>,
  qty: number,
  unit?: string | null,
): FoodNutrients {
  const q = asPositive(qty);
  if (q === 0) return {};
  const u = normalizeUnit(unit);

  if ((u === 'g' || u === 'gram' || u === 'grams') && food.base_unit === 'g')
    return scaleNutrients(food.macros_per_base, q / 100);
  if (
    (u === 'ml' || u === 'milliliter' || u === 'milliliters' || u === 'millilitre' || u === 'millilitres') &&
    food.base_unit === 'ml'
  )
    return scaleNutrients(food.macros_per_base, q / 100);
  if (['item', 'each', 'piece', 'whole', 'unit', 'egg'].includes(u) && food.base_unit === 'item')
    return scaleNutrients(food.macros_per_base, q);

  const servings = Array.isArray(food.servings) ? food.servings : [];
  const byUnit = servings.findIndex((s) => normalizeUnit(s.unit) === u);
  if (byUnit >= 0) return macrosForLog(food, { servingIndex: byUnit, quantity: q });

  // Soft label match ("can" ↔ "1 can (400g)")
  if (u) {
    const byLabel = servings.findIndex((s) => normalizeUnit(s.label).includes(u));
    if (byLabel >= 0) return macrosForLog(food, { servingIndex: byLabel, quantity: q });
  }

  return macrosForLog(food, { quantity: q });
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
