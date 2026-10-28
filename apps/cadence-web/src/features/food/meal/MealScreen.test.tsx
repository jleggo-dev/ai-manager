/**
 * The quick log (2026-10-28), driven end to end with the data layer mocked at the module
 * boundary: which shelf opens, what the tiles say, the tap grammar (tap = +1, tap again = ×2,
 * hold = amount), the chips and their ×, the one button and its gate, the title as the picker,
 * the face as the one door to the coach, and the cart ruling (a logged meal takes adds).
 *
 * Every tap-to-outcome here is a router — a tile deciding which append runs, a chip deciding
 * which row goes — so each gets its row, with the near-miss beside it.
 */
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { renderWithQuery } from '../../../test/withQuery.tsx';
import type { Meal } from '../../../lib/api/meal-draft.ts';
import { HOLD_MS } from './useShelfGestures.ts';

const openMealDraft = vi.fn();
const getOpenMeal = vi.fn();
const appendFood = vi.fn();
const appendRecipe = vi.fn();
const appendParsed = vi.fn();
const removeDraftItem = vi.fn();
const setDraftAmount = vi.fn();
const setDraftMeal = vi.fn();
const closeMeal = vi.fn();
const editMealParts = vi.fn();
const tickHaptic = vi.fn();
vi.mock('../../../lib/haptics.ts', () => ({ tickHaptic: () => tickHaptic() }));

vi.mock('../../../lib/api/meal-draft.ts', () => ({
  openMealDraft: (...a: unknown[]) => openMealDraft(...a),
  getOpenMeal: (...a: unknown[]) => getOpenMeal(...a),
  appendFood: (...a: unknown[]) => appendFood(...a),
  appendRecipe: (...a: unknown[]) => appendRecipe(...a),
  appendParsed: (...a: unknown[]) => appendParsed(...a),
  removeDraftItem: (...a: unknown[]) => removeDraftItem(...a),
  setDraftAmount: (...a: unknown[]) => setDraftAmount(...a),
  setDraftMeal: (...a: unknown[]) => setDraftMeal(...a),
  closeMeal: (...a: unknown[]) => closeMeal(...a),
  editMealParts: (...a: unknown[]) => editMealParts(...a),
  savePartAsRecipe: vi.fn(),
}));

const invalidate = vi.fn();
const useNutritionDay = vi.fn(() => ({ data: null }));
vi.mock('../../../lib/query/index.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../lib/query/index.ts')>()),
  useInvalidateNutritionDay: () => invalidate,
  useNutritionDay: () => useNutritionDay(),
  localTodayIso: () => '2026-10-28',
}));

const getUsualAtSlot = vi.fn();
const listRecipes = vi.fn();
const getRecentMeals = vi.fn();
const getCurrentMealPlan = vi.fn();
const getFoodById = vi.fn();

vi.mock('../../../lib/api.ts', () => ({
  searchFoods: vi.fn(async () => ({ status: 'ok', foods: [] })),
  getFoodRecents: vi.fn(async () => ({ status: 'ok', foods: [] })),
  getFoodById: (...a: unknown[]) => getFoodById(...a),
  listRecipes: (...a: unknown[]) => listRecipes(...a),
  getUsualAtSlot: (...a: unknown[]) => getUsualAtSlot(...a),
  getRecentMeals: (...a: unknown[]) => getRecentMeals(...a),
  getCurrentMealPlan: (...a: unknown[]) => getCurrentMealPlan(...a),
  previewMeal: vi.fn(),
  logPreviewedMeal: vi.fn(),
  readMealPhoto: vi.fn(),
  logMealFromReading: vi.fn(),
}));

vi.mock('../../plan/occurrence/format.ts', () => ({
  downscalePhoto: vi.fn(async () => 'data:image/jpeg;base64,x'),
  mealForNow: () => 'breakfast',
}));
vi.mock('../../../components/MicButton.tsx', () => ({ MicButton: () => null }));
vi.mock('../FoodBarcodePanel.tsx', () => ({ FoodBarcodePanel: () => <div>barcode-door</div> }));

const { MealScreen } = await import('./MealScreen.tsx');

const mkMeal = (over: Partial<Meal> = {}): Meal => ({
  log_id: 'm1',
  date: '2026-10-28',
  meal: 'breakfast',
  items: [],
  macros: {},
  input_method: 'manual',
  state: 'open',
  closes_at: new Date(Date.now() + 50 * 60 * 1000).toISOString(),
  ...over,
});

const banana = { kind: 'food', id: 'f-ban', name: 'Banana', serving_label: '1 medium', kcal: 105, count: 9 };
const yogurtBowl = {
  kind: 'recipe',
  id: 'r-bowl',
  name: 'Yogurt bowl',
  serving_label: '4 ingredients',
  kcal: 348,
  count: 5,
};

const recipe = (id: string, name: string, servings: number, kcal = 300) => ({
  recipe_id: id,
  name,
  source: 'user',
  servings,
  ingredients: [{ name: 'Yogurt, greek' }, { name: 'Chia' }, { name: 'Whey' }, { name: 'Berries' }],
  steps: [],
  macros_per_serving: { kcal },
  tags: [],
  saved: true,
});

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  window.localStorage.clear();
  getOpenMeal.mockResolvedValue(null);
  openMealDraft.mockResolvedValue(mkMeal());
  getUsualAtSlot.mockResolvedValue([banana, yogurtBowl]);
  listRecipes.mockResolvedValue({
    status: 'ok',
    recipes: [recipe('r-bowl', 'Yogurt bowl', 1, 348), recipe('r-stew', 'Lentil stew', 4, 380)],
  });
  getRecentMeals.mockResolvedValue([]);
  getCurrentMealPlan.mockResolvedValue({ status: 'not_found', plan: null });
  getFoodById.mockResolvedValue({ status: 'error', food: null });
  invalidate.mockResolvedValue(undefined);
});

async function mount(props: Partial<Parameters<typeof MealScreen>[0]> = {}) {
  const onClose = vi.fn();
  const onLogged = vi.fn();
  renderWithQuery(<MealScreen meal="breakfast" onClose={onClose} onLogged={onLogged} {...props} />);
  await waitFor(() => expect(getOpenMeal).toHaveBeenCalled());
  await screen.findByRole('tablist', { name: 'Shelves' });
  return { onClose, onLogged };
}

const tile = (name: RegExp | string) => screen.findByRole('button', { name });
const tap = (el: HTMLElement) => {
  fireEvent.pointerDown(el, { clientX: 10, clientY: 10, button: 0 });
  fireEvent.pointerUp(el, { clientX: 10, clientY: 10 });
  fireEvent.click(el);
};

describe('the shelves', () => {
  it('opens on Usual with three tabs when the week names nothing for this slot', async () => {
    await mount();
    const tabs = within(screen.getByRole('tablist', { name: 'Shelves' })).getAllByRole('tab');
    expect(tabs.map((t) => t.textContent)).toEqual(['Usual', 'Leftovers', 'Cookbook']);
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true');
  });

  it('opens on Planned, a fourth tab, when the week names a dish for this slot', async () => {
    getCurrentMealPlan.mockResolvedValue({
      status: 'ok',
      plan: {
        meal_plan_id: 'p',
        week_of: '2026-10-26',
        days: [{ day: '2026-10-28', meals: [{ slot: 'breakfast', recipe_id: 'r-bowl', recipe_name: 'Yogurt bowl' }] }],
        shopping_list: [],
      },
    });
    await mount();
    const tablist = screen.getByRole('tablist', { name: 'Shelves' });
    await waitFor(() => expect(within(tablist).getAllByRole('tab')).toHaveLength(4));
    expect(within(tablist).getByRole('tab', { name: 'Planned' })).toHaveAttribute('aria-selected', 'true');
    expect(await tile(/^Yogurt bowl, from your week/)).toBeInTheDocument();
  });

  it('Usual lists the slot’s foods and one-portion recipes as tiles with their kcal — no labels, no photos', async () => {
    await mount();
    const b = await tile(/^Banana, 1 medium/);
    expect(within(b).getByText('105')).toBeInTheDocument();
    // The recipe's sub-line is its ingredients, read from the cookbook, not "4 ingredients".
    expect(await tile(/^Yogurt bowl, Yogurt · Chia · Whey · Berries/)).toBeInTheDocument();
    // The makes-four stew is not a one-portion habit; it lives on Cookbook.
    expect(screen.queryByRole('button', { name: /^Lentil stew/ })).toBeNull();
  });

  it('Cookbook lists every saved recipe, "makes N" for a batch', async () => {
    await mount();
    fireEvent.click(screen.getByRole('tab', { name: 'Cookbook' }));
    expect(await tile(/^Lentil stew, makes 4/)).toBeInTheDocument();
    expect(await tile(/^Yogurt bowl, Yogurt · Chia/)).toBeInTheDocument();
  });

  it('Leftovers is the meals logged recently, newest first — open ones and old ones are not on it', async () => {
    const closed = {
      input_method: 'manual',
      macros: { kcal: 520, protein_g: 31, carbs_g: 60, fat_g: 14 },
      state: 'closed',
    };
    getRecentMeals.mockResolvedValue([
      { ...closed, log_id: 'lunch', date: '2026-10-27', meal: 'lunch', items: [{ name: 'Wrap' }] },
      {
        ...closed,
        log_id: 'dinner',
        date: '2026-10-27',
        meal: 'dinner',
        items: [
          { name: 'Lentils', qty: 1, unit: 'cup', food_id: 'f-len', part: 'p1', est: { kcal: 230 } },
          { name: 'Onion', qty: 0.5, unit: 'item', food_id: 'f-on', part: 'p1', est: { kcal: 22 } },
          { name: 'Side salad', est: { kcal: 60 } },
        ],
        parts: [{ key: 'p1', name: 'Lentil stew', recipe_id: 'r-stew', yield_servings: 4, servings_logged: 1 }],
      },
      { ...closed, log_id: 'open', date: '2026-10-28', meal: 'snack', items: [{ name: 'Apple' }], state: 'open' },
      { ...closed, log_id: 'old', date: '2026-10-20', meal: 'dinner', items: [{ name: 'Chili' }] },
    ]);
    appendParsed.mockResolvedValue(
      mkMeal({
        items: [
          { name: 'Lentils', qty: 1, unit: 'cup', food_id: 'f-len', est: { kcal: 230 } },
          { name: 'Onion', qty: 0.5, unit: 'item', food_id: 'f-on', est: { kcal: 22 } },
          { name: 'Side salad', est: { kcal: 60 } },
        ],
      }),
    );
    editMealParts.mockResolvedValue(mkMeal());
    await mount();
    fireEvent.click(screen.getByRole('tab', { name: 'Leftovers' }));
    const stew = await tile(/^Lentil stew · Side salad, yesterday · dinner/);
    const names = within(screen.getByRole('tabpanel'))
      .getAllByRole('button')
      .map((b) => b.getAttribute('aria-label'));
    expect(names).toEqual(['Lentil stew · Side salad, yesterday · dinner', 'Wrap, yesterday · lunch']);
    expect(stew).toHaveTextContent('P 31 · C 60 · F 14');
    tap(stew);
    await waitFor(() =>
      expect(appendParsed).toHaveBeenCalledWith('m1', {
        items: [
          { name: 'Lentils', qty: 1, unit: 'cup', food_id: 'f-len', est: { kcal: 230 } },
          { name: 'Onion', qty: 0.5, unit: 'item', food_id: 'f-on', est: { kcal: 22 } },
          { name: 'Side salad', est: { kcal: 60 } },
        ],
      }),
    );
    // The bracket is drawn round its rows again, under its own name.
    await waitFor(() =>
      expect(editMealParts).toHaveBeenCalledWith('m1', { op: 'group', item_indexes: [0, 1], name: 'Lentil stew' }),
    );
  });

  it('a 14-day window from Settings reaches back past the default seven', async () => {
    window.localStorage.setItem('cadence.leftoverWindowDays', '14');
    getRecentMeals.mockResolvedValue([
      {
        log_id: 'old',
        date: '2026-10-20',
        meal: 'dinner',
        items: [{ name: 'Chili' }],
        macros: {},
        input_method: 'manual',
      },
    ]);
    await mount();
    fireEvent.click(screen.getByRole('tab', { name: 'Leftovers' }));
    expect(await tile(/^Chili, 20 Oct · dinner/)).toBeInTheDocument();
    expect(getRecentMeals).toHaveBeenCalledWith(15);
  });

  it('an empty shelf says one honest line', async () => {
    await mount();
    fireEvent.click(screen.getByRole('tab', { name: 'Leftovers' }));
    expect(await screen.findByText(/Nothing logged in that window yet/)).toBeInTheDocument();
  });
});

describe('the tap grammar', () => {
  it('tap = one default serving, with a ✓; tap again doubles the row, ×2', async () => {
    appendFood.mockResolvedValue(
      mkMeal({ items: [{ name: 'Banana', qty: 1, unit: 'medium', food_id: 'f-ban', est: { kcal: 105 } }] }),
    );
    setDraftAmount.mockResolvedValue(
      mkMeal({ items: [{ name: 'Banana', qty: 2, unit: 'medium', food_id: 'f-ban', est: { kcal: 210 } }] }),
    );
    await mount();
    tap(await tile(/^Banana, 1 medium$/));
    await waitFor(() => expect(appendFood).toHaveBeenCalledWith('m1', { food_id: 'f-ban' }));
    const once = await tile(/^Banana, 1 medium — in the cart ✓/);
    expect(within(once).getByText('✓')).toBeInTheDocument();

    tap(once);
    // The second tap is an amount on the row the first made — not a second row.
    await waitFor(() => expect(setDraftAmount).toHaveBeenCalledWith('m1', 0, 2));
    expect(appendFood).toHaveBeenCalledTimes(1);
    expect(await tile(/— in the cart ×2/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '2× Banana' })).toBeInTheDocument();
  });

  it('a dish tile appends one portion as a bracket', async () => {
    appendRecipe.mockResolvedValue(mkMeal());
    await mount();
    tap(await tile(/^Yogurt bowl/));
    await waitFor(() => expect(appendRecipe).toHaveBeenCalledWith('m1', { recipe_id: 'r-bowl', servings: 1 }));
  });

  it('hold = the amount sheet: chips from the food’s own servings, Add lands the chosen one', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      getFoodById.mockResolvedValue({
        status: 'ok',
        food: {
          food_id: 'f-ban',
          owner_user_id: null,
          visibility: 'shared',
          name: 'Banana',
          brand: null,
          source: 'cnf',
          off_id: null,
          fdc_id: null,
          base_unit: 'g',
          macros_per_base: { kcal: 89 },
          servings: [
            { label: '1 medium', unit: 'item', amount_g: 118 },
            { label: '100 g', unit: 'g', amount_g: 100 },
          ],
          default_serving: 0,
          confidence: null,
          photo_ref: null,
        },
      });
      appendFood.mockResolvedValue(mkMeal({ items: [{ name: 'Banana', qty: 1.5, unit: 'medium', food_id: 'f-ban' }] }));
      await mount();
      const b = await tile(/^Banana, 1 medium$/);
      fireEvent.pointerDown(b, { clientX: 10, clientY: 10, button: 0 });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(HOLD_MS + 10);
      });
      fireEvent.pointerUp(b, { clientX: 10, clientY: 10 });
      fireEvent.click(b);
      const sheet = await screen.findByRole('dialog', { name: 'How much Banana?' });
      expect(await within(sheet).findByRole('button', { name: '1½ medium' })).toBeInTheDocument();
      expect(within(sheet).getByRole('button', { name: '100 g' })).toBeInTheDocument();
      // Holding never added anything by itself.
      expect(appendFood).not.toHaveBeenCalled();
      fireEvent.click(within(sheet).getByRole('button', { name: '1½ medium' }));
      fireEvent.click(within(sheet).getByRole('button', { name: 'Add' }));
      await waitFor(() =>
        expect(appendFood).toHaveBeenCalledWith('m1', { food_id: 'f-ban', serving_index: 0, quantity: 1.5 }),
      );
      // A chosen amount is one tap's worth: ✓, not ×2.
      expect(await tile(/^Banana, 1 medium — in the cart ✓/)).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('hold is findable: a one-time line, a press that draws itself, and a haptic when it lands', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      await mount();
      expect(await screen.findByText('Hold a tile to choose how much.')).toBeInTheDocument();
      const b = await tile(/^Banana, 1 medium$/);
      fireEvent.pointerDown(b, { clientX: 10, clientY: 10, button: 0 });
      expect(b).toHaveClass('is-pressing', 'can-hold');
      expect(tickHaptic).not.toHaveBeenCalled();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(HOLD_MS + 10);
      });
      expect(tickHaptic).toHaveBeenCalledTimes(1);
      expect(b).not.toHaveClass('is-pressing');
      fireEvent.pointerUp(b, { clientX: 10, clientY: 10 });
      // Using the gesture retires the line, for good.
      expect(screen.queryByText('Hold a tile to choose how much.')).not.toBeInTheDocument();
      expect(window.localStorage.getItem('cadence.holdHintSeen')).toBe('1');
    } finally {
      vi.useRealTimers();
    }
  });

  it('a tap is not a hold: no haptic, and the line stays', async () => {
    appendFood.mockResolvedValue(mkMeal({ items: [{ name: 'Banana', qty: 1, food_id: 'f-ban' }] }));
    await mount();
    tap(await tile(/^Banana, 1 medium$/));
    await waitFor(() => expect(appendFood).toHaveBeenCalled());
    expect(tickHaptic).not.toHaveBeenCalled();
    expect(screen.getByText('Hold a tile to choose how much.')).toBeInTheDocument();
  });

  it('a hold on a dish asks how many servings', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      appendRecipe.mockResolvedValue(mkMeal());
      await mount();
      fireEvent.click(screen.getByRole('tab', { name: 'Cookbook' }));
      const stew = await tile(/^Lentil stew, makes 4/);
      fireEvent.pointerDown(stew, { clientX: 10, clientY: 10, button: 0 });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(HOLD_MS + 10);
      });
      fireEvent.pointerUp(stew, { clientX: 10, clientY: 10 });
      const sheet = await screen.findByRole('dialog', { name: 'How many servings of Lentil stew?' });
      fireEvent.click(within(sheet).getByRole('button', { name: 'More servings' }));
      expect(within(sheet).getByText('760')).toBeInTheDocument();
      fireEvent.click(within(sheet).getByRole('button', { name: 'Add' }));
      await waitFor(() => expect(appendRecipe).toHaveBeenCalledWith('m1', { recipe_id: 'r-stew', servings: 2 }));
    } finally {
      vi.useRealTimers();
    }
  });

  it('a drag across a tile is neither a tap nor a hold', async () => {
    await mount();
    const b = await tile(/^Banana/);
    fireEvent.pointerDown(b, { clientX: 10, clientY: 10, button: 0 });
    fireEvent.pointerMove(b, { clientX: 40, clientY: 12 });
    fireEvent.pointerUp(b, { clientX: 40, clientY: 12 });
    fireEvent.click(b);
    await new Promise((r) => setTimeout(r, 20));
    expect(appendFood).not.toHaveBeenCalled();
  });
});

describe('the cart', () => {
  const cartMeal = () =>
    mkMeal({
      items: [
        { name: 'Yogurt', qty: 1, unit: 'cup', part: 'p1', est: { kcal: 150 } },
        { name: 'Chia', qty: 1, unit: 'tbsp', part: 'p1', est: { kcal: 60 } },
        { name: 'Flat white', qty: 1, unit: 'cup', food_id: 'f-fw', est: { kcal: 120 } },
      ],
      parts: [{ key: 'p1', name: 'Yogurt bowl', recipe_id: 'r-bowl' }],
    });

  it('draws one chip per thing — a bracket is one — and the one button with the total', async () => {
    openMealDraft.mockResolvedValue(cartMeal());
    await mount();
    expect(await screen.findByText('Yogurt bowl', { selector: '.ms-cart-chip-w' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Flat white' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Log breakfast · 330 kcal' })).toBeInTheDocument();
    // Nothing else on the surface says a total or counts rows.
    expect(screen.queryByText(/THIS MEAL/)).toBeNull();
    expect(screen.queryByText(/OPEN/)).toBeNull();
  });

  it('× on a bracket takes out every member, highest row first; × on a row takes out that row', async () => {
    openMealDraft.mockResolvedValue(cartMeal());
    removeDraftItem.mockResolvedValue(mkMeal());
    await mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Take out Yogurt bowl' }));
    await waitFor(() => expect(removeDraftItem).toHaveBeenCalledTimes(2));
    expect(removeDraftItem.mock.calls.map((c) => c[1])).toEqual([1, 0]);
  });

  it('a loose chip’s words open the row; a bracket’s do not', async () => {
    openMealDraft.mockResolvedValue(cartMeal());
    await mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Flat white' }));
    expect(await screen.findByRole('dialog', { name: 'Flat white' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Yogurt bowl' })).toBeNull();
  });

  it('an unsettled amount holds the button until its chip is opened and settled', async () => {
    openMealDraft.mockResolvedValue(mkMeal({ items: [{ name: 'Granola', unit: 'cup', est: { kcal: 200 } }] }));
    await mount();
    const log = await screen.findByRole('button', { name: /Log breakfast/ });
    expect(log).toBeDisabled();
    expect(screen.getByText(/One amount to settle first/)).toBeInTheDocument();
  });

  it('Log closes the meal and hands off', async () => {
    openMealDraft.mockResolvedValue(mkMeal({ items: [{ name: 'Oats', qty: 1, unit: 'cup', est: { kcal: 300 } }] }));
    closeMeal.mockResolvedValue(
      mkMeal({ state: 'closed', items: [{ name: 'Oats', qty: 1, unit: 'cup', est: { kcal: 300 } }] }),
    );
    const { onLogged } = await mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Log breakfast · 300 kcal' }));
    await waitFor(() => expect(closeMeal).toHaveBeenCalledWith('m1'));
    expect(invalidate).toHaveBeenCalled();
    expect(onLogged).toHaveBeenCalledTimes(1);
  });

  it('a logged meal keeps its slot, offers Done, and an add counts the moment it lands', async () => {
    getOpenMeal.mockResolvedValue(
      mkMeal({ state: 'closed', items: [{ name: 'Oats', qty: 1, unit: 'cup', est: { kcal: 300 } }] }),
    );
    appendFood.mockResolvedValue(
      mkMeal({
        state: 'closed',
        items: [
          { name: 'Oats', qty: 1, unit: 'cup', est: { kcal: 300 } },
          { name: 'Banana', qty: 1, unit: 'medium', food_id: 'f-ban', est: { kcal: 105 } },
        ],
      }),
    );
    const { onLogged } = await mount();
    expect(screen.getByRole('button', { name: 'Meal' })).toBeDisabled();
    tap(await tile(/^Banana/));
    await waitFor(() => expect(appendFood).toHaveBeenCalled());
    await waitFor(() => expect(invalidate).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(onLogged).toHaveBeenCalledTimes(1);
  });
});

describe('the title row', () => {
  it('the title is the picker — pick a slot and the draft moves', async () => {
    setDraftMeal.mockResolvedValue(mkMeal({ meal: 'lunch' }));
    await mount();
    fireEvent.click(screen.getByRole('button', { name: 'Meal' }));
    fireEvent.click(await screen.findByRole('option', { name: /lunch/ }));
    await waitFor(() => expect(setDraftMeal).toHaveBeenCalledWith('m1', 'lunch'));
    // No ‹, no OPEN pill, no window line, no "change ⌄" hint.
    expect(screen.queryByRole('button', { name: 'Back' })).toBeNull();
    expect(screen.queryByText(/adds until/)).toBeNull();
    expect(screen.queryByText(/change/)).toBeNull();
  });

  it('the face hops to the coach with the meal and the cart in her note — and is absent without a host', async () => {
    openMealDraft.mockResolvedValue(mkMeal({ items: [{ name: 'Eggs on toast', qty: 1, est: { kcal: 412 } }] }));
    const onCoach = vi.fn();
    await mount({ onCoach });
    fireEvent.click(await screen.findByRole('button', { name: 'Talk to Cadence about this meal' }));
    expect(onCoach).toHaveBeenCalledTimes(1);
    const note = onCoach.mock.calls[0]![0] as string;
    expect(note).toContain('breakfast');
    expect(note).toContain('eggs on toast');
    expect(note).toContain('get_food_log');
    cleanup();
    await mount();
    expect(screen.queryByRole('button', { name: 'Talk to Cadence about this meal' })).toBeNull();
  });

  it('the day card is the way to the whole day when the host has one', async () => {
    const onOpenDay = vi.fn();
    await mount({ onOpenDay });
    fireEvent.click(screen.getByRole('button', { name: 'Open your whole day in Food' }));
    expect(onOpenDay).toHaveBeenCalledTimes(1);
  });
});

describe('the doors — icon-only, Find first', () => {
  it('five doors, named for a screen reader, Find leading', async () => {
    await mount();
    const names = ['Find', 'Chat', 'Voice', 'Picture', 'Barcode'];
    const doors = names.map((n) => screen.getByLabelText(n));
    expect(doors.every((d) => d.textContent === '')).toBe(true);
    expect(doors[0]!.compareDocumentPosition(doors[1]!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('Find opens the search; closing it lands back on the shelves', async () => {
    await mount();
    fireEvent.click(screen.getByLabelText('Find'));
    expect(await screen.findByLabelText('Find a food')).toBeInTheDocument();
    expect(screen.queryByRole('tablist', { name: 'Shelves' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(await screen.findByRole('tablist', { name: 'Shelves' })).toBeInTheDocument();
  });
});
