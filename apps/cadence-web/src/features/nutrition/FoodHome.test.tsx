/**
 * The Food home is the permanent manage-nutrition surface (Food Journey 02/3D) — the fix for a
 * door that used to be gated on the thing it led to. What these pin:
 *   • one chart language in both states — counting (eaten, "no target yet", dashed) vs scored
 *     (left, "x of y kcal", denominators), with the earned countdown line while a goal waits;
 *   • doors are EARNED — This week / Shopping appear only once a week is planned; the Cookbook
 *     stays reachable, empty but labeled honestly;
 *   • confirm-first survives the move from the old sheet — a provisional meal confirms in one tap;
 *   • the coach hand-offs carry an app-authored note (log a meal / talk food with me).
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';

const useNutritionDay = vi.fn();
const invalidate = vi.fn();
vi.mock('../../lib/query/index.ts', () => ({
  useNutritionDay: (...a: unknown[]) => useNutritionDay(...a),
  useInvalidateNutritionDay: () => invalidate,
  localTodayIso: () => '2026-08-19',
}));

const api = vi.hoisted(() => ({
  getRecentMeals: vi.fn(async () => [] as unknown[]),
  getCurrentMealPlan: vi.fn(async (): Promise<{ status: string; plan: unknown }> => ({ status: 'empty', plan: null })),
  listRecipes: vi.fn(async () => ({ status: 'ok', recipes: [] as unknown[] })),
  patchMeal: vi.fn(async () => ({})),
}));
vi.mock('../../lib/api.ts', () => api);

// The deep tools have their own tests and their own fetches — stubs keep this about the home.
vi.mock('../food/RecipesPanel.tsx', () => ({ RecipesPanel: () => <div>cookbook-panel</div> }));
vi.mock('../food/MealPlansPanel.tsx', () => ({ MealPlansPanel: () => <div>plan-panel</div> }));
vi.mock('./ShopSheet.tsx', () => ({ ShopSheet: () => <div>shop-panel</div> }));
vi.mock('./WeekMenuSheet.tsx', () => ({ WeekMenuSheet: () => <div>week-panel</div> }));
vi.mock('./NutritionInsightCard.tsx', () => ({ NutritionInsightCard: () => null }));

const { FoodHome } = await import('./FoodHome.tsx');

const day = (over: Record<string, unknown>) => ({
  date: '2026-08-19',
  meals: [],
  totals: { kcal: 740, protein_g: 60, carbs_g: 80, fat_g: 18 },
  provisional_totals: {},
  confirmed_count: 2,
  provisional_count: 0,
  targets: null,
  left: null,
  burn_kcal: 0,
  eatback_kcal: 0,
  eatback_pct: 50,
  targets_wait: null,
  has_recent_food: true,
  ...over,
});

const refetch = vi.fn();
function mount(d: Record<string, unknown> | null, props: Record<string, unknown> = {}) {
  useNutritionDay.mockReturnValue({ data: d, refetch });
  return render(<FoodHome onBack={() => {}} onCoach={() => {}} {...props} />);
}

beforeEach(() => {
  vi.clearAllMocks();
  api.getCurrentMealPlan.mockResolvedValue({ status: 'empty', plan: null });
  api.listRecipes.mockResolvedValue({ status: 'ok', recipes: [] });
  api.getRecentMeals.mockResolvedValue([]);
});
afterEach(cleanup);

describe('FoodHome', () => {
  it('counts without a target: eaten kcal, "no target yet", bare-gram bars', () => {
    mount(day({}));
    expect(screen.getByText('740')).toBeTruthy();
    expect(screen.getByText('KCAL EATEN')).toBeTruthy();
    expect(screen.getByText('no target yet')).toBeTruthy();
    expect(screen.getByText('60 g')).toBeTruthy(); // protein, no denominator
  });

  it('scores once targets exist: kcal left, "x of y kcal", denominators', () => {
    mount(
      day({
        totals: { kcal: 1240, protein_g: 88, carbs_g: 148, fat_g: 44 },
        targets: { kcal: 1940, protein_g: 150, carbs_g: 195, fat_g: 65 },
        left: { kcal: 700 },
      }),
    );
    expect(screen.getByText('700')).toBeTruthy();
    expect(screen.getByText('KCAL LEFT')).toBeTruthy();
    expect(screen.getByText('1,240 of 1,940 kcal')).toBeTruthy();
    expect(screen.getByText('88 / 150 g')).toBeTruthy();
  });

  it('shows the earned-target countdown while a goal is still waiting', () => {
    mount(day({ targets_wait: { days_logged: 3, days_needed: 7 } }));
    expect(screen.getByText(/3 \/ 7 · days to your calorie target/)).toBeTruthy();
  });

  it('suppresses This week and Shopping until a week is planned; the Cookbook stays, honestly empty', async () => {
    mount(day({}));
    await waitFor(() => expect(screen.getByText('Cookbook · nothing saved yet')).toBeTruthy());
    expect(screen.queryByText('This week')).toBeNull();
    expect(screen.queryByText('Shopping')).toBeNull();
  });

  it('grows the standing doors once a week exists', async () => {
    api.getCurrentMealPlan.mockResolvedValue({ status: 'ok', plan: { meal_plan_id: 'mp1' } });
    mount(day({}));
    await waitFor(() => expect(screen.getByText('This week')).toBeTruthy());
    expect(screen.getByText('Shopping')).toBeTruthy();
    expect(screen.getByText('Cookbook')).toBeTruthy();
  });

  it('confirms a provisional meal in one tap (nothing counts until they say so)', async () => {
    mount(
      day({
        meals: [
          {
            log_id: 'm1',
            date: '2026-08-19',
            meal: 'lunch',
            items: [{ name: 'burrito' }],
            macros: { kcal: 420 },
            provisional: true,
          },
        ],
      }),
    );
    // The confirm names the meal — a day can hold more than one provisional row.
    fireEvent.click(screen.getByLabelText('Confirm the estimate for burrito'));
    await waitFor(() => expect(api.patchMeal).toHaveBeenCalledWith('m1', { confirm: true }));
    expect(invalidate).toHaveBeenCalled();
  });

  it('hands the coach an app-authored note from "Talk food with me" and from a Log chip', () => {
    const onCoach = vi.fn();
    mount(day({}), { onCoach });
    fireEvent.click(screen.getByText('Talk food with me'));
    expect(onCoach).toHaveBeenCalledWith(expect.stringContaining('Talk food with me'));

    fireEvent.click(screen.getAllByText('Log')[0]!); // breakfast slot is empty → a Log chip
    expect(onCoach).toHaveBeenCalledWith(expect.stringContaining('Log on breakfast'));
  });

  it('opens straight to the shopping list when a shop task sent it there', () => {
    mount(day({}), { initialSub: 'shop' });
    expect(screen.getByText('shop-panel')).toBeTruthy();
  });
});
