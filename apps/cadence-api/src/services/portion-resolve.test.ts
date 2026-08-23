import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Food } from '@cadence/shared';

/**
 * The shallots rung, end to end without a model.
 *
 * Two properties matter more than the happy path. First, that a bought answer is KEPT — the whole
 * economic argument for paying a model to convert a measure is that you only pay once, and a
 * lookup that is not written back is a lookup you will make again forever.
 *
 * Second, that a refusal is REPORTED. The owner's question was exactly this: when the guard throws
 * a number away, does anyone tell her? A silent `null` here would put the Coach in the position of
 * having asked, been answered, had the answer refused, and having no idea any of it happened — so
 * she would either invent a weight or claim the food is unknown. Both are lies, and the second is
 * the one that has bitten this codebase before.
 */

const runJobBySlug = vi.hoisted(() => vi.fn());
const getFood = vi.hoisted(() => vi.fn());
const appendFoodServing = vi.hoisted(() => vi.fn());
const logAi = vi.hoisted(() => vi.fn());

vi.mock('../ai/aim.ts', () => ({ runJobBySlug }));
vi.mock('../repos/foods.ts', () => ({ getFood, appendFoodServing }));
vi.mock('./ai-log.ts', () => ({ logAi }));

const { resolvePortion, servingFor } = await import('./portion-resolve.ts');
const { parseMeasure } = await import('./portion-measure.ts');

const shallots = (over: Partial<Food> = {}): Food =>
  ({
    food_id: 'usda-shallots',
    owner_user_id: null,
    visibility: 'public',
    name: 'Shallots, raw',
    brand: null,
    source: 'usda',
    base_unit: 'g',
    macros_per_base: { kcal: 72, protein_g: 2.5, carbs_g: 16.8, fat_g: 0.1 },
    servings: [{ label: '100 g', unit: 'g', amount_g: 100 }],
    default_serving: 0,
    ...over,
  }) as Food;

const answers = (grams: number, basis = 'a medium shallot is about 25 g peeled') =>
  runJobBySlug.mockResolvedValue({ formatted: JSON.stringify({ grams, basis, confidence: 0.9 }) });

beforeEach(() => {
  for (const m of [runJobBySlug, getFood, appendFoodServing, logAi]) m.mockReset();
  getFood.mockResolvedValue(shallots());
  appendFoodServing.mockResolvedValue(shallots());
  logAi.mockResolvedValue(undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('it does not buy what it already has', () => {
  it('answers from the food itself when the measure is on file, and calls nothing', async () => {
    getFood.mockResolvedValue(
      shallots({ servings: [{ label: '1/4 cup', unit: 'cup', amount_g: 40 }], default_serving: 0 }),
    );
    const r = await resolvePortion('u1', { foodId: 'usda-shallots', measure: '1/4 cup' });

    expect(r.status).toBe('known');
    expect(r).toMatchObject({ grams: 40 });
    expect(runJobBySlug).not.toHaveBeenCalled();
  });

  it('multiplies a known single measure by the quantity asked for', async () => {
    getFood.mockResolvedValue(
      shallots({ servings: [{ label: '1 shallot', unit: 'item', amount_g: 25 }], default_serving: 0 }),
    );
    const r = await resolvePortion('u1', { foodId: 'usda-shallots', measure: '3 shallot' });
    expect(r).toMatchObject({ status: 'known', grams: 75 });
  });

  it('recognises a measure that is already a weight and asks no one', async () => {
    const r = await resolvePortion('u1', { foodId: 'usda-shallots', measure: '680 g' });

    expect(r.status).toBe('already_mass');
    expect(r).toMatchObject({ grams: 680 });
    expect(runJobBySlug).not.toHaveBeenCalled();
  });
});

describe('what it buys, it keeps', () => {
  it('looks up an unknown measure and writes it back onto the food', async () => {
    answers(40, 'USDA lists 1 cup chopped shallots at 160 g');
    const r = await resolvePortion('u1', { foodId: 'usda-shallots', measure: '1/4 cup' });

    expect(r).toMatchObject({ status: 'looked_up', grams: 40, stored: true });
    expect(appendFoodServing).toHaveBeenCalledOnce();
    expect(runJobBySlug).toHaveBeenCalledWith(
      'u1',
      'resolve-portion',
      expect.objectContaining({ measure_text: '1/4 cup', measure_ml: '59.15' }),
    );
  });

  /** Stored per single unit, so the row reads "1 cup = 160 g" however much was asked about. */
  it('stores the single-unit weight, not the quantity that happened to be asked', async () => {
    answers(75);
    await resolvePortion('u1', { foodId: 'usda-shallots', measure: '3 shallots' });

    const [, serving] = appendFoodServing.mock.calls[0] as [string, { label: string; amount_g: number }];
    expect(serving.amount_g).toBeCloseTo(25, 1);
    expect(serving.label).toContain('1');
  });

  it('still answers when the write-back fails, and says the answer was not kept', async () => {
    answers(40);
    appendFoodServing.mockRejectedValue(new Error('db down'));

    const r = await resolvePortion('u1', { foodId: 'usda-shallots', measure: '1/4 cup' });
    expect(r).toMatchObject({ status: 'looked_up', grams: 40, stored: false });
  });

  it('sends the volume along so the model can check its own density', async () => {
    answers(15);
    await resolvePortion('u1', { foodId: 'usda-shallots', measure: '1 cup' });
    expect(runJobBySlug.mock.calls[0]?.[2]).toMatchObject({ measure_ml: '236.59' });
  });
});

describe('a refusal is reported, never swallowed', () => {
  it('rejects an impossible weight and says why, instead of returning nothing', async () => {
    answers(5000);
    const r = await resolvePortion('u1', { foodId: 'usda-shallots', measure: '1/4 cup' });

    expect(r.status).toBe('unresolved');
    expect(r).toMatchObject({ reason: expect.stringContaining('refused') });
    expect((r as { reason: string }).reason).toContain('g/ml');
    // And critically: the bad number never reached the food.
    expect(appendFoodServing).not.toHaveBeenCalled();
  });

  it('distinguishes "nothing came back" from "what came back was refused"', async () => {
    runJobBySlug.mockResolvedValue({ formatted: '{"grams": 0}' });
    const empty = await resolvePortion('u1', { foodId: 'usda-shallots', measure: '1/4 cup' });
    expect((empty as { reason: string }).reason).toContain('no usable weight');
    expect((empty as { reason: string }).reason).not.toContain('refused');
  });

  it('survives a job that throws, and says so rather than claiming the food is unknown', async () => {
    runJobBySlug.mockRejectedValue(new Error('provider 503'));
    const r = await resolvePortion('u1', { foodId: 'usda-shallots', measure: '1/4 cup' });

    expect(r.status).toBe('unresolved');
    expect(r.food).not.toBeNull();
  });

  it('says the food is missing only when the food is actually missing', async () => {
    getFood.mockResolvedValue(null);
    const r = await resolvePortion('u1', { foodId: 'nope', measure: '1/4 cup' });
    expect(r).toMatchObject({ status: 'unresolved', food: null, reason: 'no such food on file' });
  });

  it('never lets a nutrient in through the grams field', async () => {
    runJobBySlug.mockResolvedValue({ formatted: JSON.stringify({ grams: 40, kcal: 999, protein_g: 12 }) });
    const r = await resolvePortion('u1', { foodId: 'usda-shallots', measure: '1/4 cup' });

    expect(r).toMatchObject({ status: 'looked_up', grams: 40 });
    expect(JSON.stringify(r)).not.toContain('999');
  });
});

describe('servingFor', () => {
  it('keeps the measure word so the same phrase matches next time', () => {
    expect(servingFor(parseMeasure('1 cup'), 160)).toEqual({ label: '1 cup', unit: 'cup', amount_g: 160 });
  });

  it('files a count as an item', () => {
    expect(servingFor(parseMeasure('1 shallot'), 25)).toMatchObject({ unit: 'item', amount_g: 25 });
  });
});
