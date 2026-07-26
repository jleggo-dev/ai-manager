import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import {
  parseMealPlan,
  parseMealPlanDraft,
  weekOfMonday,
  shoppingListSummary,
  listMealPlans,
  generateMealPlan,
  probeRecipeDiscovery,
} from './meal-plans.ts';

describe('meal-plans parsers', () => {
  it('parses wrapped meal_plan with shopping list', () => {
    const plan = parseMealPlan({
      meal_plan: {
        meal_plan_id: 'mp1',
        week_of: '2026-07-20',
        days: [{ day: '2026-07-20', meals: [{ slot: 'lunch', recipe_id: 'r1', recipe_name: 'Chili' }] }],
        shopping_list: [{ name: 'beans', qty: '2', category: 'pantry', checked: false }],
      },
    });
    expect(plan?.meal_plan_id).toBe('mp1');
    expect(plan?.days[0]?.meals[0]?.recipe_name).toBe('Chili');
    expect(plan?.shopping_list[0]?.name).toBe('beans');
  });

  it('parses generate draft with nested recipes', () => {
    const draft = parseMealPlanDraft({
      week_of: '2026-07-20',
      days: [
        {
          day: '2026-07-20',
          meals: [
            {
              slot: 'dinner',
              recipe: {
                name: 'Salmon bowls',
                servings: 2,
                ingredients: [{ name: 'salmon', qty: 300, unit: 'g' }],
                steps: ['Bake'],
                tags: ['fish'],
                reuse_recipe_id: null,
              },
            },
          ],
        },
      ],
      shopping_list: [],
      notes: 'easy nights',
      filtered_allergy: 1,
    });
    expect(draft?.days[0]?.meals[0]?.recipe.name).toBe('Salmon bowls');
    expect(draft?.notes).toBe('easy nights');
    expect(draft?.filtered_allergy).toBe(1);
  });

  it('weekOfMonday returns YYYY-MM-DD', () => {
    expect(weekOfMonday(new Date(2026, 6, 25))).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('shoppingListSummary counts unchecked', () => {
    expect(
      shoppingListSummary([
        { name: 'a', qty: '1', category: 'x', checked: false },
        { name: 'b', qty: '1', category: 'x', checked: true },
      ]),
    ).toMatch(/1 to get/);
  });
});

describe('meal-plans client soft-fail', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(null, { status: 404 })),
    );
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('listMealPlans → unavailable on 404', async () => {
    const r = await listMealPlans();
    expect(r.status).toBe('unavailable');
    expect(r.plans).toEqual([]);
  });

  it('generateMealPlan → unavailable on 404', async () => {
    const r = await generateMealPlan({ week_of: '2026-07-20' });
    expect(r.status).toBe('unavailable');
    if (r.status === 'unavailable') expect(r.message).toMatch(/aren't reachable/i);
  });

  it('probeRecipeDiscovery false on 404', async () => {
    expect(await probeRecipeDiscovery()).toBe(false);
  });
});
