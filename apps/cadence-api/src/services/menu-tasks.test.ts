import { describe, it, expect } from 'vitest';
import type { MealPlan } from '@cadence/shared';
import { dayBefore, planMenuTasks } from './menu-plan.ts';

type PlanInput = Pick<MealPlan, 'days' | 'shopping_list'>;

const week: PlanInput = {
  days: [
    { day: '2026-07-27', meals: [{ slot: 'dinner', recipe_id: 'chili', recipe_name: 'Chili' }] },
    { day: '2026-07-28', meals: [{ slot: 'dinner', recipe_id: 'chili', recipe_name: 'Chili' }] }, // leftover — deduped
    { day: '2026-07-29', meals: [{ slot: 'dinner', recipe_id: 'salmon', recipe_name: 'Salmon' }] },
    { day: '2026-07-30', meals: [{ slot: 'lunch', recipe_id: 'soup', recipe_name: 'Soup' }] }, // not a dinner — ignored
  ],
  shopping_list: [{ name: 'beef mince', qty: '500g', category: 'protein', checked: false }],
};

describe('planMenuTasks', () => {
  it('one cook per distinct cooked dinner + a shop the day before the first', () => {
    const tasks = planMenuTasks(week);
    const cook = tasks.filter((t) => t.kind === 'cook');
    const shop = tasks.filter((t) => t.kind === 'shop');
    expect(cook.map((c) => c.date)).toEqual(['2026-07-27', '2026-07-29']);
    expect(cook[0]?.title).toBe('Cook Chili');
    expect(shop).toHaveLength(1);
    expect(shop[0]?.date).toBe('2026-07-26'); // day before Mon 27
    expect(shop[0]?.title).toBe('Pick up 1 things');
  });

  it('emits nothing when nothing is cooked', () => {
    expect(planMenuTasks({ days: [], shopping_list: [] })).toEqual([]);
  });

  it('emits a cook but no shop when the shopping list is empty', () => {
    const tasks = planMenuTasks({
      days: [{ day: '2026-07-27', meals: [{ slot: 'dinner', recipe_id: 'a', recipe_name: 'A' }] }],
      shopping_list: [],
    });
    expect(tasks.filter((t) => t.kind === 'shop')).toHaveLength(0);
    expect(tasks.filter((t) => t.kind === 'cook')).toHaveLength(1);
  });
});

describe('dayBefore', () => {
  it('subtracts a calendar day, across a month boundary', () => {
    expect(dayBefore('2026-08-01')).toBe('2026-07-31');
    expect(dayBefore('2026-07-27')).toBe('2026-07-26');
  });
});
