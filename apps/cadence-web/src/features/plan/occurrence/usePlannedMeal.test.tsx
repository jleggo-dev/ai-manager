/**
 * MP19 — a composed meal (frame 10a: "recipes, food, or both") planned for today's slot used to be
 * invisible here: this hook only ever checked `m.recipe_id`, which a composed meal never carries.
 * These pin that both shapes now surface, and that "also on your week" still dedupes sensibly
 * across a mix of the two.
 */
import { waitFor } from '@testing-library/react';
import { renderHookWithQuery } from '../../../test/withQuery.tsx';
import { getCurrentMealPlan } from '../../../lib/api.ts';
import { usePlannedMeal } from './usePlannedMeal.ts';

vi.mock('../../../lib/api.ts', () => ({ getCurrentMealPlan: vi.fn() }));

const mockedGetCurrentMealPlan = vi.mocked(getCurrentMealPlan);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('usePlannedMeal', () => {
  it('surfaces a composed meal planned for today — invisible before MP19', async () => {
    mockedGetCurrentMealPlan.mockResolvedValue({
      status: 'ok',
      plan: {
        meal_plan_id: 'mp1',
        week_of: '2026-08-24',
        shopping_list: [],
        days: [
          {
            day: '2026-08-26',
            meals: [
              {
                slot: 'dinner',
                name: 'Thighs, orzo & a side salad',
                items: [
                  { kind: 'recipe', id: 'r2', name: 'Chicken thighs & lemon orzo', qty: 1, unit: 'serving' },
                  { kind: 'food', id: 'f1', name: 'Rocket & tomato salad', qty: 120, unit: 'g' },
                ],
              },
            ],
          },
        ],
      },
    });

    const { result } = renderHookWithQuery(() => usePlannedMeal('dinner', '2026-08-26'));

    await waitFor(() => expect(result.current.planned).not.toBeNull());
    expect(result.current.planned).toEqual({
      name: 'Thighs, orzo & a side salad',
      items: [
        { kind: 'recipe', id: 'r2', name: 'Chicken thighs & lemon orzo', qty: 1, unit: 'serving' },
        { kind: 'food', id: 'f1', name: 'Rocket & tomato salad', qty: 120, unit: 'g' },
      ],
    });
  });

  it('still surfaces the legacy single-recipe shape', async () => {
    mockedGetCurrentMealPlan.mockResolvedValue({
      status: 'ok',
      plan: {
        meal_plan_id: 'mp2',
        week_of: '2026-08-24',
        shopping_list: [],
        days: [{ day: '2026-08-26', meals: [{ slot: 'dinner', recipe_id: 'r1', recipe_name: 'Beef chili' }] }],
      },
    });

    const { result } = renderHookWithQuery(() => usePlannedMeal('dinner', '2026-08-26'));

    await waitFor(() => expect(result.current.planned).toEqual({ recipe_id: 'r1', name: 'Beef chili' }));
  });

  it('is null when nothing is planned for this slot', async () => {
    mockedGetCurrentMealPlan.mockResolvedValue({
      status: 'ok',
      plan: { meal_plan_id: 'mp3', week_of: '2026-08-24', shopping_list: [], days: [] },
    });

    const { result } = renderHookWithQuery(() => usePlannedMeal('dinner', '2026-08-26'));

    await waitFor(() => expect(mockedGetCurrentMealPlan).toHaveBeenCalled());
    expect(result.current.planned).toBeNull();
    expect(result.current.alsoThisWeek).toEqual([]);
  });

  it('dedupes "also this week" across composed and legacy dishes, excluding today’s own', async () => {
    mockedGetCurrentMealPlan.mockResolvedValue({
      status: 'ok',
      plan: {
        meal_plan_id: 'mp4',
        week_of: '2026-08-24',
        shopping_list: [],
        days: [
          { day: '2026-08-24', meals: [{ slot: 'dinner', recipe_id: 'r1', recipe_name: 'Beef chili' }] },
          {
            day: '2026-08-25',
            meals: [
              { slot: 'dinner', name: 'Salad night', items: [{ kind: 'food', id: 'f9', name: 'Big salad', qty: 1 }] },
            ],
          },
          // Same slot as "today" below — must not duplicate into alsoThisWeek.
          { day: '2026-08-26', meals: [{ slot: 'dinner', recipe_id: 'r2', recipe_name: 'Salmon bowls' }] },
        ],
      },
    });

    const { result } = renderHookWithQuery(() => usePlannedMeal('dinner', '2026-08-26'));

    await waitFor(() => expect(result.current.planned?.name).toBe('Salmon bowls'));
    const names = result.current.alsoThisWeek.map((m) => m.name);
    expect(names).toEqual(['Beef chili', 'Salad night']);
  });
});
