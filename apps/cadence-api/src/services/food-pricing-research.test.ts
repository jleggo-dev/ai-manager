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

describe('the research rung — deferred, not run inline', () => {
  it('does NOT look anything up during pricing; it reports that the item wants it', async () => {
    /**
     * Owner's ruling (2026-08-23): "we don't have to show that slowness to the user. We can just
     * show 'logged' and input the information in the background." A grounded lookup is 8-15
     * seconds and sometimes far longer, and none of it needs to happen while somebody is standing
     * in a shop. Pricing stays fast and hands `meal-enrich.ts` a list of indexes to improve.
     */
    const out = await priceMealItems(
      USER,
      [{ name: 'dill pickle peanuts', brand: 'Couche-Tard', qty: 35.5, unit: 'g' }],
      { pin: false },
    );
    expect(researchFood).not.toHaveBeenCalled();
    expect(out.wants_research).toEqual([0]);
    expect(insertFood).not.toHaveBeenCalled();
  });

  it('wants nothing for an item with no vendor — the expensive rung needs the strong signal', async () => {
    const out = await priceMealItems(USER, [{ name: 'an apple' }], { pin: false });
    expect(out.wants_research).toEqual([]);
  });

  it('wants nothing for an item already looked up — the marker survives the card', async () => {
    const out = await priceMealItems(
      USER,
      [{ name: 'dill pickle peanuts', brand: 'Couche-Tard', est: { kcal: 215, source: 'research' } }],
      { pin: false },
    );
    expect(out.wants_research).toEqual([]);
  });

  it('still pins the parse estimate at log time, so the meal lands complete and immediately', async () => {
    vi.mocked(insertFood).mockImplementation(
      async (_u, input) => ({ ...researchedFood, ...input, food_id: 'pinned-1' }) as Food,
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
    expect(researchFood).not.toHaveBeenCalled();
    expect(insertFood).toHaveBeenCalledWith(USER, expect.objectContaining({ source: 'llm' }));
    expect(out.items[0]!.food_id).toBe('pinned-1');
    // Flagged for the background pass even though it pinned — the estimate is a placeholder.
    expect(out.wants_research).toEqual([]);
  });
});
