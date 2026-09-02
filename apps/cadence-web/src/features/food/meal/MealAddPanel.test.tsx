/**
 * B2's promises, driven through the real panel (canvas turn-3 B2): ＋ adds at the food's own
 * default serving and never opens a sheet for an unambiguous food; an ambiguous one opens the
 * repriced sheet whose button says "Add to breakfast"; the field clears and keeps focus after
 * every add; and Undo pulls the last add straight back out.
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { Food } from '@cadence/shared';
import type { Meal } from '../../../lib/api/meal-draft.ts';

const openMealDraft = vi.fn();
const getOpenMeal = vi.fn();
const appendFood = vi.fn();
const removeDraftItem = vi.fn();
const setDraftAmount = vi.fn();

vi.mock('../../../lib/api/meal-draft.ts', () => ({
  openMealDraft: (...a: unknown[]) => openMealDraft(...a),
  getOpenMeal: (...a: unknown[]) => getOpenMeal(...a),
  appendFood: (...a: unknown[]) => appendFood(...a),
  appendRecipe: vi.fn(),
  appendParsed: vi.fn(),
  removeDraftItem: (...a: unknown[]) => removeDraftItem(...a),
  setDraftAmount: (...a: unknown[]) => setDraftAmount(...a),
  setDraftMeal: vi.fn(),
  closeMeal: vi.fn(),
  editMealParts: vi.fn(),
  savePartAsRecipe: vi.fn(),
}));

vi.mock('../../../lib/query/index.ts', () => ({
  useInvalidateNutritionDay: () => vi.fn(),
  useNutritionDay: () => ({ data: null }),
}));

const searchFoods = vi.fn();
const getFoodRecents = vi.fn();
const getFoodById = vi.fn();

vi.mock('../../../lib/api.ts', () => ({
  searchFoods: (...a: unknown[]) => searchFoods(...a),
  getFoodRecents: (...a: unknown[]) => getFoodRecents(...a),
  getFoodById: (...a: unknown[]) => getFoodById(...a),
}));

const { useMealDraft } = await import('./useMealDraft.ts');
const { MealAddPanel } = await import('./MealAddPanel.tsx');

const mkMeal = (over: Partial<Meal> = {}): Meal => ({
  log_id: 'm1',
  date: '2026-09-02',
  meal: 'breakfast',
  items: [],
  macros: {},
  input_method: 'manual',
  state: 'open',
  closes_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
  ...over,
});

const granola: Food = {
  food_id: 'f-granola',
  owner_user_id: null,
  visibility: 'private',
  name: 'Granola, maple pecan',
  brand: null,
  source: 'manual',
  off_id: null,
  fdc_id: null,
  base_unit: 'g',
  macros_per_base: { kcal: 4.5, protein_g: 0.1 },
  servings: [
    { label: '1 cup', unit: 'cup', amount_g: 60 },
    { label: '100 g', unit: 'g', amount_g: 100 },
  ],
  default_serving: 0,
  confidence: null,
  photo_ref: null,
};

function Harness({ onDone }: { onDone?: () => void }) {
  const draft = useMealDraft('breakfast');
  if (draft.loading) return null;
  return <MealAddPanel draft={draft} onDone={onDone ?? (() => {})} />;
}

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  getOpenMeal.mockResolvedValue(mkMeal());
  getFoodRecents.mockResolvedValue({ status: 'ok', foods: [] });
  searchFoods.mockResolvedValue({ status: 'ok', foods: [] });
});

async function openPanel() {
  render(<Harness />);
  return await screen.findByLabelText('Search foods');
}

it('＋ adds an unambiguous food at its default serving — no sheet, field cleared, focus kept', async () => {
  searchFoods.mockResolvedValue({
    status: 'ok',
    foods: [{ food_id: 'f-yog', name: 'Greek yogurt, plain 2%', brand: null, serving_label: '1 cup', ambiguous: false }],
  });
  appendFood.mockResolvedValue(
    mkMeal({ items: [{ name: 'Greek yogurt, plain 2%', qty: 1, unit: 'cup', est: { kcal: 146 }, food_id: 'f-yog' }] }),
  );
  const input = await openPanel();
  fireEvent.change(input, { target: { value: 'yog' } });
  fireEvent.click(await screen.findByText('Greek yogurt, plain 2%'));
  await waitFor(() => expect(appendFood).toHaveBeenCalledWith('m1', { food_id: 'f-yog' }));
  // Never a sheet for the unambiguous — one tap was the whole flow.
  expect(screen.queryByText('Serving size')).toBeNull();
  expect(getFoodById).not.toHaveBeenCalled();
  // The field clears, the keyboard stays.
  await waitFor(() => expect((input as HTMLInputElement).value).toBe(''));
  expect(document.activeElement).toBe(input);
  // …and the add morphed into a stepper in place.
  expect(await screen.findByText('JUST ADDED · TAP TO ADJUST')).toBeInTheDocument();
  expect(screen.getByLabelText('More Greek yogurt, plain 2%')).toBeInTheDocument();
});

it('an ambiguous food opens the repriced sheet — "Add to breakfast" — and returns to search', async () => {
  searchFoods.mockResolvedValue({
    status: 'ok',
    foods: [{ food_id: 'f-granola', name: 'Granola, maple pecan', brand: null, serving_label: null, ambiguous: true }],
  });
  getFoodById.mockResolvedValue({ status: 'ok', food: granola });
  appendFood.mockResolvedValue(
    mkMeal({ items: [{ name: 'Granola, maple pecan', qty: 1, unit: 'cup', est: { kcal: 270 }, food_id: 'f-granola' }] }),
  );
  const input = await openPanel();
  fireEvent.change(input, { target: { value: 'gran' } });
  // The row says it will ask first, and its glyph is ›, not ＋.
  expect(await screen.findByText(/several serving sizes · asks first/)).toBeInTheDocument();
  fireEvent.click(screen.getByText('Granola, maple pecan'));
  const addBtn = await screen.findByRole('button', { name: 'Add to breakfast' });
  expect(screen.getByText("You'll come straight back here for the next one.")).toBeInTheDocument();
  // The draft owns the slot — the sheet asks no meal question.
  expect(screen.queryByLabelText('Meal')).toBeNull();
  fireEvent.click(addBtn);
  await waitFor(() =>
    expect(appendFood).toHaveBeenCalledWith('m1', { food_id: 'f-granola', serving_index: 0, quantity: 1 }),
  );
  // The sheet returned to search rather than dismissing the panel.
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Add to breakfast' })).toBeNull());
  expect(document.activeElement).toBe(input);
  expect((input as HTMLInputElement).value).toBe('');
});

it('Undo pulls the last add straight back out', async () => {
  getOpenMeal.mockResolvedValue(mkMeal({ items: [{ name: 'Chia seeds', qty: 1, unit: 'tbsp', est: { kcal: 58 } }] }));
  removeDraftItem.mockResolvedValue(mkMeal({ items: [] }));
  await openPanel();
  expect(screen.getByText(/1 thing/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Undo last' }));
  await waitFor(() => expect(removeDraftItem).toHaveBeenCalledWith('m1', 0));
});

it('the strip says exactly "not counted yet" — added is not logged', async () => {
  getOpenMeal.mockResolvedValue(mkMeal({ items: [{ name: 'Chia seeds', qty: 1, unit: 'tbsp', est: { kcal: 58 } }] }));
  await openPanel();
  expect(screen.getByText(/58 kcal · not counted yet/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Done · back to breakfast' })).toBeInTheDocument();
});
