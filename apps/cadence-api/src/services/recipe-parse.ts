/**
 * Pure helpers for structure_recipe job output → structured (unsaved) recipe draft.
 * No DB / AI Admin imports — unit-testable without CADENCE_* secrets.
 */

export interface StructuredIngredient {
  name: string;
  qty: number;
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

function parseIngredient(raw: unknown): StructuredIngredient | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const name = asTrimmedString(o.name);
  const qty = asPositiveNumber(o.qty);
  if (!name || qty === null) return null;
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
