/**
 * The quick log's writes (2026-10-28) — what a tap, a hold and a × do to the draft. The draft
 * hook owns the round trips; this decides which one a gesture is:
 *
 *   tap a food      not in the cart → append it at its default serving; in the cart → double
 *                   the row (its quantity + what the first tap was worth)
 *   tap a dish      append one portion (a bracket); another tap, another portion
 *   tap Planned     the week's dish, exactly as the planner priced it
 *   hold → Add      a chosen amount: replaces the row a tap made, if there is one
 *   × on a chip     the row, or every row of the bracket
 *
 * `bases` is the one fact the server does not hold — what one tap of a food was worth — so the
 * badge can count taps and a second tap can double. Session-only, per food.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { MealPart } from '@cadence/shared';
import type { PlannedMeal } from '../../plan/occurrence/usePlannedMeal.ts';
import { cartChips, looseIndexOf, recipePortions, tileCount, type Bases, type CartChip } from './cartModel.ts';
import type { Portion } from './AmountSheet.tsx';
import type { MealDraft, ParsedAppendItem } from './useMealDraft.ts';
import type { ShelfTile } from './useShelves.ts';

const round2 = (n: number): number => Math.round(n * 100) / 100;

/** A planned dish's rows, as the planner priced them — never re-parsed, never priced twice. */
function plannedRows(meal: PlannedMeal): ParsedAppendItem[] {
  return (meal.items ?? []).map((it) => ({
    name: it.name,
    qty: it.qty,
    ...(it.unit ? { unit: it.unit } : {}),
    ...(it.kind === 'food' ? { food_id: it.id } : {}),
    est: {
      ...(typeof it.kcal === 'number' ? { kcal: it.kcal } : {}),
      ...(typeof it.protein_g === 'number' ? { protein_g: it.protein_g } : {}),
      ...(typeof it.carbs_g === 'number' ? { carbs_g: it.carbs_g } : {}),
      ...(typeof it.fat_g === 'number' ? { fat_g: it.fat_g } : {}),
    },
  }));
}

export function useQuickLogCart(draft: MealDraft, planned: PlannedMeal | null) {
  const [bases, setBases] = useState<Map<string, number>>(() => new Map());
  /** Taps on a composed planned dish — nothing on its rows says "planned" once they land. */
  const [plannedTaps, setPlannedTaps] = useState(0);
  const logId = draft.meal?.log_id;
  useEffect(() => setPlannedTaps(0), [logId]);

  const items = draft.items;
  const parts = useMemo<MealPart[]>(() => draft.meal?.parts ?? [], [draft.meal]);

  const remember = useCallback((foodId: string, qty: number) => {
    setBases((b) => {
      const next = new Map(b);
      next.set(foodId, qty > 0 ? qty : 1);
      return next;
    });
  }, []);

  const appendFoodDefault = useCallback(
    async (foodId: string) => {
      const m = await draft.appendFood({ food_id: foodId }, 'searched');
      const landed = m?.items[m.items.length - 1];
      if (landed) remember(foodId, landed.qty ?? 1);
      return !!m;
    },
    [draft, remember],
  );

  const tap = useCallback(
    async (tile: ShelfTile): Promise<void> => {
      if (tile.kind === 'food') {
        const i = looseIndexOf(items, tile.id);
        if (i < 0) {
          await appendFoodDefault(tile.id);
          return;
        }
        const row = items[i]!;
        const qty = row.qty ?? 1;
        const base = bases.get(tile.id) ?? qty;
        if (!bases.has(tile.id)) remember(tile.id, base);
        draft.setAmount(i, round2(qty + base));
        return;
      }
      if (tile.kind === 'planned') {
        if (!planned) return;
        const m = planned.recipe_id
          ? await draft.appendRecipe({ recipe_id: planned.recipe_id, servings: 1 })
          : await draft.appendParsed(plannedRows(planned), 'assumed');
        if (m && !planned.recipe_id) setPlannedTaps((n) => n + 1);
        return;
      }
      await draft.appendRecipe({ recipe_id: tile.id, servings: 1 });
    },
    [appendFoodDefault, bases, draft, items, planned, remember],
  );

  /** A chosen amount for a food: the row a tap made (if any) goes, the chosen one lands. */
  const addFoodPortion = useCallback(
    async (foodId: string, portion: Portion) => {
      const i = looseIndexOf(items, foodId);
      if (i >= 0) await draft.removeItem(i);
      const m = await draft.appendFood(
        { food_id: foodId, serving_index: portion.servingIndex, quantity: portion.quantity },
        'searched',
      );
      const landed = m?.items[m.items.length - 1];
      if (landed) remember(foodId, landed.qty ?? portion.quantity);
    },
    [draft, items, remember],
  );

  const addRecipe = useCallback(
    async (recipeId: string, servings: number) => {
      await draft.appendRecipe({ recipe_id: recipeId, servings });
    },
    [draft],
  );

  /** Every row the chip stands for, highest index first so each removal leaves the rest in place. */
  const removeChip = useCallback(
    async (chip: CartChip) => {
      for (const i of [...chip.indexes].sort((a, b) => b - a)) await draft.removeItem(i);
    },
    [draft],
  );

  const countOf = useCallback(
    (tile: ShelfTile): number => {
      if (tile.kind === 'planned') return planned?.recipe_id ? recipePortions(parts, planned.recipe_id) : plannedTaps;
      return tileCount(tile, items, parts, bases as Bases);
    },
    [bases, items, parts, planned, plannedTaps],
  );

  const chips = useMemo(() => cartChips(items, parts, bases), [bases, items, parts]);

  return { chips, countOf, tap, addFoodPortion, addRecipe, removeChip };
}
