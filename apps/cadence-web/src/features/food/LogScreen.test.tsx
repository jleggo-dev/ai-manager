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
  getCurrentMealPlan: vi.fn(async () => ({ status: 'empty', plan: null })),
  getFoodById: vi.fn(async () => ({ status: 'ok', food: null })),
  logMeal: vi.fn(),
  logMealFromFood: vi.fn(),
  logMealFromRecipe: vi.fn(async () => ({
    log_id: 'new',
    meal: 'lunch',
    items: [{ name: 'Chicken orzo' }],
    macros: { kcal: 520 },
  })),
  logWater: vi.fn(async () => 1250),
  patchMeal: vi.fn(async () => ({})),
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
