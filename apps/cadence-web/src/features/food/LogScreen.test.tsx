/**
 * The full-screen Log (design 05b) — the capture that needs no trail task. What these pin:
 *   • six ways in on one screen: search first, then chat / voice / picture / barcode, then quick
 *     add with PLANNED before RECENTLY EATEN, and water last because it is a tap, not a meal;
 *   • quick add is slot-aware and counted — "logged 14 times" comes from the slot, not the day;
 *   • Voice is not a second interface: it opens the chat screen with the mic already listening;
 *   • something that lands is asked where it should sit, and it is counted either way.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import type { FoodDetailResult, MealPlanDetailResult } from '../../lib/api.ts';

const invalidate = vi.fn();
const useNutritionDay = vi.fn();
vi.mock('../../lib/query/index.ts', () => ({
  useNutritionDay: (...a: unknown[]) => useNutritionDay(...a),
  useInvalidateNutritionDay: () => invalidate,
  localTodayIso: () => '2026-08-20',
}));

const api = vi.hoisted(() => ({
  getFoodRecents: vi.fn(async () => ({
    status: 'ok',
    foods: [{ food_id: 'f9', name: 'Whey protein', serving_label: '1 scoop' }],
  })),
  getUsualAtSlot: vi.fn(async () => [
    { kind: 'food', id: 'f1', name: 'Skyr, plain', serving_label: '2/3 cup', kcal: 108, count: 14 },
  ]),
  searchFoods: vi.fn(async () => ({ status: 'ok', foods: [{ food_id: 'f2', name: 'Whole grain oats' }] })),
  // Widened return types: several tests below override these with a differently-shaped `ok` result
  // (a real plan / a real food), which a bare inferred default return type would reject.
  getCurrentMealPlan: vi.fn(async (): Promise<MealPlanDetailResult> => ({ status: 'not_found', plan: null })),
  getFoodById: vi.fn(async (): Promise<FoodDetailResult> => ({ status: 'not_found', food: null })),
  getRecipeById: vi.fn(),
  logMeal: vi.fn(),
  logMealFromFood: vi.fn(),
  logMealFromRecipe: vi.fn(async () => ({
    log_id: 'new',
    meal: 'lunch',
    items: [{ name: 'Chicken orzo' }],
    macros: { kcal: 520 },
  })),
  logPlannedMealItems: vi.fn(),
  logWater: vi.fn(async () => 1250),
  patchMeal: vi.fn(async () => ({})),
  recipeMacroHint: () => '',
}));
vi.mock('../../lib/api.ts', () => api);

// The scanner opens a camera; the chat screen has its own test surface. Stubs keep this about 05b.
vi.mock('./FoodBarcodePanel.tsx', () => ({ FoodBarcodePanel: () => <div>barcode-panel</div> }));
vi.mock('./LogByChat.tsx', () => ({
  LogByChat: ({ listening }: { listening: boolean }) => <div>chat-screen listening:{String(listening)}</div>,
}));
vi.mock('./DrinkComposer.tsx', () => ({ DrinkComposer: () => <div>drink-composer</div> }));

const { LogScreen } = await import('./LogScreen.tsx');

const day = (meals: unknown[] = []) => ({
  date: '2026-08-20',
  meals,
  totals: {},
  provisional_totals: {},
  confirmed_count: 0,
  provisional_count: 0,
  targets: null,
  left: null,
  burn_kcal: 0,
  eatback_kcal: 0,
  eatback_pct: 0,
  water_ml: 900,
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('LogScreen', () => {
  it('opens with no occurrence and offers every way in', async () => {
    useNutritionDay.mockReturnValue({ data: day() });
    render(<LogScreen date="2026-08-20" initialMeal="lunch" onClose={() => {}} />);

    expect(screen.getByPlaceholderText('Search foods, brands, your meals…')).toBeInTheDocument();
    for (const label of ['Chat', 'Voice', 'Picture', 'Barcode']) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    // Water is last and is a tap, not a meal.
    expect(screen.getByText('0.9 L today')).toBeInTheDocument();
  });

  it('shows what they usually have at THIS slot, counted', async () => {
    useNutritionDay.mockReturnValue({ data: day() });
    render(<LogScreen date="2026-08-20" initialMeal="lunch" onClose={() => {}} />);

    await waitFor(() => expect(screen.getByText('Skyr, plain')).toBeInTheDocument());
    expect(api.getUsualAtSlot).toHaveBeenCalledWith('lunch', 6);
    expect(screen.getByText('2/3 cup · logged 14 times')).toBeInTheDocument();
    expect(screen.getByText('108 kcal')).toBeInTheDocument();
  });

  it('opens the chat screen already listening when Voice is tapped', () => {
    useNutritionDay.mockReturnValue({ data: day() });
    render(<LogScreen date="2026-08-20" initialMeal="lunch" onClose={() => {}} />);

    fireEvent.click(screen.getByText('Voice').closest('button')!);
    expect(screen.getByText(/chat-screen listening:true/)).toBeInTheDocument();
  });

  it('searches the list first, and the search replaces the tiles', async () => {
    useNutritionDay.mockReturnValue({ data: day() });
    render(<LogScreen date="2026-08-20" initialMeal="lunch" onClose={() => {}} />);

    fireEvent.change(screen.getByPlaceholderText('Search foods, brands, your meals…'), { target: { value: 'oats' } });
    await waitFor(() => expect(screen.getByText('Whole grain oats')).toBeInTheDocument());
    expect(screen.queryByText('Barcode')).not.toBeInTheDocument();
  });

  it('has a door to the drink composer — a drink of several things is one meal', () => {
    useNutritionDay.mockReturnValue({ data: day() });
    render(<LogScreen date="2026-08-20" initialMeal="lunch" onClose={() => {}} />);

    fireEvent.click(screen.getByText('Several things in one drink? ›'));
    expect(screen.getByText('drink-composer')).toBeInTheDocument();
  });

  it('pours a glass of water without a confirm card', async () => {
    useNutritionDay.mockReturnValue({ data: day() });
    render(<LogScreen date="2026-08-20" initialMeal="lunch" onClose={() => {}} />);

    fireEvent.click(screen.getByText('0.9 L today').closest('button')!);
    await waitFor(() => expect(api.logWater).toHaveBeenCalledWith(250));
    expect(screen.getByText('1.3 L today')).toBeInTheDocument();
  });
});

/**
 * A choice already made must not be asked for twice. The quick-add sheet's tiles set only "open the
 * Log screen" and dropped WHICH tile was tapped, so Chat landed on the Log home — the same five
 * tiles again — and the owner had to pick Chat a second time (device, 2026-08-20).
 */
describe('a method chosen before this screen opened', () => {
  it('opens straight into chat, not the tile row', () => {
    render(<LogScreen date="2026-08-20" initialMeal="breakfast" initialMethod="chat" onClose={() => {}} />);
    expect(screen.getByText(/chat-screen listening:false/)).toBeInTheDocument();
  });

  it('voice opens the SAME chat screen already listening — one screen, not two', () => {
    render(<LogScreen date="2026-08-20" initialMeal="breakfast" initialMethod="voice" onClose={() => {}} />);
    expect(screen.getByText(/chat-screen listening:true/)).toBeInTheDocument();
  });

  it('opens the tile row when no method was chosen — "Log a meal" and the ＋', () => {
    render(<LogScreen date="2026-08-20" initialMeal="breakfast" onClose={() => {}} />);
    expect(screen.getByText('Chat')).toBeInTheDocument();
  });
});

/**
 * MP19/MP24 — the planned-meal quick-add row, in both shapes it can carry. A legacy single recipe
 * used to log one silent serving on tap (MP24); a composed meal (frame 10a) never appeared here at
 * all (MP19), because `usePlannedMeal` only ever looked for `recipe_id`.
 */
describe('quick add — the planned-for-this-slot row', () => {
  it('opens the portion confirm for a legacy planned recipe — never a silent one-serving log', async () => {
    useNutritionDay.mockReturnValue({ data: day() });
    api.getCurrentMealPlan.mockResolvedValue({
      status: 'ok',
      plan: {
        meal_plan_id: 'mp1',
        week_of: '2026-08-17',
        shopping_list: [],
        days: [{ day: '2026-08-20', meals: [{ slot: 'lunch', recipe_id: 'r1', recipe_name: 'Beef chili' }] }],
      },
    });
    api.getRecipeById.mockResolvedValue({
      status: 'ok',
      recipe: {
        recipe_id: 'r1',
        name: 'Beef chili',
        source: 'user',
        servings: 6,
        ingredients: [],
        steps: [],
        macros_per_serving: { kcal: 320 },
        tags: [],
        saved: true,
      },
    });

    render(<LogScreen date="2026-08-20" initialMeal="lunch" onClose={() => {}} />);

    const row = await screen.findByText('Beef chili');
    fireEvent.click(row.closest('button')!);

    await waitFor(() => expect(screen.getByText(/Log Beef chili\?/i)).toBeInTheDocument());
    expect(api.logMealFromRecipe).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Servings')).toHaveValue(1);
  });

  it('logs a composed planned meal directly — items fan out, no confirm needed', async () => {
    useNutritionDay.mockReturnValue({ data: day() });
    api.getCurrentMealPlan.mockResolvedValue({
      status: 'ok',
      plan: {
        meal_plan_id: 'mp2',
        week_of: '2026-08-17',
        shopping_list: [],
        days: [
          {
            day: '2026-08-20',
            meals: [
              {
                slot: 'lunch',
                name: 'Salad night',
                items: [{ kind: 'food', id: 'f1', name: 'Big salad', qty: 1, unit: 'bowl' }],
              },
            ],
          },
        ],
      },
    });
    api.logPlannedMealItems.mockResolvedValue(true);
    const onClose = vi.fn();

    render(<LogScreen date="2026-08-20" initialMeal="lunch" onClose={onClose} />);

    const row = await screen.findByText('Salad night');
    fireEvent.click(row.closest('button')!);

    await waitFor(() =>
      expect(api.logPlannedMealItems).toHaveBeenCalledWith(
        [{ kind: 'food', id: 'f1', name: 'Big salad', qty: 1, unit: 'bowl' }],
        'lunch',
      ),
    );
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(api.getRecipeById).not.toHaveBeenCalled();
  });
});
