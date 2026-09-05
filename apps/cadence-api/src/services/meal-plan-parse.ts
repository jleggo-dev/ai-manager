/**
 * Pure helpers for generate_meal_plan job output + shopping-list derivation.
 * No DB / AI Admin imports — unit-testable without CADENCE_* secrets.
 */
import type { ShoppingListCategory, ShoppingListItem } from '@cadence/shared';
import type { StructuredIngredient, StructuredRecipe } from './recipe-parse.ts';

const SLOTS = new Set(['breakfast', 'lunch', 'dinner', 'snack']);
const CATEGORIES = new Set<ShoppingListCategory>([
  'produce',
  'dairy',
  'protein',
  'pantry',
  'frozen',
  'bakery',
  'other',
]);

/**
 * generate_meal_plan's own ingredient row. `structure-recipe` may report an amount it was never
 * given (`qty: null` — the person said "some onion"); a planned week is generated, not dictated,
 * so its parser drops a row it cannot read an amount from and every row that survives has one.
 * Narrowed here so the shopping list and the plan draft, which both need a real number, do not
 * each have to re-prove it.
 */
export type MealPlanIngredient = StructuredIngredient & { qty: number };

export interface MealPlanStructuredRecipe extends StructuredRecipe {
  ingredients: MealPlanIngredient[];
  tags: string[];
  /** When set, prefer linking an existing saved recipe on confirm. */
  reuse_recipe_id: string | null;
}

export interface MealPlanStructuredMeal {
  slot: string;
  recipe: MealPlanStructuredRecipe;
}

export interface MealPlanStructuredDay {
  day: string;
  meals: MealPlanStructuredMeal[];
}

export interface ParsedMealPlanJob {
  days: MealPlanStructuredDay[];
  shopping_list: ShoppingListItem[];
  notes: string | null;
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

function isIsoDate(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s);
}

function parseIngredient(raw: unknown): MealPlanIngredient | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const name = asTrimmedString(o.name);
  const qty = asPositiveNumber(o.qty);
  if (!name || qty === null) return null;
  const unit = asTrimmedString(o.unit) ?? undefined;
  return unit ? { name: name.slice(0, 80), qty, unit: unit.slice(0, 24) } : { name: name.slice(0, 80), qty };
}

function parseTags(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((t): t is string => typeof t === 'string')
    .map((t) => t.trim())
    .filter(Boolean)
    .slice(0, 3);
}

function parseUuid(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(t)) return null;
  return t;
}

function parseRecipe(raw: unknown): MealPlanStructuredRecipe | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const name = asTrimmedString(o.name);
  if (!name) return null;
  const servingsRaw = asPositiveNumber(o.servings);
  const servings = servingsRaw !== null ? Math.max(1, Math.round(servingsRaw)) : 1;
  const ingredients = (Array.isArray(o.ingredients) ? o.ingredients : [])
    .map(parseIngredient)
    .filter((i): i is MealPlanIngredient => i !== null)
    .slice(0, 40);
  if (ingredients.length === 0) return null;
  const steps = Array.isArray(o.steps)
    ? o.steps
        .filter((s): s is string => typeof s === 'string')
        .map((s) => s.trim())
        .filter(Boolean)
        .slice(0, 30)
    : [];
  return {
    name: name.slice(0, 120),
    servings,
    ingredients,
    steps,
    tags: parseTags(o.tags),
    reuse_recipe_id: parseUuid(o.reuse_recipe_id),
  };
}

function parseMeal(raw: unknown): MealPlanStructuredMeal | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const slotRaw = asTrimmedString(o.slot)?.toLowerCase() ?? '';
  const slot = SLOTS.has(slotRaw) ? slotRaw : 'dinner';
  const recipe = parseRecipe(o.recipe);
  if (!recipe) return null;
  return { slot, recipe };
}

function parseDay(raw: unknown): MealPlanStructuredDay | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const day = asTrimmedString(o.day);
  if (!day || !isIsoDate(day)) return null;
  const meals = (Array.isArray(o.meals) ? o.meals : [])
    .map(parseMeal)
    .filter((m): m is MealPlanStructuredMeal => m !== null)
    .slice(0, 6);
  if (meals.length === 0) return null;
  return { day, meals };
}

function parseCategory(raw: unknown): ShoppingListCategory {
  const c = asTrimmedString(raw)?.toLowerCase() ?? '';
  if (CATEGORIES.has(c as ShoppingListCategory)) return c as ShoppingListCategory;
  return 'other';
}

/** Assert + sanitize one shopping-list row from the job (checked always false until user toggles). */
export function parseShoppingListItem(raw: unknown): ShoppingListItem | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const name = asTrimmedString(o.name);
  if (!name) return null;
  const qty = asTrimmedString(o.qty) ?? '1';
  return {
    name: name.slice(0, 80),
    qty: qty.slice(0, 40),
    category: parseCategory(o.category),
    checked: o.checked === true,
  };
}

/**
 * Assert + sanitize generate_meal_plan JSON.
 * Empty days is allowed (unsafe dietary / thin prefs) — caller surfaces notes.
 */
export function parseGenerateMealPlanResult(raw: string): ParsedMealPlanJob {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('generate_meal_plan returned non-JSON');
  }
  if (!parsed || typeof parsed !== 'object') throw new Error('generate_meal_plan returned empty result');
  const o = parsed as Record<string, unknown>;

  const days = (Array.isArray(o.days) ? o.days : [])
    .map(parseDay)
    .filter((d): d is MealPlanStructuredDay => d !== null)
    .slice(0, 7);

  const shopping_list = (Array.isArray(o.shopping_list) ? o.shopping_list : [])
    .map(parseShoppingListItem)
    .filter((i): i is ShoppingListItem => i !== null)
    .slice(0, 80)
    .map((i) => ({ ...i, checked: false }));

  const notes = asTrimmedString(o.notes)?.slice(0, 400) ?? null;
  return { days, shopping_list, notes };
}

export interface FridgeLike {
  name: string;
  qty?: number;
  unit?: string;
}

/**
 * Aisle bucketing and shopping-list derivation now live in `@cadence/shared` — the Kitchen derives
 * the same list on the client (generated, never kept), and two copies of an aisle heuristic would
 * drift the first time one of them learned a new word. Re-exported here so this module's existing
 * callers and tests keep their import path.
 */
export { categorizeGrocery, deriveShoppingList } from '@cadence/shared';

/** Format fridge rows for the generate_meal_plan job variable. */
export function formatFridgeForJob(ingredients: FridgeLike[]): string {
  if (ingredients.length === 0) return '';
  return ingredients
    .map((i) => {
      const bits = [i.name.trim()];
      if (typeof i.qty === 'number' && i.qty > 0) bits.push(String(i.qty));
      if (i.unit?.trim()) bits.push(i.unit.trim());
      return bits.join(' ');
    })
    .join('; ');
}
