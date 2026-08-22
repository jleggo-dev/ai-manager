/**
 * Reading a planned meal, whatever shape it was saved in — and adding it up.
 *
 * A meal in the week's plan comes in two shapes. The ORIGINAL is a single recipe
 * (`{ slot, recipe_id }`), which is what `generate_meal_plan` emits and what every plan saved
 * before 2026-08-21 contains. The one frame 10a composes is a NAMED meal of several items —
 * *"recipes, food, or both"* — because most dinners are a main plus a side plus the oil it was
 * cooked in, and a planner that only holds recipes cannot describe them.
 *
 * Nothing migrates. Old plans stay exactly as written and are normalized on read, so a caller never
 * branches on how old a plan is. That is the whole point of this module: `mealPlanItems()` and
 * `mealTotals()` are the only two things the Kitchen needs to know.
 *
 * Frames 10b and 10c are why the totals live here rather than in a component. Both show planned
 * against target — "1,880 of 1,940", "4 meals planned · lands on target", and a week average taken
 * *"across the 5 days you have set"* — and the same arithmetic has to agree in three places
 * (a day row, a day screen, a week header). Arithmetic that is written three times is arithmetic
 * that disagrees three ways.
 */
import type { MealPlanDay, MealPlanItem, MealPlanMeal } from './types/nutrition.ts';

/** The items in a meal, normalizing the legacy single-recipe shape into one. */
export function mealPlanItems(meal: MealPlanMeal): MealPlanItem[] {
  if (meal.items?.length) return meal.items;
  if (meal.recipe_id) {
    // A legacy meal carries no macros — it never stored any. `mealTotals` reports that honestly
    // rather than counting it as zero, which is the difference between "we don't know" and "none".
    return [{ kind: 'recipe', id: meal.recipe_id, name: meal.recipe_name ?? 'Saved recipe', qty: 1, unit: 'serving' }];
  }
  return [];
}

/** What to call a meal in a list: the user's own name first, else what is in it. */
export function mealPlanLabel(meal: MealPlanMeal): string {
  if (meal.name?.trim()) return meal.name.trim();
  const items = mealPlanItems(meal);
  const first = items[0];
  if (!first) return 'Nothing yet';
  return items.length === 1 ? first.name : `${first.name} +${items.length - 1}`;
}

export interface PlanTotals {
  kcal: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  /** Items that carried numbers, and items in total. */
  counted: number;
  items: number;
}

const EMPTY: PlanTotals = { kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0, counted: 0, items: 0 };

/**
 * Rounded at the TOTAL, never per item.
 *
 * A tablespoon of olive oil is 119.3 kcal and a serving of orzo is 520, so a meal of the two sums
 * to 639.3 — and printing that is the thing BRAND.md calls a precise-sounding value. These are
 * estimates of an intention; honest round numbers are the whole register. Rounding the SUM rather
 * than each item avoids the other failure, where four items each rounded up put the meal 4 kcal
 * above anything that was actually planned.
 */
function round(t: PlanTotals): PlanTotals {
  return {
    ...t,
    kcal: Math.round(t.kcal),
    protein_g: Math.round(t.protein_g),
    carbs_g: Math.round(t.carbs_g),
    fat_g: Math.round(t.fat_g),
  };
}

function addItem(t: PlanTotals, i: MealPlanItem): PlanTotals {
  const has = typeof i.kcal === 'number';
  return {
    kcal: t.kcal + (i.kcal ?? 0),
    protein_g: t.protein_g + (i.protein_g ?? 0),
    carbs_g: t.carbs_g + (i.carbs_g ?? 0),
    fat_g: t.fat_g + (i.fat_g ?? 0),
    counted: t.counted + (has ? 1 : 0),
    items: t.items + 1,
  };
}

/**
 * `counted` vs `items` is not bookkeeping — it is the honesty line the nutrients screen already
 * uses ("counted from 6 of your 8 items"). A legacy meal stores no macros at all, so a day made of
 * them would otherwise render a confident 0 kcal. The 2026-08-20 zero-calorie meals were exactly
 * that mistake in the log; it is not going to be repeated in the plan.
 */
export function mealTotals(meal: MealPlanMeal): PlanTotals {
  return round(mealPlanItems(meal).reduce(addItem, EMPTY));
}

export function dayTotals(day: MealPlanDay | undefined): PlanTotals {
  return round((day?.meals ?? []).flatMap(mealPlanItems).reduce(addItem, EMPTY));
}

/** Averaged across the days that have anything planned — frame 10b's "the 5 days you have set". */
export function weekAverage(days: MealPlanDay[]): PlanTotals & { daysSet: number } {
  const set = days.filter((d) => (d.meals ?? []).length > 0);
  if (set.length === 0) return { ...EMPTY, daysSet: 0 };
  const sum = set.map(dayTotals).reduce(
    (a, t) => ({
      kcal: a.kcal + t.kcal,
      protein_g: a.protein_g + t.protein_g,
      carbs_g: a.carbs_g + t.carbs_g,
      fat_g: a.fat_g + t.fat_g,
      counted: a.counted + t.counted,
      items: a.items + t.items,
    }),
    EMPTY,
  );
  const per = (n: number) => Math.round(n / set.length);
  return {
    kcal: per(sum.kcal),
    protein_g: per(sum.protein_g),
    carbs_g: per(sum.carbs_g),
    fat_g: per(sum.fat_g),
    counted: sum.counted,
    items: sum.items,
    daysSet: set.length,
  };
}

/**
 * How a planned day sits against its target — frame 10c's *"lands on target"*.
 *
 * BRAND: count what happened, never what broke. There is no "over budget" and no red. A day above
 * target reads as "a little above", which is information; a day below reads as room, not failure.
 * `null` when there is no target, because without a denominator there is nothing true to say.
 */
export function landsOnTarget(kcal: number, targetKcal: number | null | undefined): string | null {
  if (!targetKcal || targetKcal <= 0 || kcal <= 0) return null;
  const delta = (kcal - targetKcal) / targetKcal;
  if (Math.abs(delta) <= 0.05) return 'lands on target';
  return delta > 0 ? 'a little above your target' : 'leaves some room';
}
