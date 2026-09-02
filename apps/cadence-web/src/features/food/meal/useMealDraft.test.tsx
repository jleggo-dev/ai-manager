/**
 * The draft client's contract (P4): rejoin-before-open, provenance on appends, the optimistic
 * stepper, the close invalidating the day — and the 409 rule from the P1 addendum: a window
 * that shut under us reopens once and retries once, then the error is surfaced plainly.
 */
import { act, renderHook, waitFor } from '@testing-library/react';
import type { Meal } from '../../../lib/api/meal-draft.ts';

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
const savePartAsRecipe = vi.fn();

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
  savePartAsRecipe: (...a: unknown[]) => savePartAsRecipe(...a),
}));

const invalidate = vi.fn();
vi.mock('../../../lib/query/index.ts', () => ({
  useInvalidateNutritionDay: () => invalidate,
  useNutritionDay: () => ({ data: null }),
}));

const { useMealDraft } = await import('./useMealDraft.ts');

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

const yogurt = { name: 'Greek yogurt', qty: 1, unit: 'cup', est: { kcal: 100, protein_g: 10 } };

async function mount(initial?: 'breakfast') {
  const hook = renderHook(() => useMealDraft(initial));
  await waitFor(() => expect(hook.result.current.loading).toBe(false));
  return hook;
}

beforeEach(() => {
  vi.clearAllMocks();
  getOpenMeal.mockResolvedValue(null);
  openMealDraft.mockResolvedValue(mkMeal());
  invalidate.mockResolvedValue(undefined);
});

describe('open and rejoin', () => {
  it('rejoins the one open window instead of opening a second', async () => {
    getOpenMeal.mockResolvedValue(mkMeal({ items: [yogurt] }));
    const { result } = await mount('breakfast');
    expect(openMealDraft).not.toHaveBeenCalled();
    expect(result.current.items).toHaveLength(1);
    expect(result.current.openLabel).toMatch(/^OPEN/);
  });

  it('opens a draft for the slot when nothing is open', async () => {
    const { result } = await mount('breakfast');
    expect(openMealDraft).toHaveBeenCalledWith({ meal: 'breakfast' });
    expect(result.current.meal?.log_id).toBe('m1');
  });
});

describe('appends and provenance', () => {
  it('tags an appended food with the door it came through', async () => {
    appendFood.mockResolvedValue(mkMeal({ items: [yogurt] }));
    const { result } = await mount('breakfast');
    await act(async () => {
      await result.current.appendFood({ food_id: 'f1' }, 'searched');
    });
    expect(appendFood).toHaveBeenCalledWith('m1', { food_id: 'f1' });
    expect(result.current.provenance(0)).toBe('searched');
  });

  it('marks a parser-supplied amount ASSUMED and keeps the raw words', async () => {
    appendParsed.mockResolvedValue(mkMeal({ items: [{ ...yogurt, name: 'chia seeds', qty: 1, unit: 'tbsp' }] }));
    const { result } = await mount('breakfast');
    await act(async () => {
      await result.current.appendParsed([{ name: 'chia seeds', qty: 1, unit: 'tbsp' }], 'typed', 'some chia seeds');
    });
    expect(result.current.provenance(0)).toBe('assumed');
    expect(result.current.rawTexts).toEqual(['some chia seeds']);
  });
});

describe('the 409 window rule', () => {
  it('reopens and retries the append exactly once', async () => {
    appendFood
      .mockRejectedValueOnce(new Error('POST /nutrition/meals/m1/items → 409'))
      .mockResolvedValueOnce(mkMeal({ log_id: 'm2', items: [yogurt] }));
    openMealDraft.mockResolvedValueOnce(mkMeal()).mockResolvedValueOnce(mkMeal({ log_id: 'm2' }));
    const { result } = await mount('breakfast');
    await act(async () => {
      await result.current.appendFood({ food_id: 'f1' }, 'searched');
    });
    expect(appendFood).toHaveBeenNthCalledWith(1, 'm1', { food_id: 'f1' });
    expect(appendFood).toHaveBeenNthCalledWith(2, 'm2', { food_id: 'f1' });
    expect(result.current.meal?.log_id).toBe('m2');
    expect(result.current.items).toHaveLength(1);
    expect(result.current.err).toBe('');
  });

  it('surfaces the error when the retry fails too', async () => {
    appendFood
      .mockRejectedValueOnce(new Error('POST /nutrition/meals/m1/items → 409'))
      .mockRejectedValueOnce(new Error('POST /nutrition/meals/m2/items → 500'));
    openMealDraft.mockResolvedValueOnce(mkMeal()).mockResolvedValueOnce(mkMeal({ log_id: 'm2' }));
    const { result } = await mount('breakfast');
    let out: Meal | null = mkMeal();
    await act(async () => {
      out = await result.current.appendFood({ food_id: 'f1' }, 'searched');
    });
    expect(out).toBeNull();
    expect(appendFood).toHaveBeenCalledTimes(2);
    expect(result.current.err).not.toBe('');
  });
});

describe('amounts and the close', () => {
  it('steps optimistically and reconciles to the server rescale', async () => {
    getOpenMeal.mockResolvedValue(mkMeal({ items: [yogurt] }));
    let resolveServer!: (m: Meal) => void;
    setDraftAmount.mockImplementation(() => new Promise((r) => (resolveServer = r)));
    const { result } = await mount();
    act(() => {
      result.current.setAmount(0, 2);
    });
    // Before the server answers: the row already reads 2, with its estimate scaled.
    expect(result.current.items[0]?.qty).toBe(2);
    expect(result.current.items[0]?.est?.kcal).toBe(200);
    await act(async () => {
      resolveServer(mkMeal({ items: [{ ...yogurt, qty: 2, est: { kcal: 201 } }] }));
    });
    expect(result.current.items[0]?.est?.kcal).toBe(201);
    expect(setDraftAmount).toHaveBeenCalledWith('m1', 0, 2);
  });

  it('closeMeal is the one write that refreshes the day', async () => {
    getOpenMeal.mockResolvedValue(mkMeal({ items: [yogurt] }));
    closeMeal.mockResolvedValue(mkMeal({ items: [yogurt], state: 'closed' }));
    const { result } = await mount();
    await act(async () => {
      const r = await result.current.close();
      expect(r.ok).toBe(true);
    });
    expect(closeMeal).toHaveBeenCalledWith('m1');
    expect(invalidate).toHaveBeenCalledTimes(1);
  });
});

describe('grouping takes the key from the server', () => {
  /**
   * Regression, first live walkthrough (2026-09-02): part keys are minted SERVER-side
   * (randomUUID slice), so a client that predicts one groups fine and then saves against a key
   * the server never issued — 400 "no such part", name and cookbook save silently lost. The
   * mock's key is deliberately nothing a client would guess.
   */
  it('resolves with the server-minted part key, not a client guess', async () => {
    getOpenMeal.mockResolvedValue(mkMeal({ items: [yogurt, { ...yogurt, name: 'Chia seeds' }] }));
    editMealParts.mockResolvedValue(
      mkMeal({
        items: [
          { ...yogurt, part: 'zz93kq1x' },
          { ...yogurt, name: 'Chia seeds', part: 'zz93kq1x' },
        ],
        parts: [{ key: 'zz93kq1x', name: null, source: 'user' }],
      }),
    );
    const { result } = await mount();
    let key: string | null = null;
    await act(async () => {
      key = await result.current.groupLoose([0, 1]);
    });
    expect(key).toBe('zz93kq1x');
  });
});
