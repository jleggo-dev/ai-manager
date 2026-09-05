import type { ShoppingListCategory, ShoppingListItem } from './types/nutrition.ts';

/**
 * Turning planned recipes into a grocery list — the one implementation, shared.
 *
 * This used to live only in `apps/cadence-api/src/services/meal-plan-parse.ts`, where it filled in
 * for a generate job that returned no `shopping_list`. The Kitchen needs the same arithmetic on the
 * CLIENT, because the Kitchen's list is **generated, never kept**: it is recomputed from whatever is
 * planned right now rather than stored and maintained, so a plan edit can never leave a stale list
 * behind. Two copies of an aisle heuristic would drift the first time someone added "shallot" to
 * one of them, so there is one copy and both sides import it.
 *
 * Nothing here judges food. An aisle is a walking order in a shop, not a food group.
 */

/**
 * An ingredient row as either side has it — the API's parsed qty is a number, a saved Recipe's may
 * be a string, and the type allows `null` because `Recipe.ingredients[]` does.
 *
 * In practice a saved recipe never carries one: a recipe with an unstated amount is refused at
 * save (`recipe.ts`), so `null` only exists on an unsaved draft, and drafts are not shopped from.
 * If one ever arrives, `toQty` treats it exactly like an amount it cannot read ("to taste") — the
 * line still says buy the thing, which is what a shopping list is for. It is never a macro.
 */
export interface ShoppingIngredient {
  name: string;
  qty: number | string | null;
  unit?: string;
}

/** Something already on hand — a fridge photo's read, or a pantry the user named. */
export interface OnHandItem {
  name: string;
}

/** `null` = the amount was never stated; the caller must not turn that into a number. */
function toQty(qty: number | string | null): number | null {
  if (qty === null) return null;
  if (typeof qty === 'number') return Number.isFinite(qty) ? qty : 1;
  const n = Number.parseFloat(qty);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

function roundQty(n: number): number {
  if (!Number.isFinite(n)) return 1;
  if (n >= 10) return Math.round(n);
  return Math.round(n * 10) / 10;
}

/** Heuristic aisle for a grocery name when the job omits a category. */
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

/** The quantity as the list prints it — the unit alone, or nothing, when the amount is unknown. */
function shopQty(qty: number | null, unit?: string): string {
  if (qty === null) return unit ?? '';
  return unit ? `${roundQty(qty)} ${unit}` : String(roundQty(qty));
}

/**
 * Derive a shopping list from planned recipe ingredients, subtracting anything already on hand.
 *
 * Same-name rows merge and their quantities add. Units are deliberately naive — "1 bag" plus
 * "1 bag" is "2 bag", and a bag plus 200g keeps the first unit — because a list you read while
 * standing in a shop is better slightly loose than absent, and no unit conversion table survives
 * contact with real recipes.
 *
 * An ingredient whose amount was never stated (`qty: null`) goes on the list with no number at
 * all. "Onion" is a true line; "1 onion" is a number nobody gave. If another recipe names an
 * amount for the same thing, that amount is what the line carries.
 */
export function deriveShoppingList(
  recipes: Array<{ ingredients: ShoppingIngredient[] }>,
  onHand: OnHandItem[] = [],
): ShoppingListItem[] {
  const have = new Set(onHand.map((f) => f.name.trim().toLowerCase()).filter(Boolean));
  const merged = new Map<string, { name: string; qty: number | null; unit?: string }>();

  for (const recipe of recipes) {
    for (const ing of recipe.ingredients ?? []) {
      const key = ing.name?.trim().toLowerCase();
      if (!key || have.has(key)) continue;
      const qty = toQty(ing.qty);
      const prev = merged.get(key);
      if (!prev) {
        merged.set(key, { name: ing.name.trim(), qty, unit: ing.unit });
        continue;
      }
      if (qty === null) continue;
      prev.qty = prev.qty === null ? qty : prev.qty + qty;
    }
  }

  return [...merged.values()]
    .map((row) => ({
      name: row.name.slice(0, 80),
      qty: shopQty(row.qty, row.unit),
      category: categorizeGrocery(row.name),
      checked: false,
    }))
    .slice(0, 80);
}
