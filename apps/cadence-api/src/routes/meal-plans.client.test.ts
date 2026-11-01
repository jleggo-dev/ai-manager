/**
 * The Kitchen's week writes against the REAL /nutrition/meal-plans routes — both sides at once (the
 * shape and the reason: src/test/client-route.ts). Written 2026-11-01 for two live disagreements:
 *
 * - The client read every 404 as "meal plans aren't reachable", but the routes also answer 404 for
 *   an ordinary missing row. Clearing a week that was already gone kept it on screen with those
 *   words; a meal pointing at a deleted recipe got them too.
 * - PATCH caught "recipe not found" only, so a meal pointing at a deleted FOOD came back a 500.
 *
 * Faked: the meal-plan service and the trail sync behind the routes.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import { serveRoutesToWebClient, type ClientAgainstRoutes } from '../test/client-route.ts';

const RECIPE = '11111111-1111-4111-8111-111111111111';
const WEEK = {
  meal_plan_id: 'mp1',
  week_of: '2026-11-02',
  days: [{ day: '2026-11-02', meals: [{ slot: 'dinner', recipe_id: RECIPE }] }],
  shopping_list: [],
  notes: null,
};
const kitchen: { weekExists: boolean; missingRecipe: boolean; missingFood: boolean } = {
  weekExists: true,
  missingRecipe: false,
  missingFood: false,
};
/** The service's own ownership check, as services/meal-plan.ts throws it. */
function checkItems() {
  if (kitchen.missingRecipe) throw new Error('recipe not found: r9');
  if (kitchen.missingFood) throw new Error('food not found: f9');
}

vi.mock('../auth/middleware.ts', () => ({
  requireCadenceUser: (req: { cadenceUserId?: string }, _res: unknown, next: () => void) => {
    req.cadenceUserId = 'u1';
    next();
  },
}));
vi.mock('../services/meal-plan.ts', () => ({
  confirmMealPlan: async () => {
    checkItems();
    return WEEK;
  },
  generateMealPlan: async () => null,
  getMealPlanForUser: async () => (kitchen.weekExists ? WEEK : null),
  getMealPlanForWeek: async () => (kitchen.weekExists ? WEEK : null),
  listMealPlansForUser: async () => [],
  patchMealPlanForUser: async () => {
    checkItems();
    return kitchen.weekExists ? WEEK : null;
  },
  removeMealPlan: async () => kitchen.weekExists,
}));
vi.mock('../services/menu-tasks.ts', () => ({ syncMenuTasks: async () => {} }));

type Failure = { status: string; message: string };
interface WebMealPlansApi {
  deleteMealPlan(id: string): Promise<{ status: 'ok' } | Failure>;
  patchMealPlan(id: string, patch: { days?: unknown[] }): Promise<{ status: 'ok' } | Failure>;
  saveMealPlan(draft: unknown): Promise<{ status: 'ok' } | Failure>;
}

const DRAFT = {
  week_of: '2026-11-02',
  days: [
    {
      day: '2026-11-02',
      meals: [
        {
          slot: 'dinner',
          recipe: {
            name: 'Dal',
            servings: 2,
            ingredients: [{ name: 'lentils', qty: 200, unit: 'g' }],
            steps: [],
            tags: [],
            reuse_recipe_id: RECIPE,
          },
        },
      ],
    },
  ],
  shopping_list: [],
  notes: null,
};

const { default: mealPlanRoutes } = await import('./meal-plans.ts');
let served: ClientAgainstRoutes<WebMealPlansApi>;
let web: WebMealPlansApi;

beforeAll(async () => {
  served = await serveRoutesToWebClient<WebMealPlansApi>('meal-plans.ts', (app) => {
    app.use('/nutrition/meal-plans', mealPlanRoutes);
  });
  web = served.web;
});
afterAll(() => served.close());

beforeEach(() => {
  kitchen.weekExists = true;
  kitchen.missingRecipe = false;
  kitchen.missingFood = false;
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('clearing a week (useKitchen.commitDays with no days left) against DELETE /nutrition/meal-plans/:id', () => {
  it('a week that is there clears', async () => {
    expect(await web.deleteMealPlan('mp1')).toEqual({ status: 'ok' });
  });

  it('a week that is already gone reads as cleared — it used to say meal plans were unreachable', async () => {
    kitchen.weekExists = false;
    expect(await web.deleteMealPlan('mp1')).toEqual({ status: 'ok' });
  });
});

describe('changing a week (useKitchen.commitDays) against PATCH /nutrition/meal-plans/:id', () => {
  const days = [{ day: '2026-11-02', meals: [{ slot: 'dinner', recipe_id: RECIPE }] }];

  it('a meal pointing at a deleted recipe says the recipe is gone', async () => {
    kitchen.missingRecipe = true;
    const r = await web.patchMealPlan('mp1', { days });
    expect(r.status).toBe('error');
    expect((r as Failure).message).toMatch(/recipes isn't in your cookbook any more/);
  });

  it('a meal pointing at a deleted food says the food is gone — the route used to answer 500', async () => {
    kitchen.missingFood = true;
    const r = await web.patchMealPlan('mp1', { days });
    expect(r.status).toBe('error');
    expect((r as Failure).message).toMatch(/foods isn't saved any more/);
  });

  it('a week cleared somewhere else reads as gone, not unreachable', async () => {
    kitchen.weekExists = false;
    const r = await web.patchMealPlan('mp1', { days });
    expect(r.status).toBe('gone');
    expect((r as Failure).message).not.toMatch(/reachable/);
  });
});

describe('starting a week (useKitchen.commitDays, first save) against POST /nutrition/meal-plans', () => {
  it('a draft reusing a deleted recipe says the recipe is gone', async () => {
    kitchen.missingRecipe = true;
    const r = await web.saveMealPlan(DRAFT);
    expect(r.status).toBe('error');
    expect((r as Failure).message).toMatch(/recipes isn't in your cookbook any more/);
  });
});
