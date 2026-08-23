/**
 * FatSecret → Cadence mapping. Pure: no HTTP, no DB.
 *
 * FatSecret answers with nutrients PER SERVING and a list of servings; Cadence stores nutrients
 * per base (100 g/ml, or 1 item) with servings as multipliers. The conversion runs through the
 * serving that declares a metric amount, because that is the only one whose grams are knowable.
 */
import type { FoodBaseUnit, FoodNutrients, FoodServing } from '@cadence/shared';

export interface FatSecretHit {
  food_id: string;
  name: string;
  brand: string | null;
  /** FatSecret's own one-line summary, useful for ranking and for showing a match. */
  description: string;
}

export interface FatSecretMappedFood {
  fatsecret_id: string;
  name: string;
  brand: string | null;
  base_unit: FoodBaseUnit;
  macros_per_base: FoodNutrients;
  servings: FoodServing[];
  default_serving: number;
}

const num = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

/** FatSecret returns a bare object when there is one result and an array when there are several. */
function asArray(v: unknown): Record<string, unknown>[] {
  if (Array.isArray(v)) return v as Record<string, unknown>[];
  if (v && typeof v === 'object') return [v as Record<string, unknown>];
  return [];
}

/**
 * ⚠️ THIS MAPPER IS FOR `food.get.v4` ONLY, AND THE VERSION IS A CORRECTNESS ISSUE, NOT A
 * PREFERENCE.
 *
 * In v4 calcium, iron and vitamin C are documented as *"content in milligrams"*. In v1 the same
 * field names are *"Percentage of daily recommended Calcium, based on a 2000 calorie diet"* — a
 * percentage, not an amount. Pointing this mapper at v1 would therefore read 6%DV of iron as 6 mg
 * and put a roughly tenfold error into a number nobody double-checks. v1 is deprecated; call v4.
 *
 * Not mapped because FatSecret does not return them: zinc and B12. Those stay the preserve of USDA
 * and label photos, and their absence is honest — a Cadence micro total is a floor built from real
 * data, never a guess.
 */
function nutrientsFromServing(s: Record<string, unknown>): FoodNutrients {
  const out: FoodNutrients = {};
  const put = (key: keyof FoodNutrients, raw: unknown) => {
    const n = num(raw);
    if (n !== null && n >= 0) out[key] = n;
  };
  put('kcal', s.calories);
  put('protein_g', s.protein);
  put('carbs_g', s.carbohydrate);
  put('fat_g', s.fat);
  put('fiber_g', s.fiber);
  put('sodium_mg', s.sodium);
  put('potassium_mg', s.potassium);
  // v4 milligrams — see the version warning above.
  put('calcium_mg', s.calcium);
  put('iron_mg', s.iron);
  put('vitamin_c_mg', s.vitamin_c);
  return out;
}

function scale(n: FoodNutrients, factor: number): FoodNutrients {
  const out: FoodNutrients = {};
  for (const [k, v] of Object.entries(n)) {
    if (typeof v === 'number') out[k as keyof FoodNutrients] = Math.round(v * factor * 100) / 100;
  }
  return out;
}

/** One search result row → the shape ranking needs. */
export function mapFatSecretSearch(raw: unknown): FatSecretHit[] {
  const o = raw as Record<string, unknown> | null;
  const foods = (o?.foods as Record<string, unknown> | undefined)?.food;
  return asArray(foods)
    .map((f) => ({
      food_id: str(f.food_id),
      name: str(f.food_name),
      brand: str(f.brand_name) || null,
      description: str(f.food_description),
    }))
    .filter((f) => f.food_id && f.name);
}

/**
 * A full food → a Cadence food row.
 *
 * Returns null rather than guessing when no serving declares a metric amount: without grams there
 * is no honest way to express "per 100 g", and inventing one would put a wrong price in the ledger
 * permanently (A23 §1a pins what it prices).
 */
export function mapFatSecretFood(raw: unknown): FatSecretMappedFood | null {
  const food = (raw as Record<string, unknown> | null)?.food as Record<string, unknown> | undefined;
  if (!food) return null;

  const fatsecret_id = str(food.food_id);
  const name = str(food.food_name);
  if (!fatsecret_id || !name) return null;

  const rows = asArray((food.servings as Record<string, unknown> | undefined)?.serving);
  if (rows.length === 0) return null;

  // The reference serving is the first with a usable metric amount — everything else scales to it.
  const metric = rows.find((s) => {
    const amt = num(s.metric_serving_amount);
    const unit = str(s.metric_serving_unit).toLowerCase();
    return amt !== null && amt > 0 && (unit === 'g' || unit === 'ml');
  });
  if (!metric) return null;

  const refAmount = num(metric.metric_serving_amount)!;
  const base_unit: FoodBaseUnit = str(metric.metric_serving_unit).toLowerCase() === 'ml' ? 'ml' : 'g';
  const macros_per_base = scale(nutrientsFromServing(metric), 100 / refAmount);

  const servings: FoodServing[] = [];
  for (const s of rows) {
    const amt = num(s.metric_serving_amount);
    const unit = str(s.metric_serving_unit).toLowerCase();
    if (amt === null || amt <= 0 || (unit !== 'g' && unit !== 'ml')) continue;
    const label = str(s.serving_description) || str(s.measurement_description) || `${amt} ${unit}`;
    servings.push({ label, unit: str(s.measurement_description) || unit, amount_g: Math.round(amt * 10) / 10 });
    if (servings.length >= 12) break;
  }
  // A 100-unit option always exists, so any amount can be expressed even when the pack is odd.
  if (!servings.some((s) => s.amount_g === 100)) {
    servings.push({ label: `100 ${base_unit}`, unit: base_unit, amount_g: 100 });
  }

  return {
    fatsecret_id,
    name,
    brand: str(food.brand_name) || null,
    base_unit,
    macros_per_base,
    servings,
    // The household serving reads better than "100 g" as a default, when there is one.
    default_serving: Math.max(
      0,
      servings.findIndex((s) => s.amount_g !== 100),
    ),
  };
}
