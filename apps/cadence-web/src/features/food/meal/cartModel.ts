/**
 * The quick log's tap grammar, as arithmetic over the draft (quick log, 2026-10-28).
 *
 * Tap = +1 default serving (a ✓ badge) · tap again = ×2 (a ×2 badge) · × on a chip removes.
 * The draft is server truth — rows and brackets — so this file only READS it: which tile is in
 * the cart and how many times, and what the chips under the shelf say. The one thing the server
 * does not hold is what "one tap" was worth for a food (its first-tap quantity), and that is
 * `bases`: food_id → the quantity the first tap landed, kept client-side for the session so a
 * second tap can double it and the badge can count it.
 */
import { brandedFoodName, type MealItem, type MealPart } from '@cadence/shared';
import { numberWord } from '../bracket/copy.ts';

export type Bases = ReadonlyMap<string, number>;

export interface CartChip {
  key: string;
  label: string;
  /** Every row this chip stands for — a loose item is one index, a bracket is its members. */
  indexes: number[];
  /** A loose row opens its details on tap; a bracket only has its ×. */
  loose: boolean;
}

/** The last loose row holding this food — the one a second tap doubles. */
export function looseIndexOf(items: MealItem[], foodId: string): number {
  for (let i = items.length - 1; i >= 0; i -= 1) {
    const it = items[i]!;
    if (it.food_id === foodId && !it.part) return i;
  }
  return -1;
}

/** How many "taps" a loose row is worth: its quantity over the first tap's, rounded. */
export function tapsOf(item: MealItem, base: number | undefined): number {
  const qty = item.qty ?? 1;
  const b = base && base > 0 ? base : qty || 1;
  return Math.max(1, Math.round(qty / b));
}

/** Portions of this recipe in the cart — one bracket per append, each worth its servings. */
export function recipePortions(parts: MealPart[], recipeId: string): number {
  let n = 0;
  for (const p of parts) if (p.recipe_id === recipeId) n += p.servings_logged ?? 1;
  return n;
}

const rowKey = (it: MealItem): string => `${it.food_id ?? it.name.trim().toLowerCase()}|${it.qty ?? ''}`;

/**
 * How many whole copies of a past meal the cart holds — a leftover's badge. Read off the rows
 * (same food or name, same amount), so taking a chip out takes the badge down with it; nothing
 * on a row says which tile put it there.
 */
export function mealCopies(items: readonly MealItem[], source: readonly MealItem[]): number {
  if (!source.length) return 0;
  const need = new Map<string, number>();
  for (const it of source) need.set(rowKey(it), (need.get(rowKey(it)) ?? 0) + 1);
  const have = new Map<string, number>();
  for (const it of items) have.set(rowKey(it), (have.get(rowKey(it)) ?? 0) + 1);
  let copies = Infinity;
  for (const [k, n] of need) copies = Math.min(copies, Math.floor((have.get(k) ?? 0) / n));
  return copies;
}

/** The badge a tile wears: 0 = none, 1 = ✓, n = ×n. */
export function tileCount(
  tile: { kind: 'food' | 'recipe' | 'leftover' | 'planned'; id: string; source?: { items: readonly MealItem[] } },
  items: MealItem[],
  parts: MealPart[],
  bases: Bases,
): number {
  if (tile.kind === 'food') {
    const i = looseIndexOf(items, tile.id);
    return i < 0 ? 0 : tapsOf(items[i]!, bases.get(tile.id));
  }
  if (tile.kind === 'leftover') return mealCopies(items, tile.source?.items ?? []);
  return recipePortions(parts, tile.id);
}

export function badgeFor(count: number): string {
  return count > 1 ? `×${count}` : '✓';
}

/** The chips under the shelf, in the order things landed: brackets as one chip, loose rows as one each. */
export function cartChips(items: MealItem[], parts: MealPart[], bases: Bases): CartChip[] {
  const chips: CartChip[] = [];
  const seenPart = new Map<string, CartChip>();
  const byRecipe = new Map<string, { chip: CartChip; portions: number }>();

  items.forEach((it, index) => {
    if (it.part) {
      const part = parts.find((p) => p.key === it.part);
      if (!part) return;
      // Several brackets of one recipe (tap, tap) read as one chip, "2× Yogurt bowl".
      if (part.recipe_id) {
        const have = byRecipe.get(part.recipe_id);
        if (have) {
          have.chip.indexes.push(index);
          return;
        }
      }
      const have = seenPart.get(part.key);
      if (have) {
        have.indexes.push(index);
        return;
      }
      const chip: CartChip = { key: `part:${part.key}`, label: '', indexes: [index], loose: false };
      seenPart.set(part.key, chip);
      if (part.recipe_id) byRecipe.set(part.recipe_id, { chip, portions: 0 });
      chips.push(chip);
      return;
    }
    const taps = tapsOf(it, it.food_id ? bases.get(it.food_id) : undefined);
    chips.push({
      key: `item:${index}`,
      label: taps > 1 ? `${taps}× ${brandedFoodName(it.name, it.brand)}` : brandedFoodName(it.name, it.brand),
      indexes: [index],
      loose: true,
    });
  });

  // Bracket labels last, once every member and every sibling bracket has been seen.
  for (const [key, chip] of seenPart) {
    const part = parts.find((p) => p.key === key)!;
    const portions = part.recipe_id ? recipePortions(parts, part.recipe_id) : (part.servings_logged ?? 1);
    const name = part.name ?? `${numberWord(chip.indexes.length)} things`;
    chip.label = portions > 1 ? `${portions}× ${name}` : name;
  }
  return chips;
}
