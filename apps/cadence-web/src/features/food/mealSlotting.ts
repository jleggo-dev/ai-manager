/**
 * Where a logged thing sits (design 06). A latte at 08:32 belongs with the breakfast at 08:10 or
 * on its own as a snack, and the honest part is that **it is already counted either way** — this
 * only changes how the day reads back.
 *
 * Deliberately NOT windows. The design draws meal slots that open and close ("still open",
 * "closes 10:30") and the repo has no such concept — no meal has a time on it at all — so rather
 * than invent one, the fold offers the day's own most recent named meal and says what is in it.
 */
import type { Meal, MealKind } from '../../lib/api.ts';

/** The slots a day reads back as meals; the rest are things that happened alongside them. */
const NAMED: MealKind[] = ['breakfast', 'lunch', 'dinner'];

/** Loose enough to be a real question, strict enough not to ask about yesterday's dinner. */
export function isNamedMeal(kind: MealKind): boolean {
  return NAMED.includes(kind);
}

/**
 * The meal this newly-logged thing could join, or null when there is nothing to join. `meals`
 * comes off `GET /nutrition/day` newest-first, so the first named match is the latest one.
 */
export function foldCandidate(meals: Meal[], loggedId: string): Meal | null {
  return meals.find((m) => m.log_id !== loggedId && isNamedMeal(m.meal)) ?? null;
}

/** What a meal is, in its own contents — the sub-line under "With breakfast". */
export function mealContentsLine(meal: Meal): string {
  const things = meal.items.length;
  return [
    things ? `${things} thing${things === 1 ? '' : 's'} so far` : '',
    meal.macros?.kcal != null ? `${Math.round(meal.macros.kcal)} kcal` : '',
  ]
    .filter(Boolean)
    .join(' · ');
}
