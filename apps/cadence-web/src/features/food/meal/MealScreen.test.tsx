/**
 * The meal is the screen (1b), driven end to end with the data layer mocked at the module
 * boundary: rejoin, the empty state's promises (express lane, the way back to the day), the
 * one-unsettled-amount gate on the close, the close itself, and B3's offer — four quick adds,
 * offered once, never again after "Leave them".
 */
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { renderWithQuery } from '../../../test/withQuery.tsx';
import type { Meal } from '../../../lib/api/meal-draft.ts';

const openMealDraft = vi.fn();
const getOpenMeal = vi.fn();
const appendFood = vi.fn();
const appendRecipe = vi.fn();
const setDraftAmount = vi.fn();
const closeMeal = vi.fn();
const editMealParts = vi.fn();

vi.mock('../../../lib/api/meal-draft.ts', () => ({
  openMealDraft: (...a: unknown[]) => openMealDraft(...a),
  getOpenMeal: (...a: unknown[]) => getOpenMeal(...a),
  appendFood: (...a: unknown[]) => appendFood(...a),
  appendRecipe: (...a: unknown[]) => appendRecipe(...a),
  appendParsed: vi.fn(),
  removeDraftItem: vi.fn(),
  setDraftAmount: (...a: unknown[]) => setDraftAmount(...a),
  setDraftMeal: vi.fn(),
  closeMeal: (...a: unknown[]) => closeMeal(...a),
  editMealParts: (...a: unknown[]) => editMealParts(...a),
  savePartAsRecipe: vi.fn(),
}));

const invalidate = vi.fn();
const useNutritionDay = vi.fn(() => ({ data: null }));
/** Partial: the stubs below stand in for the reads this suite drives; everything else — the food
 *  library reads the screen now shares — runs through the real cached hooks onto the mocked API. */
vi.mock('../../../lib/query/index.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../lib/query/index.ts')>()),
  useInvalidateNutritionDay: () => invalidate,
  useNutritionDay: () => useNutritionDay(),
}));

const searchFoods = vi.fn();
const getFoodRecents = vi.fn();
const listRecipes = vi.fn();
const getUsualAtSlot = vi.fn();

vi.mock('../../../lib/api.ts', () => ({
  searchFoods: (...a: unknown[]) => searchFoods(...a),
  getFoodRecents: (...a: unknown[]) => getFoodRecents(...a),
  getFoodById: vi.fn(),
  listRecipes: (...a: unknown[]) => listRecipes(...a),
  getUsualAtSlot: (...a: unknown[]) => getUsualAtSlot(...a),
  previewMeal: vi.fn(),
  logPreviewedMeal: vi.fn(),
  readMealPhoto: vi.fn(),
  logMealFromReading: vi.fn(),
}));

vi.mock('../../plan/occurrence/format.ts', () => ({
  downscalePhoto: vi.fn(async () => 'data:image/jpeg;base64,x'),
  mealForNow: () => 'breakfast',
}));
/** Renders nothing unless it was opened live, so a test can tell the two chat doors apart. */
vi.mock('../../../components/MicButton.tsx', () => ({
  MicButton: ({ autoStart }: { autoStart?: boolean }) => (autoStart ? <i data-testid="mic-live" /> : null),
}));
vi.mock('../FoodBarcodePanel.tsx', () => ({ FoodBarcodePanel: () => <div>barcode-door</div> }));
vi.mock('../shelf/CookbookShelf.tsx', () => ({ CookbookShelf: () => <div>cookbook-shelf</div> }));

const { MealScreen } = await import('./MealScreen.tsx');
const { resetGroupOffers } = await import('./useGroupOffer.ts');

const mkMeal = (over: Partial<Meal> = {}): Meal => ({
  log_id: 'm1',
  date: '2026-09-02',
  meal: 'breakfast',
  items: [],
  macros: {},
  input_method: 'manual',
  state: 'open',
  closes_at: new Date(Date.now() + 50 * 60 * 1000).toISOString(),
  ...over,
});

const item = (name: string, qty: number | null = 1, kcal = 100) => ({
  name,
  ...(qty != null ? { qty } : {}),
  unit: 'cup',
  est: { kcal },
});

beforeEach(() => {
  cleanup();
  resetGroupOffers();
  vi.clearAllMocks();
  getOpenMeal.mockResolvedValue(null);
  openMealDraft.mockResolvedValue(mkMeal());
  getFoodRecents.mockResolvedValue({ status: 'ok', foods: [] });
  searchFoods.mockResolvedValue({ status: 'ok', foods: [] });
  listRecipes.mockResolvedValue({ status: 'ok', recipes: [] });
  getUsualAtSlot.mockResolvedValue([]);
  invalidate.mockResolvedValue(undefined);
});

async function mount(props: Partial<Parameters<typeof MealScreen>[0]> = {}) {
  const onClose = vi.fn();
  const onExpressSingle = vi.fn();
  const onOpenDay = vi.fn();
  renderWithQuery(<MealScreen onClose={onClose} onExpressSingle={onExpressSingle} onOpenDay={onOpenDay} {...props} />);
  await waitFor(() => expect(getOpenMeal).toHaveBeenCalled());
  return { onClose, onExpressSingle, onOpenDay };
}

it('shows the empty state and fires the express lane and the way back to the day', async () => {
  const { onExpressSingle, onOpenDay } = await mount();
  expect(await screen.findByText('Add everything you had')).toBeInTheDocument();
  expect(screen.getByText(/nothing in it yet/)).toBeInTheDocument();
  fireEvent.click(screen.getByText('Log a single food instead ›'));
  expect(onExpressSingle).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByText('Your whole day ›'));
  expect(onOpenDay).toHaveBeenCalledTimes(1);
});

describe("the empty state's doors — each one opens its own surface", () => {
  /** The door, and the one thing that can only be on screen if it opened the right surface. */
  const DOORS: Array<{ door: string; landmark: string; how: 'text' | 'label' }> = [
    { door: 'Barcode', landmark: 'barcode-door', how: 'text' },
    { door: 'Recents', landmark: 'Search foods', how: 'label' },
    { door: 'My meals', landmark: 'cookbook-shelf', how: 'text' },
  ];

  it.each(DOORS)('$door', async ({ door, landmark, how }) => {
    await mount();
    fireEvent.click(await screen.findByRole('button', { name: door }));
    const found = how === 'label' ? await screen.findByLabelText(landmark) : await screen.findByText(landmark);
    expect(found).toBeInTheDocument();
    expect(screen.queryByText('Add everything you had')).toBeNull();
  });

  it('Picture is a camera input, not a button — iOS only hands back a photo for a real label', async () => {
    await mount();
    await screen.findByText('Add everything you had');
    const input = document.querySelector('.ms-door input[type="file"]');
    expect(input).not.toBeNull();
    expect(input).toHaveAttribute('capture', 'environment');
  });

  it('the field keeps both halves of its promise: the words open search, the mic opens chat LIVE', async () => {
    // The field shipped as a bare text button, so "or just describe it" had nothing behind it —
    // the canvas (1b B1) draws a search icon, the words, and a mic. This pins the mic.
    await mount();
    await screen.findByText('Add everything you had');
    fireEvent.click(screen.getByRole('button', { name: 'Say what you had' }));
    expect(await screen.findByLabelText('What did you have?')).toBeInTheDocument();
    // …and it arrived listening, rather than as the plain chat door.
    expect(screen.getByTestId('mic-live')).toBeInTheDocument();
  });

  it('the words still open search, unchanged', async () => {
    await mount();
    fireEvent.click(await screen.findByText('Search, or just describe it…'));
    expect(await screen.findByLabelText('Search foods')).toBeInTheDocument();
  });
});

it('rejoins an open meal and draws its rows, window and totals', async () => {
  getOpenMeal.mockResolvedValue(mkMeal({ items: [item('Greek yogurt', 1, 146), item('Chia seeds', 1, 58)] }));
  await mount();
  expect(await screen.findByText('Greek yogurt')).toBeInTheDocument();
  expect(screen.getByText(/OPEN · 50 MIN LEFT/)).toBeInTheDocument();
  expect(screen.getByText(/adds until/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /Close breakfast · 204 kcal/ })).toBeEnabled();
});

it('one unsettled amount holds the commit, and its chip settles it', async () => {
  getOpenMeal.mockResolvedValue(mkMeal({ items: [item('Greek yogurt', 1, 146), item('Chia seeds', null, 58)] }));
  setDraftAmount.mockResolvedValue(mkMeal({ items: [item('Greek yogurt', 1, 146), item('Chia seeds', 1, 58)] }));
  await mount();
  expect(await screen.findByText('One amount to settle first')).toBeInTheDocument();
  const closeBtn = screen.getByRole('button', { name: /Close breakfast/ });
  expect(closeBtn).toBeDisabled();
  // Asked as chips, never a keypad.
  expect(screen.getByText('how much?')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '1 cup' }));
  await waitFor(() => expect(setDraftAmount).toHaveBeenCalledWith('m1', 1, 1));
  await waitFor(() => expect(screen.queryByText('One amount to settle first')).toBeNull());
  expect(screen.getByRole('button', { name: /Close breakfast/ })).toBeEnabled();
});

it('closing calls closeMeal, refreshes the day, and leaves the screen', async () => {
  getOpenMeal.mockResolvedValue(mkMeal({ items: [item('Greek yogurt', 1, 146)] }));
  closeMeal.mockResolvedValue(mkMeal({ items: [item('Greek yogurt', 1, 146)], state: 'closed' }));
  const { onClose } = await mount();
  fireEvent.click(await screen.findByRole('button', { name: /Close breakfast/ }));
  await waitFor(() => expect(closeMeal).toHaveBeenCalledWith('m1'));
  expect(invalidate).toHaveBeenCalledTimes(1);
  expect(onClose).toHaveBeenCalledTimes(1);
});

describe('B3 — four quick adds, offered once', () => {
  const foods = ['Greek yogurt', 'Chia seeds', 'Whey protein', 'Strawberries'];

  /** Add four unambiguous foods through the add door, then come back to the meal. */
  async function addFourFast() {
    searchFoods.mockImplementation(async (q: string) => ({
      status: 'ok',
      foods: [{ food_id: `f-${q}`, name: q, brand: null, serving_label: null, ambiguous: false }],
    }));
    let grown: ReturnType<typeof item>[] = [];
    appendFood.mockImplementation(async (_id: string, input: { food_id: string }) => {
      grown = [...grown, item(input.food_id.slice(2))];
      return mkMeal({ items: grown });
    });
    fireEvent.click(screen.getByText('Search, or just describe it…'));
    const input = await screen.findByLabelText('Search foods');
    for (const f of foods) {
      fireEvent.change(input, { target: { value: f } });
      fireEvent.click(await screen.findByText(f, { selector: '.fq-row b' }));
      await waitFor(() => expect((input as HTMLInputElement).value).toBe(''));
    }
    fireEvent.click(screen.getByRole('button', { name: 'Done · back to breakfast' }));
    await screen.findByText(/FOUR THINGS/);
  }

  it('offers the bracket after four fast adds; accepting groups them', async () => {
    await mount();
    await screen.findByText('Add everything you had');
    await addFourFast();
    expect(await screen.findByText('Four things, one after another. Do they go together?')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Yes, together' }));
    await waitFor(() =>
      expect(editMealParts).toHaveBeenCalledWith(
        'm1',
        expect.objectContaining({ op: 'group', item_indexes: [0, 1, 2, 3] }),
      ),
    );
  });

  it('never re-offers this draft after "Leave them"', async () => {
    await mount();
    await screen.findByText('Add everything you had');
    await addFourFast();
    fireEvent.click(await screen.findByRole('button', { name: 'Leave them' }));
    expect(screen.queryByText('Four things, one after another. Do they go together?')).toBeNull();
    // A fifth quick add would re-qualify on the numbers — but the draft was declined.
    fireEvent.click(screen.getByRole('button', { name: /Add another thing/ }));
    const input = await screen.findByLabelText('Search foods');
    fireEvent.change(input, { target: { value: 'Oat latte' } });
    fireEvent.click(await screen.findByText('Oat latte', { selector: '.fq-row b' }));
    await waitFor(() => expect((input as HTMLInputElement).value).toBe(''));
    fireEvent.click(screen.getByRole('button', { name: 'Done · back to breakfast' }));
    await screen.findByText(/FIVE THINGS/);
    expect(screen.queryByText(/Do they go together\?/)).toBeNull();
  });
});

it('the ⋯ menu carries the boring twins, and "Close it now" closes', async () => {
  getOpenMeal.mockResolvedValue(mkMeal({ items: [item('Greek yogurt'), item('Chia seeds')] }));
  closeMeal.mockResolvedValue(null);
  const { onClose } = await mount();
  await screen.findByText('Greek yogurt');
  fireEvent.click(screen.getByRole('button', { name: 'More for this meal' }));
  const sheet = screen.getByRole('dialog', { name: 'This meal' });
  expect(within(sheet).getByText('Save as a meal')).toBeInTheDocument();
  expect(within(sheet).getByText('Save as a recipe')).toBeInTheDocument();
  expect(within(sheet).getByText('Rename this meal')).toBeInTheDocument();
  fireEvent.click(within(sheet).getByText('Close it now'));
  await waitFor(() => expect(closeMeal).toHaveBeenCalledWith('m1'));
  expect(onClose).toHaveBeenCalled();
});
