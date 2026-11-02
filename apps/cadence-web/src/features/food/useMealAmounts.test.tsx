/**
 * The card's answer step through the hook itself (review of #460): an answer lands on the row it
 * was asked of, found by the row and never by its index — so a row removed above it while the
 * re-read runs, a second answer landing first, or a two-row answer on a middle row cannot put the
 * milk where the eggs were. Plus what the answer brings with it: the re-ask count, its flags, and
 * whether the coach was reached.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, act, cleanup } from '@testing-library/react';
import type { MealPreview } from '../../lib/api.ts';

const api = vi.hoisted(() => ({ previewMealAnswer: vi.fn() }));
vi.mock('../../lib/api.ts', () => api);

const { useMealAmounts } = await import('./useMealAmounts.ts');

type Item = MealPreview['items'][number];
const ask = (name: string, asked_about = name): Item => ({
  name,
  question: `Which ${name}?`,
  choices: ['A', 'B'],
  asked_about,
  basis: 'none',
});
const priced = (name: string, kcal: number, over: Partial<Item> = {}): Item => ({
  name,
  qty: 1,
  unit: 'cup',
  est: { kcal },
  food_id: `f-${name}`,
  said: name,
  basis: 'record',
  ...over,
});
const card = (items: Item[], flags: MealPreview['flags'] = {}): MealPreview => ({
  meal: 'breakfast',
  raw_text: items.map((i) => i.name).join(', '),
  items,
  macros: null,
  confidence: null,
  flags,
  coach: { reached: true, calls: 1, checked: [] },
});
const answer = (items: Item[], over: Partial<MealPreview> = {}): MealPreview => ({ ...card(items), ...over });

/** A re-read the test settles by hand. */
function pending() {
  let resolve!: (p: MealPreview) => void;
  const promise = new Promise<MealPreview>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('useMealAmounts.answerRow — the answer lands on the row it was asked of', () => {
  it('a row removed ABOVE it while the re-read runs: the priced row still replaces the asked one', async () => {
    const re = pending();
    api.previewMealAnswer.mockReturnValueOnce(re.promise);
    const { result } = renderHook(() => useMealAmounts(card([priced('eggs', 144), ask('milk')])));

    let out!: Promise<string>;
    act(() => {
      out = result.current.answerRow(1, 'A', true, 'breakfast');
    });
    expect(result.current.answering).toBe(true);
    act(() => result.current.removeRow(0));
    await act(async () => {
      re.resolve(answer([priced('whole milk', 149)]));
      expect(await out).toBe('replaced');
    });
    expect(result.current.rows.map((r) => r.name)).toEqual(['whole milk']);
    expect(result.current.answering).toBe(false);
  });

  it('the asked row itself removed meanwhile: nothing is inserted, and the answer says it failed', async () => {
    const re = pending();
    api.previewMealAnswer.mockReturnValueOnce(re.promise);
    const { result } = renderHook(() => useMealAmounts(card([priced('eggs', 144), ask('milk')])));
    let out!: Promise<string>;
    act(() => {
      out = result.current.answerRow(1, 'A', true);
    });
    act(() => result.current.removeRow(1));
    await act(async () => {
      re.resolve(answer([priced('whole milk', 149)]));
      expect(await out).toBe('failed');
    });
    expect(result.current.rows.map((r) => r.name)).toEqual(['eggs']);
  });

  it('two overlapping answers: the second lands first, then the first — each on its own row', async () => {
    const first = pending();
    const second = pending();
    api.previewMealAnswer.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const { result } = renderHook(() => useMealAmounts(card([ask('milk'), priced('toast', 80), ask('coffee')])));
    let a!: Promise<string>;
    let b!: Promise<string>;
    act(() => {
      a = result.current.answerRow(0, 'A', true);
    });
    act(() => {
      b = result.current.answerRow(2, 'B', true);
    });
    // The coffee answer comes back first, as TWO rows: the milk row's index would now be wrong
    // for anything that counted positions.
    await act(async () => {
      second.resolve(answer([priced('black coffee', 2), priced('sugar', 16)]));
      await b;
    });
    await act(async () => {
      first.resolve(answer([priced('whole milk', 149)]));
      await a;
    });
    expect(result.current.rows.map((r) => r.name)).toEqual(['whole milk', 'toast', 'black coffee', 'sugar']);
  });

  it('a two-row answer on a MIDDLE row keeps the order around it', async () => {
    api.previewMealAnswer.mockResolvedValueOnce(answer([priced('latte', 190), priced('oat milk', 40)]));
    const { result } = renderHook(() => useMealAmounts(card([priced('eggs', 144), ask('latte'), priced('toast', 80)])));
    await act(async () => {
      await result.current.answerRow(1, 'A', true);
    });
    expect(result.current.rows.map((r) => r.name)).toEqual(['eggs', 'latte', 'oat milk', 'toast']);
    expect(result.current.total.kcal).toBe(454);
  });
});

describe('useMealAmounts.answerRow — what the answer brings with it', () => {
  it('a question again counts the re-ask and counts nothing; the open count holds it as a question', async () => {
    api.previewMealAnswer.mockResolvedValueOnce(
      answer([{ ...ask('whole milk', 'milk'), choices: ['Full-fat', 'Light'] }]),
    );
    const { result } = renderHook(() => useMealAmounts(card([ask('milk'), priced('eggs', 144)])));
    await act(async () => {
      await result.current.answerRow(0, 'A', true);
    });
    expect(result.current.rows[0]).toMatchObject({
      question: 'Which whole milk?',
      choices: ['Full-fat', 'Light'],
      reasks: 1,
    });
    expect(result.current.total.kcal).toBe(144);
    expect(result.current.askedChoices).toBe(1);
  });

  it('at the re-ask cap the row is an amount question: it no longer counts as one with choices', async () => {
    api.previewMealAnswer.mockResolvedValue(answer([ask('milk')]));
    const { result } = renderHook(() => useMealAmounts(card([ask('milk')])));
    await act(async () => {
      await result.current.answerRow(0, 'A', true);
    });
    await act(async () => {
      await result.current.answerRow(0, 'A', true);
    });
    expect(result.current.rows[0]?.reasks).toBe(2);
    expect(result.current.asked).toBe(1);
    expect(result.current.askedChoices).toBe(0);
  });

  it("the answer's flags join the card's: a drink answered as a gin and tonic logs with the alcohol flag", async () => {
    api.previewMealAnswer.mockResolvedValueOnce(answer([priced('gin and tonic', 170)], { flags: { alcohol: true } }));
    const { result } = renderHook(() => useMealAmounts(card([ask('a drink')], { caffeine: true })));
    await act(async () => {
      await result.current.answerRow(0, 'B', true);
    });
    expect(result.current.toPreview().flags).toEqual({ caffeine: true, alcohol: true });
  });

  it('near-miss: an answer with no flags takes none away', async () => {
    api.previewMealAnswer.mockResolvedValueOnce(answer([priced('whole milk', 149)]));
    const { result } = renderHook(() => useMealAmounts(card([ask('milk')], { caffeine: true })));
    await act(async () => {
      await result.current.answerRow(0, 'A', true);
    });
    expect(result.current.toPreview().flags).toEqual({ caffeine: true });
  });

  it('an answer the coach could not read is flagged, and its row keeps its automatic-estimate label', async () => {
    api.previewMealAnswer.mockResolvedValueOnce(
      answer([priced('whole milk', 150, { basis: 'fallback', source_label: 'an automatic estimate' })], {
        coach: { reached: false, calls: 1, checked: [] },
      }),
    );
    const { result } = renderHook(() => useMealAmounts(card([ask('milk')])));
    expect(result.current.answerNotReached).toBe(false);
    await act(async () => {
      await result.current.answerRow(0, 'A', true);
    });
    expect(result.current.answerNotReached).toBe(true);
    expect(result.current.rows[0]).toMatchObject({ basis: 'fallback', source_label: 'an automatic estimate' });
  });

  it.each<[string, unknown, string]>([
    ['a 400 is a refusal: different words are needed', Object.assign(new Error('400'), { status: 400 }), 'rejected'],
    ['a 500 is a failure: the same words can go again', Object.assign(new Error('500'), { status: 500 }), 'failed'],
    ['a network error is a failure', new TypeError('Failed to fetch'), 'failed'],
  ])('%s', async (_label, error, said) => {
    api.previewMealAnswer.mockRejectedValueOnce(error);
    const { result } = renderHook(() => useMealAmounts(card([ask('milk')])));
    let out = '';
    await act(async () => {
      out = await result.current.answerRow(0, 'A', true);
    });
    expect(out).toBe(said);
    expect(result.current.rows[0]).toMatchObject({ question: 'Which milk?' });
    expect(result.current.answering).toBe(false);
  });
});

describe('useMealAmounts — the weight of a measure belongs to that measure', () => {
  it('keeps grams_each through a new amount, drops it when the unit changes', () => {
    const { result } = renderHook(() =>
      useMealAmounts(card([priced('spanakopita', 254, { unit: 'regular/large', grams_each: 120 })])),
    );
    expect(result.current.rows[0]!.grams_each).toBe(120);
    act(() => result.current.setQty(0, 2));
    expect(result.current.rows[0]!.grams_each).toBe(120);
    act(() => result.current.setQty(0, 2, 'regular/large'));
    expect(result.current.rows[0]!.grams_each).toBe(120);
    act(() => result.current.setQty(0, 240, 'g'));
    expect(result.current.rows[0]!.grams_each).toBeUndefined();
  });
});
