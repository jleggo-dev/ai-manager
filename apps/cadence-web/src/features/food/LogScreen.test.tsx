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
    foods: [
      { food_id: 'f9', name: 'Starbucks latte', serving_label: 'venti', kcal: 250, count: 2 },
      // No calories on this one — its ＋ has nothing to promise, so it must open the sheet.
      { food_id: 'f8', name: 'Whey protein', serving_label: '1 scoop', kcal: null, count: 1 },
      ...Array.from({ length: 5 }, (_, i) => ({
        food_id: `r${i}`,
        name: `Leftover ${i}`,
        serving_label: '1 serving',
        kcal: 100,
        count: 1,
      })),
    ],
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

  /* RECENTLY EATEN is the answer to "what if I had a second latte?" (owner, on device,
     2026-08-20). These pin the three things design 05b asks of it: the ＋ adds in ONE tap at the
     amount already on the row, the row itself still opens the amount sheet, and the head carries
     "See all ›" once there is more than a preview's worth. */
  it('re-logs a recent food in one tap, at the amount the row names', async () => {
    useNutritionDay.mockReturnValue({ data: day() });
    render(<LogScreen date="2026-08-20" initialMeal="breakfast" onClose={() => {}} />);

    await waitFor(() => expect(screen.getByText('Starbucks latte')).toBeInTheDocument());
    // The row says what one tap will add, which is what makes adding it without a card honest.
    expect(screen.getByText('venti · logged 2 times')).toBeInTheDocument();
    expect(screen.getByText('250 kcal')).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText('Add Starbucks latte, 250 kcal'));

    // No serving_index/quantity: the food's own default IS the portion that was logged, so this
    // re-logs the same latte without a second estimate.
    await waitFor(() => expect(api.logMealFromFood).toHaveBeenCalledWith({ food_id: 'f9', meal: 'breakfast' }));
    expect(api.getFoodById).not.toHaveBeenCalled();
  });

  it('still opens the amount sheet from the row itself', async () => {
    useNutritionDay.mockReturnValue({ data: day() });
    render(<LogScreen date="2026-08-20" initialMeal="breakfast" onClose={() => {}} />);

    await waitFor(() => expect(screen.getByText('Starbucks latte')).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText('Starbucks latte — change the amount'));

    await waitFor(() => expect(api.getFoodById).toHaveBeenCalledWith('f9'));
    expect(api.logMealFromFood).not.toHaveBeenCalled();
  });

  it('will not one-tap a food that cannot say what it would add', async () => {
    useNutritionDay.mockReturnValue({ data: day() });
    render(<LogScreen date="2026-08-20" initialMeal="breakfast" onClose={() => {}} />);

    await waitFor(() => expect(screen.getByText('Whey protein')).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText('Add Whey protein'));

    await waitFor(() => expect(api.getFoodById).toHaveBeenCalledWith('f8'));
    expect(api.logMealFromFood).not.toHaveBeenCalled();
  });

  it('offers "See all ›" once there is more recently eaten than fits', async () => {
    useNutritionDay.mockReturnValue({ data: day() });
    render(<LogScreen date="2026-08-20" initialMeal="breakfast" onClose={() => {}} />);

    await waitFor(() => expect(screen.getByText('RECENTLY EATEN')).toBeInTheDocument());
    expect(screen.queryByText('Leftover 4')).not.toBeInTheDocument();

    fireEvent.click(screen.getByText('See all ›'));
    expect(screen.getByText('Leftover 4')).toBeInTheDocument();
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
