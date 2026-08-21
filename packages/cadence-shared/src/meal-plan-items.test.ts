/**
 * The plan arithmetic, and the back-compat that has to survive it.
 *
 * Frames 10b/10c show every day totalled against target, and the same sum has to agree in three
 * places — a day row, a day screen, a week header. These pin the two things that would go wrong
 * quietly: a legacy single-recipe plan reading as a confident 0 kcal, and the week average being
 * taken over seven days when only five are set.
 */
import { describe, it, expect } from 'vitest';
import { mealPlanItems, mealPlanLabel, mealTotals, dayTotals, weekAverage, landsOnTarget } from './meal-plan-items.ts';
import type { MealPlanDay, MealPlanMeal } from './types/nutrition.ts';

const legacy: MealPlanMeal = { slot: 'dinner', recipe_id: 'r1', recipe_name: 'Beef chili' };
const composed: MealPlanMeal = {
  slot: 'dinner',
  name: 'Thighs, orzo & a side salad',
  items: [
    {
      kind: 'recipe',
      id: 'r2',
      name: 'Chicken thighs & lemon orzo',
      qty: 1,
      unit: 'serving',
      kcal: 520,
      protein_g: 40,
    },
    { kind: 'food', id: 'f1', name: 'Rocket & tomato salad', qty: 120, unit: 'g', kcal: 35, protein_g: 2 },
    { kind: 'food', id: 'f2', name: 'Olive oil', qty: 1, unit: 'tbsp', kcal: 119, protein_g: 0 },
  ],
};

describe('mealPlanItems — one shape out, whatever went in', () => {
  it('normalizes a legacy single-recipe meal', () => {
    expect(mealPlanItems(legacy)).toEqual([{ kind: 'recipe', id: 'r1', name: 'Beef chili', qty: 1, unit: 'serving' }]);
  });

  it('passes a composed meal through', () => {
    expect(mealPlanItems(composed)).toHaveLength(3);
  });

  it('an empty meal is empty, not a crash', () => {
    expect(mealPlanItems({ slot: 'lunch' })).toEqual([]);
  });
});

describe('mealPlanLabel', () => {
  it('prefers the name the user gave it', () => {
    expect(mealPlanLabel(composed)).toBe('Thighs, orzo & a side salad');
  });
  it('falls back to what is in it', () => {
    expect(mealPlanLabel(legacy)).toBe('Beef chili');
    expect(mealPlanLabel({ ...composed, name: undefined })).toBe('Chicken thighs & lemon orzo +2');
  });
});

describe('totals', () => {
  it('adds a composed meal up — frame 10a shows 674 for exactly this', () => {
    const t = mealTotals(composed);
    expect(t.kcal).toBe(674);
    expect(t.protein_g).toBe(42);
    expect(t.counted).toBe(3);
  });

  /**
   * THE one that matters. A legacy meal stored no macros, so a day made of them must not render a
   * confident zero — `counted: 0` is how a caller knows the difference between "we don't know" and
   * "none". The 2026-08-20 zero-calorie meals were that exact mistake in the food log.
   */
  it('reports a legacy meal as uncounted rather than as zero calories', () => {
    const t = mealTotals(legacy);
    expect(t.kcal).toBe(0);
    expect(t.items).toBe(1);
    expect(t.counted).toBe(0);
  });

  it('sums a whole day', () => {
    const day: MealPlanDay = { day: '2026-09-03', meals: [composed, composed] };
    expect(dayTotals(day).kcal).toBe(1348);
  });

  it('a missing day totals to nothing without throwing', () => {
    expect(dayTotals(undefined).kcal).toBe(0);
  });

  /**
   * BRAND: honest round numbers, never precise-sounding ones. A tablespoon of olive oil is 119.3
   * kcal; a meal containing it must not advertise 639.3. Rounded at the SUM rather than per item,
   * so four items rounded up cannot put the meal above anything that was planned.
   */
  it('rounds the total, not each item', () => {
    const oily = {
      slot: 'dinner',
      items: [
        { kind: 'recipe' as const, id: 'r', name: 'Orzo', qty: 1, kcal: 520 },
        { kind: 'food' as const, id: 'f', name: 'Olive oil', qty: 1, kcal: 119.3 },
      ],
    };
    expect(mealTotals(oily).kcal).toBe(639);
  });
});

describe('weekAverage — "across the 5 days you have set"', () => {
  const week = (setDays: number): MealPlanDay[] =>
    Array.from({ length: 7 }, (_, i) => ({
      day: `2026-09-0${i + 1}`,
      meals: i < setDays ? [composed] : [],
    }));

  it('divides by the days that have something planned, not by seven', () => {
    // 5 days × 674 kcal. Averaged over 7 this would read 481 — and understate every day set.
    expect(weekAverage(week(5))).toMatchObject({ kcal: 674, daysSet: 5 });
  });

  it('an empty week averages to nothing rather than dividing by zero', () => {
    expect(weekAverage(week(0))).toMatchObject({ kcal: 0, daysSet: 0 });
  });
});

describe('landsOnTarget — BRAND: information, never judgement', () => {
  it('says so when the day lands on target', () => {
    expect(landsOnTarget(1930, 1940)).toBe('lands on target');
  });

  /** No "over budget", no red, no failure framing. Above is a fact; below is room. */
  it('describes above and below without judging either', () => {
    expect(landsOnTarget(2400, 1940)).toBe('a little above your target');
    expect(landsOnTarget(1200, 1940)).toBe('leaves some room');
  });

  it('says nothing at all without a target — there is no denominator', () => {
    expect(landsOnTarget(1930, null)).toBeNull();
    expect(landsOnTarget(1930, 0)).toBeNull();
    expect(landsOnTarget(0, 1940)).toBeNull();
  });
});
