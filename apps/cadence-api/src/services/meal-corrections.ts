/**
 * Correcting a meal that is already on the day.
 *
 * Everything else in the food stack improves the moment BEFORE a log. This is the moment after,
 * and since A23 it is the one that lasts: a food nothing matched is pinned as a permanent private
 * row so it is only ever estimated once, which is what makes the same latte cost the same every
 * day — and also what turns a bad capture from one wrong row into a durable one that will resolve
 * again tomorrow. The owner's pack of dill-pickle-SEASONED peanuts parsed as two foods on a comma,
 * and both "Dill Pickles" and "seasoned peanuts" are pinned in his ledger now.
 *
 * The three repairs that case actually needed, and what each one has to be careful about:
 *
 *   RENAME reaches backwards. "We might not have the right name but we definitely have the right
 *   nutrients" — so a rename must keep the numbers and fix only the label, on the log AND on the
 *   pinned food behind it. Anything less leaves the wrong name to resolve again. It reaches only
 *   into a food the user OWNS; a shared USDA or FatSecret row is everyone's.
 *
 *   MERGE folds one item into another — "these are the same thing" — and must fold the NUTRIENTS
 *   too, because the phantom item is carrying real numbers. Deleting the row and keeping the total
 *   would leave the sodium that never existed.
 *
 *   DROP removes an item that was never eaten. The totals then have to come down, which is the
 *   part that is easy to forget: a meal's macros are stored, not derived, so an items-only edit
 *   silently leaves yesterday's arithmetic in place.
 */
import type { Macros, NutritionLog } from '@cadence/shared';
import { renameOwnFood } from '../repos/foods.ts';
import { sumItemNutrients } from './food-pricing.ts';

type Items = NutritionLog['items'];
type Item = Items[number];

/** Nutrients recomputed from the items themselves — never trusted from the client. */
export function totalsFromItems(items: Items): Macros | null {
  return sumItemNutrients(items);
}

/**
 * Fold `from` into `into`, summing every nutrient both carry.
 *
 * The amount is deliberately NOT summed. Two rows that are the same food are usually one portion
 * read twice, not two portions eaten — and a wrong amount is visible and correctable, where a
 * doubled one hides inside a plausible number. The user is asked for the amount instead.
 */
export function mergeItems(items: Items, fromIndex: number, intoIndex: number): Items {
  if (fromIndex === intoIndex) return items;
  const from = items[fromIndex];
  const into = items[intoIndex];
  if (!from || !into) return items;

  // Sum the NUMBERS only — `Macros` also carries a `source` tag, which is not arithmetic.
  const est: Record<string, number> = {};
  for (const side of [into.est, from.est]) {
    for (const [key, value] of Object.entries(side ?? {})) {
      if (typeof value === 'number' && Number.isFinite(value)) est[key] = (est[key] ?? 0) + value;
    }
  }

  const merged: Item = {
    ...into,
    // A vendor either of them carried is kept — it was heard from the user and costs nothing.
    ...(into.brand || from.brand ? { brand: into.brand || from.brand } : {}),
    // A merge is the user's hand on the row, so the result is theirs however it was estimated.
    ...(Object.keys(est).length ? { est: { ...est, source: 'user' } as Macros } : {}),
  };
  return items.map((it, i) => (i === intoIndex ? merged : it)).filter((_, i) => i !== fromIndex);
}

/** Rename one item, keeping every number it carries. */
export function renameItem(items: Items, index: number, name: string, brand?: string | null): Items {
  const trimmed = name.trim();
  if (!trimmed) return items;
  return items.map((it, i) =>
    i === index
      ? {
          ...it,
          name: trimmed,
          ...(brand === undefined ? {} : brand ? { brand: brand.trim() } : { brand: undefined }),
        }
      : it,
  );
}

/**
 * The backwards half of a rename: fix the pinned food so it stops resolving under the wrong name.
 *
 * Best-effort on purpose. The log correction is what the user asked for and it has already been
 * made; if the pin cannot be renamed — it is shared, it is gone, the write fails — the meal is
 * still right, and failing the whole request would take away the fix they could see to protect
 * one they cannot.
 */
export async function reachBackToPin(
  userId: string,
  item: Item | undefined,
  name: string,
  brand?: string | null,
): Promise<boolean> {
  if (!item?.food_id) return false;
  try {
    const renamed = await renameOwnFood(userId, item.food_id, {
      name,
      ...(brand === undefined ? {} : { brand }),
    });
    return !!renamed;
  } catch (err) {
    console.warn('[meal-corrections] pin rename failed — the log is still corrected:', err);
    return false;
  }
}
