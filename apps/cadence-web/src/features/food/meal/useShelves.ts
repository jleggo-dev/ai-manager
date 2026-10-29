/**
 * The four shelves under the doors (quick log, 2026-10-28) — one tap each:
 *
 *   Planned   the week's dish for this slot; the tab is absent, not greyed, when there is none
 *   Usual     foods and one-portion recipes logged at this slot, most-often first (useUsualAtSlot)
 *   Leftovers meals logged recently, most recent first — the window is the user's (seven days)
 *   Cookbook  every saved recipe
 *
 * Every read is one the app already caches (the usual list, the cookbook, the recent meals,
 * the week), so the shelves paint from last launch's snapshot and correct behind themselves.
 * No kind markers on a tile: the shelf you are on already says what these are.
 */
import { useMemo } from 'react';
import type { Macros, MealItem, MealKind, MealPart, Recipe } from '@cadence/shared';
import { useRecentMeals, useRecipes } from '../../../lib/query/index.ts';
import { usePlannedMeal, type PlannedMeal } from '../../plan/occurrence/usePlannedMeal.ts';
import { useUsualAtSlot } from '../useUsualAtSlot.ts';
import { deriveLeftovers, leftoverLine } from './leftovers.ts';
import { useLeftoverWindow } from './leftoverWindow.ts';

export type ShelfKey = 'planned' | 'usual' | 'leftovers' | 'cookbook';

export const SHELF_LABELS: Record<ShelfKey, string> = {
  planned: 'Planned',
  usual: 'Usual',
  leftovers: 'Leftovers',
  cookbook: 'Cookbook',
};

export interface ShelfTile {
  key: string;
  kind: 'food' | 'recipe' | 'leftover' | 'planned';
  /**
   * food_id / recipe_id — `'planned'` for a composed planned dish with no recipe of its own; a
   * leftover's is the log_id of the meal it repeats.
   */
  id: string;
  name: string;
  sub?: string;
  kcal: number | null;
  /** One tap's protein / carbs / fat, for the tile's "P 12 · C 30 · F 8" line. */
  macros?: Pick<Macros, 'protein_g' | 'carbs_g' | 'fat_g'>;
  /** Recipes: how many a batch makes. */
  yield?: number;
  /** Leftovers: the meal's rows and brackets, as logged — what a tap puts back in the cart. */
  source?: { items: MealItem[]; parts: MealPart[] };
}

const pcf = (m: Partial<Record<'protein_g' | 'carbs_g' | 'fat_g', number | null>> | null | undefined) =>
  m ? { protein_g: m.protein_g ?? undefined, carbs_g: m.carbs_g ?? undefined, fat_g: m.fat_g ?? undefined } : undefined;

/** "yogurt · chia · whey · berries" — the first four ingredients, first word of each. */
function ingredientWords(r: Recipe): string | undefined {
  return (
    r.ingredients
      .map((i) => i.name.split(',')[0]!.trim())
      .filter(Boolean)
      .slice(0, 4)
      .join(' · ') || undefined
  );
}

function recipeKcal(r: Recipe | undefined): number | null {
  return typeof r?.macros_per_serving?.kcal === 'number' ? r.macros_per_serving.kcal : null;
}

function plannedTile(p: PlannedMeal | null, recipes: Recipe[]): ShelfTile | null {
  if (!p) return null;
  const recipe = p.recipe_id ? recipes.find((r) => r.recipe_id === p.recipe_id) : undefined;
  const kcal = p.recipe_id
    ? recipeKcal(recipe)
    : (p.items ?? []).reduce<number | null>((s, it) => (typeof it.kcal === 'number' ? (s ?? 0) + it.kcal : s), null);
  const sum = (k: 'protein_g' | 'carbs_g' | 'fat_g') =>
    (p.items ?? []).reduce<number | undefined>(
      (s, it) => (typeof it[k] === 'number' ? (s ?? 0) + it[k] : s),
      undefined,
    );
  const macros = p.recipe_id
    ? pcf(recipe?.macros_per_serving)
    : { protein_g: sum('protein_g'), carbs_g: sum('carbs_g'), fat_g: sum('fat_g') };
  return {
    key: 'planned',
    kind: 'planned',
    id: p.recipe_id ?? 'planned',
    name: p.name,
    sub: 'from your week',
    kcal,
    macros,
  };
}

export function useShelves(
  kind: MealKind,
  date: string,
  today: string,
  /** The meal in front of you — never its own leftover. */
  draftLogId: string | null,
): { keys: ShelfKey[]; planned: PlannedMeal | null; tiles: Record<ShelfKey, ShelfTile[]> } {
  const { planned } = usePlannedMeal(kind, date);
  const usual = useUsualAtSlot(kind);
  const { data: cookbook } = useRecipes(true);
  const windowDays = useLeftoverWindow();
  // Eight days is what the Food room already asks for, so the default seven-day window (today
  // plus seven back) shares that read; a longer window asks for its own.
  const { data: recent } = useRecentMeals(Math.max(8, windowDays + 1));

  return useMemo(() => {
    const recipes = cookbook?.recipes ?? [];
    const byId = new Map(recipes.map((r) => [r.recipe_id, r]));

    const usualTiles: ShelfTile[] = usual.map((u) => {
      const recipe = u.kind === 'recipe' ? byId.get(u.id) : undefined;
      return {
        key: `${u.kind}:${u.id}`,
        kind: u.kind,
        id: u.id,
        name: u.name,
        sub: recipe ? ingredientWords(recipe) : (u.serving_label ?? undefined),
        kcal: u.kcal,
        macros: pcf(u),
        ...(recipe ? { yield: recipe.servings } : {}),
      };
    });
    for (const r of recipes) {
      if (r.servings > 1 || usualTiles.some((t) => t.kind === 'recipe' && t.id === r.recipe_id)) continue;
      usualTiles.push({
        key: `recipe:${r.recipe_id}`,
        kind: 'recipe',
        id: r.recipe_id,
        name: r.name,
        sub: ingredientWords(r),
        kcal: recipeKcal(r),
        macros: pcf(r.macros_per_serving),
        yield: 1,
      });
    }

    const leftoverTiles: ShelfTile[] = deriveLeftovers(recent ?? [], today, windowDays, draftLogId).map((l) => ({
      key: `leftover:${l.log_id}`,
      kind: 'leftover',
      id: l.log_id,
      name: l.name,
      sub: leftoverLine(l, today),
      kcal: l.kcal,
      macros: pcf(l.macros),
      source: { items: l.items, parts: l.parts },
    }));

    const cookbookTiles: ShelfTile[] = recipes.map((r) => ({
      key: `cookbook:${r.recipe_id}`,
      kind: 'recipe',
      id: r.recipe_id,
      name: r.name,
      sub: r.servings > 1 ? `makes ${r.servings}` : ingredientWords(r),
      kcal: recipeKcal(r),
      macros: pcf(r.macros_per_serving),
      yield: r.servings,
    }));

    const plannedT = plannedTile(planned, recipes);
    const keys: ShelfKey[] = [...(plannedT ? (['planned'] as const) : []), 'usual', 'leftovers', 'cookbook'];
    return {
      keys,
      planned,
      tiles: {
        planned: plannedT ? [plannedT] : [],
        usual: usualTiles,
        leftovers: leftoverTiles,
        cookbook: cookbookTiles,
      },
    };
  }, [cookbook, draftLogId, planned, recent, today, usual, windowDays]);
}
