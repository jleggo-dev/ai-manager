/**
 * Pure helpers for structure_recipe job output → structured (unsaved) recipe draft.
 * No DB / AI Admin imports — unit-testable without CADENCE_* secrets.
 */

export interface StructuredIngredient {
  name: string;
  /**
   * How much, or `null` when the amount was never stated ("some onion"). The job used to invent a
   * plausible number here; it now says it does not know, and `null` travels all the way to the
   * person as an empty amount to fill in. Never coerce it to 0 or to 1 — a made-up amount is
   * indistinguishable from a real one once it is a number.
   */
  qty: number | null;
  unit?: string;
}

export interface StructuredRecipe {
  name: string;
  servings: number;
  ingredients: StructuredIngredient[];
  steps: string[];
}

function asTrimmedString(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t ? t : null;
}

function asPositiveNumber(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v) && v > 0) return v;
  if (typeof v === 'string' && v.trim()) {
    const n = Number(v.trim());
    if (Number.isFinite(n) && n > 0) return n;
  }
  return null;
}

/**
 * One ingredient row. An unusable qty is NOT a reason to drop the ingredient any more — the food
 * was named, only the amount is missing, and dropping the row loses the food too. Anything that
 * is not a positive number (null, absent, "", "some", 0, -3, NaN) becomes `qty: null`, which the
 * app renders as an amount to fill in rather than pricing.
 */
function parseIngredient(raw: unknown): StructuredIngredient | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const name = asTrimmedString(o.name);
  if (!name) return null;
  const qty = asPositiveNumber(o.qty);
  const unit = asTrimmedString(o.unit) ?? undefined;
  return unit ? { name, qty, unit } : { name, qty };
}

/**
 * Assert + sanitize structure_recipe JSON. Throws when the shape is unusable.
 */
export function parseStructureRecipeResult(raw: string): StructuredRecipe {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('structure_recipe returned non-JSON');
  }
  if (!parsed || typeof parsed !== 'object') throw new Error('structure_recipe returned empty result');
  const o = parsed as Record<string, unknown>;
  const name = asTrimmedString(o.name);
  if (!name) throw new Error('structure_recipe missing name');

  const servingsRaw = asPositiveNumber(o.servings);
  const servings = servingsRaw !== null ? Math.max(1, Math.round(servingsRaw)) : 1;

  const ingredientsRaw = Array.isArray(o.ingredients) ? o.ingredients : [];
  const ingredients = ingredientsRaw
    .map(parseIngredient)
    .filter((i): i is StructuredIngredient => i !== null)
    .slice(0, 40);
  if (ingredients.length === 0) throw new Error('structure_recipe has no usable ingredients');

  const steps = Array.isArray(o.steps)
    ? o.steps
        .filter((s): s is string => typeof s === 'string')
        .map((s) => s.trim())
        .filter(Boolean)
        .slice(0, 30)
    : [];

  return { name: name.slice(0, 120), servings, ingredients, steps };
}
