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

  /**
   * MP18 — the server persists a composed meal (frame 10a: "recipes, food, or both") as
   * `{ slot, name, items }` with NO `recipe_id`. The old parser hard-required `recipe_id`, so this
   * exact shape came back from a GET as if the day had nothing planned — failed on the prior code.
   */
  it('reads a composed meal back — the round trip MP18 was dropping', () => {
    const plan = parseMealPlan({
      meal_plan_id: 'mp2',
      week_of: '2026-08-24',
      days: [
        {
          day: '2026-08-26',
          meals: [
            {
              slot: 'dinner',
              name: 'Thighs, orzo & a side salad',
              items: [
                { kind: 'recipe', id: 'r2', name: 'Chicken thighs & lemon orzo', qty: 1, unit: 'serving', kcal: 520 },
                { kind: 'food', id: 'f1', name: 'Rocket & tomato salad', qty: 120, unit: 'g', kcal: 35 },
              ],
            },
          ],
        },
      ],
      shopping_list: [],
    });
    const meal = plan?.days[0]?.meals[0];
    expect(meal?.name).toBe('Thighs, orzo & a side salad');
    expect(meal?.items).toHaveLength(2);
    expect(meal?.items?.[0]).toMatchObject({ kind: 'recipe', id: 'r2', name: 'Chicken thighs & lemon orzo', qty: 1 });
    expect(meal?.recipe_id).toBeUndefined();
  });

  /** A week can mix a legacy single-recipe day with a composed one — neither shape drops the other. */
  it('keeps the legacy single-recipe shape working alongside a composed meal', () => {
    const plan = parseMealPlan({
      meal_plan_id: 'mp3',
      week_of: '2026-08-24',
      days: [
        { day: '2026-08-24', meals: [{ slot: 'lunch', recipe_id: 'r1', recipe_name: 'Beef chili' }] },
        {
          day: '2026-08-26',
          meals: [{ slot: 'dinner', items: [{ kind: 'food', id: 'f2', name: 'Olive oil', qty: 1, unit: 'tbsp' }] }],
        },
      ],
      shopping_list: [],
    });
    expect(plan?.days[0]?.meals[0]).toMatchObject({ recipe_id: 'r1', recipe_name: 'Beef chili' });
    expect(plan?.days[1]?.meals[0]?.items?.[0]).toMatchObject({ id: 'f2', name: 'Olive oil' });
  });

  /** A meal with neither a recipe_id nor any item is not a plan — nothing to silently keep. */
  it('drops a meal that has neither a recipe_id nor items', () => {
    const plan = parseMealPlan({
      meal_plan_id: 'mp4',
      week_of: '2026-08-24',
      days: [{ day: '2026-08-24', meals: [{ slot: 'snack' }] }],
      shopping_list: [],
    });
    expect(plan?.days[0]?.meals ?? []).toHaveLength(0);
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
