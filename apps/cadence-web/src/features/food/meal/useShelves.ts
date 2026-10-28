/**
 * The four shelves under the doors (quick log, 2026-10-28) — one tap each:
 *
 *   Planned   the week's dish for this slot; the tab is absent, not greyed, when there is none
 *   Usual     foods and one-portion recipes logged at this slot, most-often first (useUsualAtSlot)
 *   Leftovers recipes cooked in multiples in the last four days, portions still unaccounted for
 *   Cookbook  every saved recipe
 *
 * Every read is one the app already caches (the usual list, the cookbook, the recent meals,
 * the week), so the shelves paint from last launch's snapshot and correct behind themselves.
 * No kind markers on a tile: the shelf you are on already says what these are.
 */
import { useMemo } from 'react';
import type { MealKind, MealPart, Recipe } from '@cadence/shared';
import { useRecentMeals, useRecipes } from '../../../lib/query/index.ts';
import { usePlannedMeal, type PlannedMeal } from '../../plan/occurrence/usePlannedMeal.ts';
import { useUsualAtSlot } from '../useUsualAtSlot.ts';
import { deriveLeftovers, leftoverLine } from './leftovers.ts';

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
  /** food_id / recipe_id — `'planned'` for a composed planned dish with no recipe of its own. */
  id: string;
  name: string;
  sub?: string;
  kcal: number | null;
  /** Recipes: how many a batch makes. Leftovers: how many are still unaccounted for. */
  yield?: number;
  left?: number;
}

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
  return { key: 'planned', kind: 'planned', id: p.recipe_id ?? 'planned', name: p.name, sub: 'from your week', kcal };
}

export function useShelves(
  kind: MealKind,
  date: string,
  today: string,
  draft: { log_id: string; date: string; parts: MealPart[] } | null,
): { keys: ShelfKey[]; planned: PlannedMeal | null; tiles: Record<ShelfKey, ShelfTile[]> } {
  const { planned } = usePlannedMeal(kind, date);
  const usual = useUsualAtSlot(kind);
  const { data: cookbook } = useRecipes(true);
  // Eight days is what the Food room already asks for, so the read is shared; the shelf only
  // looks LEFTOVER_WINDOW_DAYS back inside it.
  const { data: recent } = useRecentMeals(8);

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
        yield: 1,
      });
    }

    const sources = [
      ...(recent ?? []).filter((m) => !draft || m.log_id !== draft.log_id).map((m) => ({ ...m, parts: m.parts })),
      ...(draft ? [draft] : []),
    ];
    const leftoverTiles: ShelfTile[] = deriveLeftovers(sources, recipes, today).map((l) => ({
      key: `leftover:${l.recipe_id}`,
      kind: 'leftover',
      id: l.recipe_id,
      name: l.name,
      sub: leftoverLine(l, today),
      kcal: l.kcal,
      yield: l.yield,
      left: l.left,
    }));

    const cookbookTiles: ShelfTile[] = recipes.map((r) => ({
      key: `cookbook:${r.recipe_id}`,
      kind: 'recipe',
      id: r.recipe_id,
      name: r.name,
      sub: r.servings > 1 ? `makes ${r.servings}` : ingredientWords(r),
      kcal: recipeKcal(r),
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
  }, [cookbook, draft, planned, recent, today, usual]);
}
