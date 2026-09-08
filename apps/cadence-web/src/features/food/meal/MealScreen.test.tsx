/**
 * The meal is the screen (1b), driven end to end with the data layer mocked at the module
 * boundary: rejoin, the doors as one row (Find first), the usual shelf's one-tap adds, the
 * one-unsettled-amount gate on the log, the log itself, a row's details, B3's offer — four quick
 * adds, offered once, never again after "Leave them" — and the cart ruling (2026-09-07): a
 * logged meal takes adds that count as they land.
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

it('a named slot opens THAT slot, not whatever happens to be open', async () => {
  // Yesterday's missed breakfast must not land in today's open lunch.
  getOpenMeal.mockResolvedValue(mkMeal({ log_id: 'lunch', meal: 'lunch', date: '2026-09-07' }));
  openMealDraft.mockResolvedValue(mkMeal({ log_id: 'bfast', meal: 'breakfast', date: '2026-09-06' }));
  await mount({ meal: 'breakfast', date: '2026-09-06' });
  await waitFor(() => expect(openMealDraft).toHaveBeenCalledWith({ meal: 'breakfast', date: '2026-09-06' }));
});

describe('the doors — one row, Find first, each opening its own surface', () => {
  /** The door, and the one thing that can only be on screen if it opened the right surface. */
  const DOORS: Array<{ door: string; landmark: string; how: 'text' | 'label' }> = [
    { door: 'Find', landmark: 'Find a food', how: 'label' },
    { door: 'Chat', landmark: 'What did you have?', how: 'label' },
    { door: 'Barcode', landmark: 'barcode-door', how: 'text' },
    { door: 'From your cookbook ›', landmark: 'cookbook-shelf', how: 'text' },
  ];

  it.each(DOORS)('$door', async ({ door, landmark, how }) => {
    await mount();
    fireEvent.click(await screen.findByRole('button', { name: door }));
    const found = how === 'label' ? await screen.findByLabelText(landmark) : await screen.findByText(landmark);
    expect(found).toBeInTheDocument();
    expect(screen.queryByText('Add everything you had')).toBeNull();
  });

  it('Find is the first tile in the row', async () => {
    await mount();
    await screen.findByText('Add everything you had');
    const tiles = document.querySelectorAll('.fm-tile .fm-tile-l');
    expect(Array.from(tiles).map((t) => t.textContent)).toEqual(['Find', 'Chat', 'Voice', 'Picture', 'Barcode']);
  });

  it('Picture is a camera input, not a button — iOS only hands back a photo for a real label', async () => {
    await mount();
    await screen.findByText('Add everything you had');
    const input = document.querySelector('.fm-tile input[type="file"]');
    expect(input).not.toBeNull();
    expect(input).toHaveAttribute('capture', 'environment');
  });

  it('Voice opens the same chat door, already listening', async () => {
    await mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Voice' }));
    expect(await screen.findByLabelText('What did you have?')).toBeInTheDocument();
    expect(screen.getByTestId('mic-live')).toBeInTheDocument();
  });
});

describe('the shelf — what they usually have, one tap each, no heading', () => {
  it('lists the slot’s usual foods and recipes and adds one straight into the meal', async () => {
    getUsualAtSlot.mockResolvedValue([
      { kind: 'food', id: 'f-espresso', name: 'Espresso', serving_label: '1 capsule', kcal: 1, count: 2 },
      { kind: 'recipe', id: 'r-bowl', name: 'Chia bowl', serving_label: '4 ingredients', kcal: 348, count: 3 },
    ]);
    appendFood.mockResolvedValue(mkMeal({ items: [item('Espresso', 1, 1)] }));
    appendRecipe.mockResolvedValue(mkMeal({ items: [item('Espresso', 1, 1), item('Chia bowl', 1, 348)] }));
    await mount({ meal: 'breakfast' });
    fireEvent.click(await screen.findByRole('button', { name: /Espresso/ }));
    await waitFor(() => expect(appendFood).toHaveBeenCalledWith('m1', { food_id: 'f-espresso' }));
    expect(screen.queryByText(/YOU USUALLY HAVE/)).toBeNull();
    expect(screen.queryByText(/logged 2 times/)).toBeNull();
    fireEvent.click(await screen.findByRole('button', { name: /Chia bowl/ }));
    await waitFor(() => expect(appendRecipe).toHaveBeenCalledWith('m1', { recipe_id: 'r-bowl' }));
  });

  it('the shelf stays under the cart once there is something in it', async () => {
    getOpenMeal.mockResolvedValue(mkMeal({ items: [item('Greek yogurt', 1, 146)] }));
    getUsualAtSlot.mockResolvedValue([
      { kind: 'food', id: 'f-espresso', name: 'Espresso', serving_label: '1 capsule', kcal: 1, count: 2 },
    ]);
    await mount();
    await screen.findByText('Greek yogurt');
    expect(await screen.findByRole('button', { name: /Espresso/ })).toBeInTheDocument();
  });
});

it('rejoins an open meal and draws its rows, window and totals — and the button says Log', async () => {
  getOpenMeal.mockResolvedValue(mkMeal({ items: [item('Greek yogurt', 1, 146), item('Chia seeds', 1, 58)] }));
  await mount();
  expect(await screen.findByText('Greek yogurt')).toBeInTheDocument();
  expect(screen.getByText(/OPEN · 50 MIN LEFT/)).toBeInTheDocument();
  // Two loose rows: the one line is the grouping hint, and only that — the window yields to it
  // (owner, 2026-09-08: "don't add more words"). windowLine.test.ts pins the window on its own.
  expect(screen.getByText('drag things together to make a recipe')).toBeInTheDocument();
  expect(screen.queryByText(/adds until/)).toBeNull();
  // The line under the title says only what the list cannot — no clock, no count of rows.
  expect(screen.queryByText(/TWO THINGS/)).toBeNull();
  expect(screen.getByRole('button', { name: /Log breakfast · 204 kcal/ })).toBeEnabled();
  expect(screen.queryByText(/left today/)).toBeNull();
});

it('one unsettled amount holds the log, and its chip settles it', async () => {
  getOpenMeal.mockResolvedValue(mkMeal({ items: [item('Greek yogurt', 1, 146), item('Chia seeds', null, 58)] }));
  setDraftAmount.mockResolvedValue(mkMeal({ items: [item('Greek yogurt', 1, 146), item('Chia seeds', 1, 58)] }));
  await mount();
  expect(await screen.findByText('One amount to settle first')).toBeInTheDocument();
  const logBtn = screen.getByRole('button', { name: /Log breakfast/ });
  expect(logBtn).toBeDisabled();
  // Asked as chips, never a keypad.
  expect(screen.getByText('how much?')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '1 cup' }));
  await waitFor(() => expect(setDraftAmount).toHaveBeenCalledWith('m1', 1, 1));
  await waitFor(() => expect(screen.queryByText('One amount to settle first')).toBeNull());
  expect(screen.getByRole('button', { name: /Log breakfast/ })).toBeEnabled();
});

it('logging calls closeMeal, refreshes the day, and hands off to onLogged', async () => {
  getOpenMeal.mockResolvedValue(mkMeal({ items: [item('Greek yogurt', 1, 146)] }));
  closeMeal.mockResolvedValue(mkMeal({ items: [item('Greek yogurt', 1, 146)], state: 'closed' }));
  const onLogged = vi.fn();
  const { onClose } = await mount({ onLogged });
  fireEvent.click(await screen.findByRole('button', { name: /Log breakfast/ }));
  await waitFor(() => expect(closeMeal).toHaveBeenCalledWith('m1'));
  expect(invalidate).toHaveBeenCalledTimes(1);
  expect(onLogged).toHaveBeenCalledTimes(1);
  expect(onClose).not.toHaveBeenCalled();
});

describe('a logged meal — the cart ruling', () => {
  it('reads LOGGED, offers Done instead of Log, and an add counts the moment it lands', async () => {
    openMealDraft.mockResolvedValue(mkMeal({ items: [item('Greek yogurt', 1, 146)], state: 'closed' }));
    appendFood.mockResolvedValue(
      mkMeal({ items: [item('Greek yogurt', 1, 146), item('Espresso', 1, 1)], state: 'closed' }),
    );
    getUsualAtSlot.mockResolvedValue([
      { kind: 'food', id: 'f-espresso', name: 'Espresso', serving_label: '1 capsule', kcal: 1, count: 2 },
    ]);
    const onLogged = vi.fn();
    await mount({ meal: 'breakfast', onLogged });
    expect(await screen.findByText('LOGGED')).toBeInTheDocument();
    // The chip says it; the old "anything you add counts right away" line added nothing
    // (owner, 2026-09-08) — with one loose row there is no hint to show either.
    expect(screen.queryByText(/counts right away/)).toBeNull();
    expect(screen.queryByText(/drag things together/)).toBeNull();
    expect(screen.queryByRole('button', { name: /Log breakfast/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Espresso/ }));
    await waitFor(() => expect(appendFood).toHaveBeenCalled());
    // No second review: the day refreshed on the add itself.
    await waitFor(() => expect(invalidate).toHaveBeenCalled());
    expect(closeMeal).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(onLogged).toHaveBeenCalledTimes(1);
  });
});

it("a row's words open its details — the macro card, the amount, and a way out", async () => {
  getOpenMeal.mockResolvedValue(
    mkMeal({
      items: [
        { ...item('Greek yogurt', 1, 146), brand: 'Fage', est: { kcal: 146, protein_g: 18, carbs_g: 7, fat_g: 4 } },
      ],
    }),
  );
  await mount();
  fireEvent.click(await screen.findByRole('button', { name: 'Details for Greek yogurt' }));
  const sheet = screen.getByRole('dialog', { name: 'Greek yogurt' });
  expect(within(sheet).getByText('Fage')).toBeInTheDocument();
  expect(within(sheet).getByText('PROTEIN')).toBeInTheDocument();
  expect(within(sheet).getByText('18 g')).toBeInTheDocument();
  fireEvent.click(within(sheet).getByRole('button', { name: 'Done' }));
  expect(screen.queryByRole('dialog', { name: 'Greek yogurt' })).toBeNull();
});

describe('B3 — four quick adds, offered once', () => {
  const foods = ['Greek yogurt', 'Chia seeds', 'Whey protein', 'Strawberries'];

  /** Add four unambiguous foods through the Find door, then come back to the meal. */
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
    fireEvent.click(screen.getByRole('button', { name: 'Find' }));
    const input = await screen.findByLabelText('Find a food');
    for (const f of foods) {
      fireEvent.change(input, { target: { value: f } });
      fireEvent.click(await screen.findByText(f, { selector: '.fq-row b' }));
      await waitFor(() => expect((input as HTMLInputElement).value).toBe(''));
    }
    // The keyboard goes (its ✓) and the full cart, Done included, is back.
    fireEvent.blur(input);
    fireEvent.click(await screen.findByRole('button', { name: 'Done · back to breakfast' }));
    await screen.findByText('Strawberries', { selector: '.fa-row-n b' });
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
    fireEvent.click(screen.getByRole('button', { name: /Add more/ }));
    const input = await screen.findByLabelText('Find a food');
    fireEvent.change(input, { target: { value: 'Oat latte' } });
    fireEvent.click(await screen.findByText('Oat latte', { selector: '.fq-row b' }));
    await waitFor(() => expect((input as HTMLInputElement).value).toBe(''));
    fireEvent.blur(input);
    fireEvent.click(await screen.findByRole('button', { name: 'Done · back to breakfast' }));
    await screen.findByText('Oat latte', { selector: '.fa-row-n b' });
    expect(screen.queryByText(/Do they go together\?/)).toBeNull();
  });

  it('two loose things put "Group … into a recipe" on the surface, no gesture needed', async () => {
    getOpenMeal.mockResolvedValue(mkMeal({ items: [item('Greek yogurt'), item('Chia seeds')] }));
    await mount();
    await screen.findByText('Greek yogurt');
    // …and the header's one line says how (owner, 2026-09-08: "no indication that you can group").
    expect(screen.getByText(/drag things together to make a recipe/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Group some of these into a recipe/ }));
    // Select mode is up — the rows are tickable now.
    expect(await screen.findByRole('dialog', { name: 'Group things' })).toBeInTheDocument();
  });
});

it('the ⋯ menu carries the boring twins, and "Log it now" logs', async () => {
  getOpenMeal.mockResolvedValue(mkMeal({ items: [item('Greek yogurt'), item('Chia seeds')] }));
  closeMeal.mockResolvedValue(null);
  const { onClose } = await mount();
  await screen.findByText('Greek yogurt');
  fireEvent.click(screen.getByRole('button', { name: 'More for this meal' }));
  const sheet = screen.getByRole('dialog', { name: 'This meal' });
  expect(within(sheet).getByText('Save as a meal')).toBeInTheDocument();
  expect(within(sheet).getByText('Save as a recipe')).toBeInTheDocument();
  expect(within(sheet).getByText('Rename this meal')).toBeInTheDocument();
  fireEvent.click(within(sheet).getByText('Log it now'));
  await waitFor(() => expect(closeMeal).toHaveBeenCalledWith('m1'));
  expect(onClose).toHaveBeenCalled();
});
