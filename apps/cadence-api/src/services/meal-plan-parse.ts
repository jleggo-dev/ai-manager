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

export interface MealPlanStructuredRecipe extends StructuredRecipe {
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

function parseIngredient(raw: unknown): StructuredIngredient | null {
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
    .filter((i): i is StructuredIngredient => i !== null)
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

/** Heuristic aisle for a grocery name when the job omits category. */
export function categorizeGrocery(name: string): ShoppingListCategory {
  const n = name.toLowerCase();
  if (/\b(milk|yogurt|cheese|butter|cream|egg)\b/.test(n)) return 'dairy';
  if (/\b(chicken|beef|pork|turkey|fish|salmon|tofu|tempeh|shrimp)\b/.test(n)) return 'protein';
  if (/\b(frozen|ice cream)\b/.test(n)) return 'frozen';
  if (/\b(bread|bagel|tortilla|bun)\b/.test(n)) return 'bakery';
  if (
    /\b(lettuce|spinach|kale|tomato|onion|garlic|pepper|broccoli|carrot|berry|berries|apple|banana|lemon|lime|avocado|potato|herb)\b/.test(
      n,
    )
  )
    return 'produce';
  if (/\b(rice|pasta|bean|oat|flour|oil|salt|spice|sauce|can|broth)\b/.test(n)) return 'pantry';
  return 'other';
}

export interface FridgeLike {
  name: string;
  qty?: number;
  unit?: string;
}

/**
 * Derive a shopping list from planned recipe ingredients, subtracting fridge items by name.
 * Used when the job returns an empty shopping_list (or as a merge fill-in).
 */
export function deriveShoppingList(
  recipes: Array<{ ingredients: StructuredIngredient[] }>,
  fridge: FridgeLike[] = [],
): ShoppingListItem[] {
  const have = new Set(fridge.map((f) => f.name.trim().toLowerCase()).filter(Boolean));
  const merged = new Map<string, { name: string; qty: number; unit?: string }>();

  for (const recipe of recipes) {
    for (const ing of recipe.ingredients) {
      const key = ing.name.trim().toLowerCase();
      if (!key || have.has(key)) continue;
      const prev = merged.get(key);
      if (!prev) {
        merged.set(key, { name: ing.name.trim(), qty: ing.qty, unit: ing.unit });
        continue;
      }
      // Same unit → sum; otherwise keep the first unit and bump qty loosely.
      if (prev.unit && ing.unit && prev.unit === ing.unit) prev.qty += ing.qty;
      else prev.qty += ing.qty;
    }
  }

  return [...merged.values()]
    .map((row) => ({
      name: row.name.slice(0, 80),
      qty: row.unit ? `${roundQty(row.qty)} ${row.unit}` : String(roundQty(row.qty)),
      category: categorizeGrocery(row.name),
      checked: false,
    }))
    .slice(0, 80);
}

function roundQty(n: number): number {
  if (!Number.isFinite(n)) return 1;
  if (n >= 10) return Math.round(n);
  return Math.round(n * 10) / 10;
}

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
