import type { MealPlanDay, Recipe } from '@cadence/shared';
import {
  addMeal,
  mealAt,
  plannedCount,
  plannedRecipes,
  removeMeal,
  toDraftRecipe,
  weekDaysFrom,
} from './kitchenPlan.ts';

const recipe = (over: Partial<Recipe> = {}): Recipe => ({
  recipe_id: 'r1',
  name: 'Beef chili',
  source: 'user',
  servings: 4,
  ingredients: [{ name: 'ground beef', qty: 500, unit: 'g' }],
  steps: ['brown the beef'],
  macros_per_serving: { kcal: 520 },
  tags: [],
  saved: true,
  ...over,
});

describe('weekDaysFrom', () => {
  it('gives the seven days that follow the week start', () => {
    const days = weekDaysFrom('2026-08-24');
    expect(days).toHaveLength(7);
    expect(days[0]).toBe('2026-08-24');
    expect(days[6]).toBe('2026-08-30');
  });

  it('walks across a month boundary without losing a day', () => {
    expect(weekDaysFrom('2026-08-31')).toEqual([
      '2026-08-31',
      '2026-09-01',
      '2026-09-02',
      '2026-09-03',
      '2026-09-04',
      '2026-09-05',
      '2026-09-06',
    ]);
  });
});

describe('addMeal', () => {
  it('plans a recipe onto a day that had nothing', () => {
    const days = addMeal([], '2026-08-26', 'dinner', recipe());
    expect(days).toEqual([
      { day: '2026-08-26', meals: [{ slot: 'dinner', recipe_id: 'r1', recipe_name: 'Beef chili' }] },
    ]);
  });

  it('REPLACES what was in the slot rather than stacking a second dinner on one day', () => {
    const first = addMeal([], '2026-08-26', 'dinner', recipe());
    const second = addMeal(first, '2026-08-26', 'dinner', recipe({ recipe_id: 'r2', name: 'Dal' }));
    expect(second[0]?.meals).toHaveLength(1);
    expect(mealAt(second, '2026-08-26', 'dinner')?.recipe_name).toBe('Dal');
  });

  it('keeps other slots on the same day, in the order a day runs', () => {
    let days = addMeal([], '2026-08-26', 'dinner', recipe());
    days = addMeal(days, '2026-08-26', 'breakfast', recipe({ recipe_id: 'r3', name: 'Oats' }));
    expect(days[0]?.meals.map((m) => m.slot)).toEqual(['breakfast', 'dinner']);
  });

  it('keeps days in date order however they were added', () => {
    let days = addMeal([], '2026-08-28', 'dinner', recipe());
    days = addMeal(days, '2026-08-25', 'lunch', recipe({ recipe_id: 'r2' }));
    expect(days.map((d) => d.day)).toEqual(['2026-08-25', '2026-08-28']);
  });
});

describe('removeMeal', () => {
  it('takes one meal off and leaves the rest of the day', () => {
    let days = addMeal([], '2026-08-26', 'dinner', recipe());
    days = addMeal(days, '2026-08-26', 'lunch', recipe({ recipe_id: 'r2', name: 'Dal' }));
    const after = removeMeal(days, '2026-08-26', 'lunch');
    expect(after[0]?.meals.map((m) => m.slot)).toEqual(['dinner']);
  });

  /** The API's day schema requires at least one meal, so an emptied day cannot simply linger. */
  it('drops a day entirely once its last meal comes off', () => {
    const days = addMeal([], '2026-08-26', 'dinner', recipe());
    expect(removeMeal(days, '2026-08-26', 'dinner')).toEqual([]);
  });
});

describe('plannedCount / plannedRecipes', () => {
  const days: MealPlanDay[] = [
    { day: '2026-08-25', meals: [{ slot: 'dinner', recipe_id: 'r1' }] },
    {
      day: '2026-08-26',
      meals: [
        { slot: 'lunch', recipe_id: 'r1' },
        { slot: 'dinner', recipe_id: 'r2' },
      ],
    },
  ];

  it('counts every planned meal, repeats included', () => {
    expect(plannedCount(days)).toBe(3);
  });

  it('lists each distinct recipe ONCE — chili twice is still one shop for beef', () => {
    const byId = new Map([
      ['r1', recipe()],
      ['r2', recipe({ recipe_id: 'r2', name: 'Dal' })],
    ]);
    expect(plannedRecipes(days, byId).map((r) => r.name)).toEqual(['Beef chili', 'Dal']);
  });

  it('skips a planned id whose recipe it cannot see rather than inventing one', () => {
    expect(plannedRecipes(days, new Map([['r2', recipe({ recipe_id: 'r2' })]]))).toHaveLength(1);
  });
});

describe('toDraftRecipe', () => {
  it('carries the saved id so confirming a week reuses the row instead of copying it', () => {
    expect(toDraftRecipe(recipe()).reuse_recipe_id).toBe('r1');
  });

  it('coerces a string quantity to the number the confirm endpoint requires', () => {
    const draft = toDraftRecipe(recipe({ ingredients: [{ name: 'onion', qty: '2', unit: 'item' }] }));
    expect(draft.ingredients[0]?.qty).toBe(2);
  });

  it('falls back to 1 for a quantity that is not a number at all', () => {
    const draft = toDraftRecipe(recipe({ ingredients: [{ name: 'salt', qty: 'a pinch' }] }));
    expect(draft.ingredients[0]?.qty).toBe(1);
  });
});
