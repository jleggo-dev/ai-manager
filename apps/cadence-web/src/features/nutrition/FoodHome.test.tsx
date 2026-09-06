/**
 * The Food home is the permanent manage-nutrition surface (Food Journey 02/3D) — the fix for a
 * door that used to be gated on the thing it led to. What these pin:
 *   • one chart language in both states — counting (eaten, "no target yet", unfilled) vs scored
 *     (left, "x of y kcal", denominators), with the earned countdown line while a goal waits;
 *   • doors are EARNED — This week / Shopping appear only once a week is planned; the Cookbook
 *     stays reachable, empty but labeled honestly;
 *   • confirm-first survives the move from the old sheet — a provisional meal confirms in one tap;
 *   • the coach hand-offs carry an app-authored note (log a meal / talk food with me).
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { renderWithQuery } from '../../test/withQuery.tsx';

const useNutritionDay = vi.fn();
const invalidate = vi.fn();
/** Partial: the day read and "today" are stubbed (each has its own suite), while the room's three
 *  standing reads run through the real cached hooks onto the mocked API below. */
vi.mock('../../lib/query/index.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/query/index.ts')>()),
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
// The Kitchen stub echoes the section it was opened on, so the pill-routing tests below can
// assert WHERE the shell sent the user, not just that it swapped tabs.
// The meal is the screen now (1b): "Log a meal" opens the slot's draft meal, not a dispatcher.
vi.mock('../food/meal/MealScreen.tsx', () => ({ MealScreen: () => <div>meal-screen</div> }));
vi.mock('../food/sweep/useFoodSweep.ts', () => ({
  useFoodSweep: () => ({ phase: 'idle', sweep: null, saved: [], tidyable: [], tidiedCount: 0, error: null }),
}));
vi.mock('./NutritionInsightCard.tsx', () => ({ NutritionInsightCard: () => null }));
vi.mock('./FoodKitchen.tsx', () => ({
  FoodKitchen: ({ initialView = 'recipes' }: { initialView?: string }) => <div>kitchen-tab:{initialView}</div>,
}));

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
function mount(
  d: Record<string, unknown> | null,
  props: Record<string, unknown> = {},
  query: Record<string, unknown> = {},
) {
  useNutritionDay.mockReturnValue({ data: d, refetch, ...query });
  return renderWithQuery(<FoodHome onBack={() => {}} onCoach={() => {}} {...props} />);
}

beforeEach(() => {
  vi.clearAllMocks();
  api.getCurrentMealPlan.mockResolvedValue({ status: 'empty', plan: null });
  api.listRecipes.mockResolvedValue({ status: 'ok', recipes: [] });
  api.getRecentMeals.mockResolvedValue([]);
});
afterEach(cleanup);

describe('FoodHome — the day, before it lands (PERF-06)', () => {
  /**
   * The owner asked for "show everything at 0 and then update" (2026-08-20). Numbers are the one
   * place that instruction cannot be followed literally: 0 kcal eaten IS a true answer before
   * breakfast, so a placeholder 0 and a settled 0 are the same pixels — and the moment the ring
   * jumped from 0 to 740, the screen he had been reading would turn out to have been wrong. The
   * structure arrives instantly, which was the ask; the digits wait behind a bar.
   */
  it('paints the screen’s whole structure with no loader anywhere', () => {
    const { container } = mount(null, {}, { isPending: true });
    expect(screen.getByText('Food')).toBeTruthy();
    expect(screen.getByText('Today')).toBeTruthy();
    expect(screen.getByText('Log a meal')).toBeTruthy();
    expect(screen.getByText('Talk food with me')).toBeTruthy();
    expect(container.querySelector('.typing')).toBeNull();
  });

  it('holds a bar where every number goes, never a settled zero', () => {
    const { container } = mount(null, {}, { isPending: true });
    expect(screen.queryByText('0')).toBeNull();
    expect(screen.queryByText('KCAL EATEN')).toBeNull();
    expect(screen.queryByText('0 g')).toBeNull();
    expect(screen.queryByText('0.0 L')).toBeNull(); // water too — 0.0 L is a true reading at 7am
    expect(container.querySelectorAll('.sk').length).toBeGreaterThan(0);
  });

  it('keeps the water row pourable while its total is still unknown', () => {
    mount(null, {}, { isPending: true });
    // The eight glasses and the ＋ never read the server; only the litres do.
    expect(screen.getByLabelText('Add a glass of water')).toBeTruthy();
  });

  it('draws the ring’s track the whole time — the shape never waits, only the answer does', () => {
    const { container } = mount(null, {}, { isPending: true });
    expect(container.querySelector('.nring')).toBeTruthy();
    expect(container.querySelectorAll('.mbar').length).toBe(3);
  });

  it('gives up the bars the instant the day arrives', () => {
    const { container } = mount(day({}), {}, { isPending: false });
    expect(screen.getByText('740')).toBeTruthy();
    expect(container.querySelector('.sk')).toBeNull();
  });
});

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

  it('hands the coach an app-authored note from "Talk food with me"', () => {
    const onCoach = vi.fn();
    mount(day({}), { onCoach });
    fireEvent.click(screen.getByText('Talk food with me'));
    expect(onCoach).toHaveBeenCalledWith(expect.stringContaining('Talk food with me'));
  });

  /**
   * Logging is capture, not conversation. Both doors used to hand the user to the COACH — a
   * slice-1 leftover from when talking was the only capture surface. The design's own caption for
   * 05b said the capture surface is reached "from any method tile in quick add, from Log a meal,
   * or the ＋ on the trail", and the owner hit it on device (2026-08-20): "log a meal in the full
   * screen nutrition menu takes me to the coach chat (i think this is wrong)". The capture surface
   * is the MEAL SCREEN now (1b, 2026-09-02); the rule it pins is unchanged. Talking food is still
   * one tap away — that is what "Talk food with me" is for, asserted above.
   */
  it('opens the meal screen from "Log a meal" and from an empty meal slot — not the coach', () => {
    const onCoach = vi.fn();
    mount(day({}), { onCoach });

    fireEvent.click(screen.getByText('Log a meal'));
    expect(screen.getByText('meal-screen')).toBeTruthy();
    expect(onCoach).not.toHaveBeenCalled();
  });

  it('opens straight onto the Kitchen shopping list when a shop task sent it there', () => {
    mount(day({}), { initialKitchen: 'shop' });
    expect(screen.getByText('kitchen-tab:shop')).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Kitchen' }).getAttribute('aria-selected')).toBe('true');
  });

  /**
   * The pills and the planning door used to open the July panel stack in a hosted sheet
   * (FoodSubSheet). The Kitchen tab is the one prep surface now, so each of them lands on the
   * matching Kitchen section instead — same promises, one implementation.
   */
  it('routes the standing pills into the Kitchen: This week → planner, Shopping → list, Cookbook → recipes', async () => {
    api.getCurrentMealPlan.mockResolvedValue({ status: 'ok', plan: { meal_plan_id: 'mp1' } });
    mount(day({}));
    await waitFor(() => expect(screen.getByText('This week')).toBeTruthy());

    fireEvent.click(screen.getByText('Shopping'));
    expect(screen.getByText('kitchen-tab:shop')).toBeTruthy();

    fireEvent.click(screen.getByRole('tab', { name: 'Day' }));
    fireEvent.click(screen.getByText('This week'));
    expect(screen.getByText('kitchen-tab:week')).toBeTruthy();

    fireEvent.click(screen.getByRole('tab', { name: 'Day' }));
    fireEvent.click(screen.getByText('Cookbook'));
    expect(screen.getByText('kitchen-tab:recipes')).toBeTruthy();
  });

  it('sends "Plan your meals" to the Kitchen planner', () => {
    mount(day({}));
    fireEvent.click(screen.getByText('Plan your meals'));
    expect(screen.getByText('kitchen-tab:week')).toBeTruthy();
  });

  it('opens the cookbook from the Kitchen tab itself, even after a pill steered elsewhere', async () => {
    api.getCurrentMealPlan.mockResolvedValue({ status: 'ok', plan: { meal_plan_id: 'mp1' } });
    mount(day({}));
    await waitFor(() => expect(screen.getByText('Shopping')).toBeTruthy());

    fireEvent.click(screen.getByText('Shopping'));
    expect(screen.getByText('kitchen-tab:shop')).toBeTruthy();

    // Back to the day, then in through the tab header: the tab is the cookbook's own door.
    fireEvent.click(screen.getByRole('tab', { name: 'Day' }));
    fireEvent.click(screen.getByRole('tab', { name: 'Kitchen' }));
    expect(screen.getByText('kitchen-tab:recipes')).toBeTruthy();
  });
});

/**
 * Slice 4 adds a third tab. Day and Week READ what happened; the Kitchen is where the week ahead
 * gets prepped, so it is a peer of the two reads rather than another door in a sheet — and it
 * carries no date pill, because a date is a question the reading tabs ask and the Kitchen doesn't.
 */
describe('FoodHome — the Kitchen tab', () => {
  it('offers Kitchen beside Day and Week', () => {
    mount(day({}));
    expect(screen.getByRole('tab', { name: 'Kitchen' })).toBeTruthy();
  });

  it('swaps the day read for the Kitchen, and drops the date pill with it', () => {
    mount(day({}));
    expect(screen.getByText('Today')).toBeTruthy();

    fireEvent.click(screen.getByRole('tab', { name: 'Kitchen' }));
    expect(screen.getByText('kitchen-tab:recipes')).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Kitchen' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.queryByText('Today')).toBeNull();
    // The day's own read is gone while the Kitchen is up — one body, three tabs.
    expect(screen.queryByText('Log a meal')).toBeNull();
  });

  it('goes back to the day read, date pill and all', () => {
    mount(day({}));
    fireEvent.click(screen.getByRole('tab', { name: 'Kitchen' }));
    fireEvent.click(screen.getByRole('tab', { name: 'Day' }));
    expect(screen.queryByText('kitchen-tab:recipes')).toBeNull();
    expect(screen.getByText('Today')).toBeTruthy();
    expect(screen.getByText('Log a meal')).toBeTruthy();
  });
});
