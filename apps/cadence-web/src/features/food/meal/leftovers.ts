/**
 * The Leftovers shelf (quick log, 2026-10-28) — any logged recipe with yield > 1 in the last
 * four days, with the portions still unaccounted for: "2 of 4 left · Mon". Tapping one logs a
 * portion and the count comes down; gone when it hits zero or ages out.
 *
 * Pure over what the app already holds — the recent meals' brackets (`yield_servings`,
 * `servings_logged`) and the cookbook — so no new endpoint and no new column. The open draft is
 * a source too: a batch cooked INTO this very meal ("Shakshuka, makes 2", one portion in the
 * cart) is a leftover from the moment it lands, and a portion taken from the cart counts
 * against the batch before the recent-meals cache has heard about it.
 */
import type { MealPart, Recipe } from '@cadence/shared';

/** How far back a batch stays fresh. Four days is the canvas's number. */
export const LEFTOVER_WINDOW_DAYS = 4;

export interface LeftoverSource {
  log_id: string;
  /** YYYY-MM-DD */
  date: string;
  parts?: MealPart[] | null;
}

export interface Leftover {
  recipe_id: string;
  name: string;
  /** The batch's yield at cook time. */
  yield: number;
  /** Portions nobody has logged yet. Always ≥ 1 here — zero is dropped. */
  left: number;
  /** YYYY-MM-DD of the batch — the newest yield>1 bracket for this recipe. */
  cookedOn: string;
  kcal: number | null;
}

const DAY_MS = 86_400_000;

/** Days from `from` to `to`, both YYYY-MM-DD, read as UTC so a timezone never shifts a date. */
export function daysBetween(from: string, to: string): number {
  const [fy, fm, fd] = from.split('-').map(Number);
  const [ty, tm, td] = to.split('-').map(Number);
  const a = Date.UTC(fy ?? 0, (fm ?? 1) - 1, fd ?? 1);
  const b = Date.UTC(ty ?? 0, (tm ?? 1) - 1, td ?? 1);
  return Math.round((b - a) / DAY_MS);
}

interface Portion {
  date: string;
  yield: number;
  logged: number;
  name: string | null;
}

/**
 * The shelf, newest batch first.
 *
 * Every bracket appended from a "makes 4" recipe carries `yield_servings: 4` — the cook and
 * the Tuesday portion look the same on the row — so a batch cannot be read off one bracket.
 * It is read off the COUNT: the portions of a recipe logged inside the window, in date order,
 * fill batches of its yield one after another. The batch in progress is whichever the last
 * portion fell in; what is left is the rest of it; it was cooked on the day its first portion
 * landed. Four portions of a makes-four is a finished batch (nothing on the shelf); a fifth
 * starts a new one with three to go.
 */
export function deriveLeftovers(sources: LeftoverSource[], recipes: Recipe[], today: string): Leftover[] {
  const byRecipe = new Map<string, Recipe>(recipes.map((r) => [r.recipe_id, r]));
  const portions = new Map<string, Portion[]>();

  const inWindow = sources
    .filter((s) => {
      const age = daysBetween(s.date, today);
      return age >= 0 && age <= LEFTOVER_WINDOW_DAYS;
    })
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  for (const s of inWindow) {
    for (const p of s.parts ?? []) {
      if (!p.recipe_id) continue;
      const list = portions.get(p.recipe_id) ?? [];
      list.push({ date: s.date, yield: p.yield_servings ?? 1, logged: p.servings_logged ?? 1, name: p.name });
      portions.set(p.recipe_id, list);
    }
  }

  const out: Leftover[] = [];
  for (const [recipeId, list] of portions) {
    const yieldN = Math.max(...list.map((p) => p.yield));
    if (yieldN <= 1) continue;
    let cum = 0;
    let cookedOn = list[0]!.date;
    for (const p of list) {
      const before = cum;
      cum += p.logged;
      // The batch the last portion fell in; this entry holds its first portion when the
      // running count crossed its lower edge here.
      const batchStart = Math.floor((cum - 1) / yieldN) * yieldN + 1;
      if (before < batchStart && batchStart <= cum) cookedOn = p.date;
    }
    const left = Math.ceil(cum / yieldN) * yieldN - cum;
    if (left < 1) continue;
    const recipe = byRecipe.get(recipeId);
    out.push({
      recipe_id: recipeId,
      name: recipe?.name ?? list.find((p) => p.name)?.name ?? 'Leftovers',
      yield: yieldN,
      left,
      cookedOn,
      kcal: typeof recipe?.macros_per_serving?.kcal === 'number' ? recipe.macros_per_serving.kcal : null,
    });
  }
  return out.sort((a, b) => (a.cookedOn < b.cookedOn ? 1 : a.cookedOn > b.cookedOn ? -1 : 0));
}

/** "2 of 4 left · Mon" — "today" for a batch cooked today. */
export function leftoverLine(l: Leftover, today: string): string {
  const when =
    l.cookedOn === today
      ? 'today'
      : new Date(`${l.cookedOn}T12:00:00`).toLocaleDateString('en-GB', { weekday: 'short' });
  return `${l.left} of ${l.yield} left · ${when}`;
}
