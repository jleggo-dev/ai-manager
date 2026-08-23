/**
 * The research rung's place in the waterfall — when it fires, when it must not, what it pins.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Food } from '@cadence/shared';

vi.mock('./food-resolver.ts', () => ({
  loadResolveShared: vi.fn(),
  rankedFoodsFor: vi.fn(),
}));
vi.mock('../repos/foods.ts', () => ({
  insertFood: vi.fn(),
  searchFoods: vi.fn(async () => []),
  touchFoodUsage: vi.fn(async () => undefined),
}));
vi.mock('./food-capture.ts', () => ({ estimateFood: vi.fn() }));
vi.mock('./food-research.ts', async (orig) => ({
  ...(await orig()),
  researchFood: vi.fn(),
}));

import { loadResolveShared, rankedFoodsFor, type ResolveShared } from './food-resolver.ts';
import { insertFood } from '../repos/foods.ts';
import { researchFood } from './food-research.ts';
import { priceMealItems } from './food-pricing.ts';

const USER = '00000000-0000-4000-a000-00000000a302';

const researchedFood: Food = {
  food_id: '',
  owner_user_id: null,
  visibility: 'private',
  name: 'Dill Pickle Peanuts',
  brand: 'The Carolina Nut Co.',
  source: 'research',
  off_id: null,
  fdc_id: null,
  base_unit: 'g',
  macros_per_base: { kcal: 607, protein_g: 25, carbs_g: 25, fat_g: 46.4, sodium_mg: 821 },
  servings: [
    { label: '1 oz (28g)', unit: '1 oz (28g)', amount_g: 28 },
    { label: '100 g', unit: 'g', amount_g: 100 },
  ],
  default_serving: 0,
  confidence: 0.85,
  photo_ref: null,
};

function shared(): ResolveShared {
  return {
    ctx: { userId: USER, useCountById: new Map(), recentRankById: new Map() },
    recents: [],
    frequents: [],
    profile: null,
  } as unknown as ResolveShared;
}

beforeEach(() => {
  vi.mocked(loadResolveShared).mockResolvedValue(shared());
  vi.mocked(rankedFoodsFor).mockResolvedValue([]); // every deterministic rung misses
  vi.mocked(researchFood).mockReset();
  vi.mocked(insertFood).mockReset();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'info').mockImplementation(() => {});
});

describe('the research rung', () => {
  it('fires for a vendor-named miss at PREVIEW, and the card gets final numbers, marked', async () => {
    vi.mocked(researchFood).mockResolvedValue({ food: researchedFood, source_url: 'https://x.com/l' });
    const out = await priceMealItems(
      USER,
      [{ name: 'dill pickle peanuts', brand: 'Couche-Tard', qty: 35.5, unit: 'g' }],
      { pin: false },
    );
    expect(researchFood).toHaveBeenCalledTimes(1);
    const item = out.items[0]!;
    // 607 per 100g × 35.5g — the card shows what the log will pin, so confirm-first holds.
    expect(item.est).toMatchObject({ source: 'research' });
    expect(item.est!.kcal).toBeCloseTo(215.5, 0);
    expect(insertFood).not.toHaveBeenCalled(); // preview writes nothing
  });

  it('never fires without a vendor — the expensive rung needs the strong signal', async () => {
    await priceMealItems(USER, [{ name: 'an apple' }], { pin: false });
    expect(researchFood).not.toHaveBeenCalled();
  });

  it('never asks twice — the marker from the card suppresses it, and the pin says research', async () => {
    vi.mocked(insertFood).mockImplementation(
      async (_u, input) => ({ ...researchedFood, ...input, food_id: 'pinned-1' }) as Food,
    );
    const out = await priceMealItems(
      USER,
      [
        {
          name: 'dill pickle peanuts',
          brand: 'Couche-Tard',
          qty: 35.5,
          unit: 'g',
          est: { kcal: 215, protein_g: 9, carbs_g: 9, fat_g: 16, sodium_mg: 291, source: 'research' },
        },
      ],
      { pin: true },
    );
    expect(researchFood).not.toHaveBeenCalled();
    expect(insertFood).toHaveBeenCalledWith(USER, expect.objectContaining({ source: 'research' }));
    expect(out.items[0]!.food_id).toBe('pinned-1');
  });

  it('pins the researched SHAPE when research ran in the same call — label serving intact', async () => {
    vi.mocked(researchFood).mockResolvedValue({ food: researchedFood, source_url: null });
    vi.mocked(insertFood).mockImplementation(
      async (_u, input) => ({ ...researchedFood, ...input, food_id: 'pinned-2' }) as Food,
    );
    await priceMealItems(USER, [{ name: 'dill pickle peanuts', brand: 'Couche-Tard', qty: 35.5, unit: 'g' }], {
      pin: true,
    });
    expect(insertFood).toHaveBeenCalledWith(
      USER,
      expect.objectContaining({
        source: 'research',
        macros_per_base: expect.objectContaining({ kcal: 607 }),
        servings: expect.arrayContaining([expect.objectContaining({ amount_g: 28 })]),
      }),
    );
  });

  it('falls through to the estimate pin when research returns nothing', async () => {
    vi.mocked(researchFood).mockResolvedValue(null);
    vi.mocked(insertFood).mockImplementation(
      async (_u, input) => ({ ...researchedFood, ...input, food_id: 'pinned-3' }) as Food,
    );
    const out = await priceMealItems(
      USER,
      [
        {
          name: 'mystery snack',
          brand: 'Couche-Tard',
          qty: 1,
          est: { kcal: 200, protein_g: 5, carbs_g: 20, fat_g: 10 },
        },
      ],
      { pin: true },
    );
    expect(insertFood).toHaveBeenCalledWith(USER, expect.objectContaining({ source: 'llm' }));
    expect(out.items[0]!.food_id).toBe('pinned-3');
  });
});
