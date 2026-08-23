/**
 * A23 §1a — the pricing layer, with the DB and the AI seam mocked.
 *
 * Three properties are load-bearing and each has a test that fails loudly if it regresses:
 *   1. A hit costs NO model call, and a miss with a parse estimate costs no model call either.
 *   2. An ambiguous or weak match is never priced — a wrong confident price is worse than none.
 *   3. Nothing here can lose a meal: every failure path returns the items as parsed.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { DietaryProfile, Food } from '@cadence/shared';

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

import { loadResolveShared, rankedFoodsFor, type ResolveShared } from './food-resolver.ts';
import { insertFood, searchFoods, touchFoodUsage } from '../repos/foods.ts';
import { estimateFood } from './food-capture.ts';
import { priceMealItems, PRICING_MIN_SCORE } from './food-pricing.ts';
import type { RankedFood } from './food-resolver-rank.ts';

const USER = '00000000-0000-4000-a000-00000000a301';

function food(over: Partial<Food> = {}): Food {
  return {
    food_id: 'f-1',
    owner_user_id: null,
    visibility: 'shared',
    name: 'Greek Yogurt',
    brand: null,
    source: 'usda',
    off_id: null,
    fdc_id: 1,
    base_unit: 'g',
    macros_per_base: { kcal: 59, protein_g: 10, calcium_mg: 110 },
    servings: [{ label: '1 container (170g)', unit: 'container', amount_g: 170 }],
    default_serving: 0,
    confidence: 1,
    photo_ref: null,
    ...over,
  };
}

function ranked(f: Food, score: number): RankedFood {
  return { food: f, score, preselected_serving: 0, inferred_quantity: 1 };
}

function shared(profile: DietaryProfile | null = null): ResolveShared {
  return {
    ctx: { userId: USER, useCountById: new Map(), recentRankById: new Map() },
    recents: [],
    frequents: [],
    profile,
  };
}

beforeEach(() => {
  vi.mocked(loadResolveShared).mockReset().mockResolvedValue(shared());
  vi.mocked(rankedFoodsFor).mockReset().mockResolvedValue([]);
  vi.mocked(insertFood).mockReset();
  vi.mocked(searchFoods).mockReset().mockResolvedValue([]);
  vi.mocked(touchFoodUsage).mockReset().mockResolvedValue(undefined);
  vi.mocked(estimateFood).mockReset();
});

describe('priceMealItems — a hit is priced from the ledger', () => {
  it('prices from the matched food and calls no model', async () => {
    vi.mocked(rankedFoodsFor).mockResolvedValue([ranked(food(), 0.95)]);

    const out = await priceMealItems(USER, [{ name: 'greek yogurt', qty: 1, unit: 'container', est: { kcal: 999 } }]);

    expect(out.fully_priced).toBe(true);
    expect(out.items[0]?.food_id).toBe('f-1');
    // The parse said 999; the ledger says 100. The ledger wins.
    expect(out.items[0]?.est?.kcal).toBeCloseTo(100.3, 1);
    expect(out.macros?.kcal).toBeCloseTo(100.3, 1);
    expect(estimateFood).not.toHaveBeenCalled();
    expect(insertFood).not.toHaveBeenCalled();
  });

  it('carries micronutrients an AI estimate could never produce', async () => {
    vi.mocked(rankedFoodsFor).mockResolvedValue([ranked(food(), 0.95)]);
    const out = await priceMealItems(USER, [{ name: 'greek yogurt', qty: 1, unit: 'container' }]);
    expect(out.items[0]?.est?.calcium_mg).toBeCloseTo(187, 0);
  });

  it('teaches recents/frequents from what was eaten', async () => {
    vi.mocked(rankedFoodsFor).mockResolvedValue([ranked(food(), 0.95)]);
    await priceMealItems(USER, [{ name: 'greek yogurt' }]);
    expect(touchFoodUsage).toHaveBeenCalledWith(USER, 'f-1', undefined);
  });

  /** The rhythm signal is only learned if the slot reaches both the ranker and the usage write. */
  it('carries the weekday/meal slot into ranking and into what it teaches', async () => {
    vi.mocked(rankedFoodsFor).mockResolvedValue([ranked(food(), 0.95)]);
    const slot = { dow: 3, meal: 'breakfast' };
    await priceMealItems(USER, [{ name: 'greek yogurt' }], { slot });

    expect(loadResolveShared).toHaveBeenCalledWith(USER, slot);
    expect(touchFoodUsage).toHaveBeenCalledWith(USER, 'f-1', slot);
  });
});

describe('priceMealItems — a miss is pinned so it is only estimated once', () => {
  it('pins the parse’s own estimate without any model call', async () => {
    const pinned = food({
      food_id: 'p-1',
      owner_user_id: USER,
      visibility: 'private',
      source: 'llm',
      base_unit: 'item',
    });
    vi.mocked(insertFood).mockResolvedValue({
      ...pinned,
      macros_per_base: { kcal: 250, protein_g: 12 },
      servings: [{ label: '1 latte', unit: 'latte', amount_g: 1 }],
    });

    const out = await priceMealItems(
      USER,
      [{ name: 'venti latte', qty: 1, unit: 'latte', est: { kcal: 250, protein_g: 12 }, brand: 'Starbucks' }],
      { confidence: 0.8 },
    );

    expect(estimateFood).not.toHaveBeenCalled();
    expect(insertFood).toHaveBeenCalledOnce();
    expect(vi.mocked(insertFood).mock.calls[0]?.[1]).toMatchObject({
      name: 'venti latte',
      brand: 'Starbucks',
      source: 'llm',
      visibility: 'private',
      confidence: 0.8,
      base_unit: 'item',
    });
    // Pinning must not change the numbers the user is about to confirm.
    expect(out.items[0]?.est?.kcal).toBeCloseTo(250, 1);
    expect(out.items[0]?.food_id).toBe('p-1');
    expect(out.fully_priced).toBe(true);
  });

  it('falls back to estimate-food only when the parse produced no numbers', async () => {
    vi.mocked(estimateFood).mockResolvedValue({
      name: 'Yogurt Parfait',
      brand: null,
      source: 'llm',
      base_unit: 'item',
      macros_per_base: { kcal: 380 },
      servings: [{ label: '1 parfait', unit: 'parfait', amount_g: 1 }],
      default_serving: 0,
      confidence: 0.6,
      photo_ref: null,
    });
    vi.mocked(insertFood).mockResolvedValue(
      food({
        food_id: 'p-2',
        owner_user_id: USER,
        name: 'Yogurt Parfait',
        base_unit: 'item',
        macros_per_base: { kcal: 380 },
        servings: [{ label: '1 parfait', unit: 'parfait', amount_g: 1 }],
      }),
    );

    const out = await priceMealItems(USER, [{ name: 'parfait thing', qty: 1, brand: 'Materia Prima' }]);

    expect(estimateFood).toHaveBeenCalledOnce();
    expect(estimateFood).toHaveBeenCalledWith(USER, 'Materia Prima parfait thing');
    expect(out.items[0]?.est?.kcal).toBe(380);
  });

  it('reuses an own food the estimate renamed into, instead of minting a duplicate', async () => {
    vi.mocked(estimateFood).mockResolvedValue({
      name: 'Yogurt Parfait',
      brand: 'Materia Prima',
      source: 'llm',
      base_unit: 'item',
      macros_per_base: { kcal: 380 },
      servings: [{ label: '1 parfait', unit: 'parfait', amount_g: 1 }],
      default_serving: 0,
      confidence: 0.6,
      photo_ref: null,
    });
    const existing = food({
      food_id: 'own-1',
      owner_user_id: USER,
      visibility: 'private',
      source: 'llm',
      name: 'Yogurt Parfait',
      brand: 'Materia Prima',
      base_unit: 'item',
      macros_per_base: { kcal: 372 },
      servings: [{ label: '1 parfait', unit: 'parfait', amount_g: 1 }],
    });
    vi.mocked(searchFoods).mockResolvedValue([existing]);

    const out = await priceMealItems(USER, [{ name: 'the parfait', qty: 1, brand: 'Materia Prima' }]);

    expect(insertFood).not.toHaveBeenCalled();
    // Priced from the row already owned — so it still costs what it cost last time.
    expect(out.items[0]?.est?.kcal).toBe(372);
    expect(out.items[0]?.food_id).toBe('own-1');
  });
});

describe('priceMealItems — pin:false is a read', () => {
  it('writes nothing when pinning is off, and keeps the parsed estimate', async () => {
    const out = await priceMealItems(USER, [{ name: 'venti latte', qty: 1, unit: 'latte', est: { kcal: 250 } }], {
      pin: false,
    });

    expect(insertFood).not.toHaveBeenCalled();
    expect(estimateFood).not.toHaveBeenCalled();
    expect(out.items[0]).toEqual({ name: 'venti latte', qty: 1, unit: 'latte', est: { kcal: 250 } });
    expect(out.fully_priced).toBe(false);
  });

  it('still prices from a food already on file when pinning is off', async () => {
    vi.mocked(rankedFoodsFor).mockResolvedValue([ranked(food(), 0.95)]);
    const out = await priceMealItems(USER, [{ name: 'greek yogurt', qty: 1, unit: 'container' }], { pin: false });

    expect(out.items[0]?.food_id).toBe('f-1');
    expect(insertFood).not.toHaveBeenCalled();
  });
});

describe('priceMealItems — never guess which food it was', () => {
  it('does not price a weak lexical match', async () => {
    const weak = ranked(food(), PRICING_MIN_SCORE - 0.01);
    vi.mocked(rankedFoodsFor).mockResolvedValue([weak]);
    vi.mocked(insertFood).mockResolvedValue(food({ food_id: 'p-3', owner_user_id: USER, base_unit: 'item' }));

    const out = await priceMealItems(USER, [{ name: 'bowl of something', qty: 1, est: { kcal: 300 } }]);

    // Falls through to pinning rather than pricing from a food it isn't sure about.
    expect(out.items[0]?.food_id).toBe('p-3');
    expect(insertFood).toHaveBeenCalledOnce();
  });

  it('does not price two shared rows that are too close to call', async () => {
    vi.mocked(rankedFoodsFor).mockResolvedValue([
      ranked(food({ food_id: 'a', name: 'Yogurt, plain' }), 0.9),
      ranked(food({ food_id: 'b', name: 'Yogurt, vanilla' }), 0.88),
    ]);
    vi.mocked(insertFood).mockResolvedValue(food({ food_id: 'p-4', owner_user_id: USER, base_unit: 'item' }));

    await priceMealItems(USER, [{ name: 'yogurt', qty: 1, est: { kcal: 100 } }]);
    expect(insertFood).toHaveBeenCalledOnce();
  });

  it('lets the user’s OWN food win a near-tie against a stranger’s row', async () => {
    const own = food({ food_id: 'own-2', owner_user_id: USER, visibility: 'private', name: 'Yogurt parfait' });
    vi.mocked(rankedFoodsFor).mockResolvedValue([
      ranked(food({ food_id: 'shared-1', name: 'Yogurt parfait' }), 0.9),
      ranked(own, 0.88),
    ]);

    const out = await priceMealItems(USER, [{ name: 'yogurt parfait', qty: 1, unit: 'container' }]);
    expect(out.items[0]?.food_id).toBe('own-2');
    expect(insertFood).not.toHaveBeenCalled();
  });

  it('never prices an allergen-flagged food', async () => {
    const profile: DietaryProfile = { allergies: ['peanuts'], diet: null, dislikes: [], notes: null };
    vi.mocked(loadResolveShared).mockResolvedValue(shared(profile));
    vi.mocked(rankedFoodsFor).mockResolvedValue([ranked(food({ food_id: 'pb', name: 'Peanut butter' }), 1)]);
    vi.mocked(insertFood).mockResolvedValue(food({ food_id: 'p-5', owner_user_id: USER, base_unit: 'item' }));

    const out = await priceMealItems(USER, [{ name: 'peanut butter', qty: 1, est: { kcal: 190 } }]);
    expect(out.items[0]?.food_id).not.toBe('pb');
  });
});

describe('priceMealItems — a failure never costs the meal', () => {
  it('returns the parsed items when resolution throws', async () => {
    vi.mocked(rankedFoodsFor).mockRejectedValue(new Error('db down'));
    const out = await priceMealItems(USER, [{ name: 'oats', qty: 1, est: { kcal: 300 } }]);
    expect(out.items).toEqual([{ name: 'oats', qty: 1, est: { kcal: 300 } }]);
    expect(out.priced_count).toBe(0);
    // The item sum still stands — a resolver outage costs the LEDGER LINK, never the numbers the
    // parse already produced. (Before 2026-08-22 this was null, and the meal's micronutrients went
    // with it.)
    expect(out.macros).toEqual({ kcal: 300 });
  });

  it('returns the parsed items when the context load throws', async () => {
    vi.mocked(loadResolveShared).mockRejectedValue(new Error('no db'));
    const out = await priceMealItems(USER, [{ name: 'oats', est: { kcal: 300 }, brand: 'Quaker' }]);
    expect(out.items).toEqual([{ name: 'oats', est: { kcal: 300 } }]);
    expect(out.fully_priced).toBe(false);
  });

  it('keeps the parsed estimate when pinning throws', async () => {
    vi.mocked(insertFood).mockRejectedValue(new Error('insert failed'));
    const out = await priceMealItems(USER, [{ name: 'mystery stew', qty: 1, est: { kcal: 400 } }]);
    expect(out.items[0]).toEqual({ name: 'mystery stew', qty: 1, est: { kcal: 400 } });
  });

  it('keeps the parsed estimate when estimate-food throws', async () => {
    vi.mocked(estimateFood).mockRejectedValue(new Error('job 500'));
    const out = await priceMealItems(USER, [{ name: 'mystery stew' }]);
    expect(out.items[0]).toEqual({ name: 'mystery stew' });
    expect(out.priced_count).toBe(0);
  });

  it('handles an empty item list', async () => {
    const out = await priceMealItems(USER, []);
    expect(out).toEqual({
      items: [],
      macros: null,
      priced_count: 0,
      item_count: 0,
      fully_priced: false,
      wants_research: [],
    });
  });
});

describe('priceMealItems — cost of a plate', () => {
  it('loads the ranking context ONCE for a multi-item meal', async () => {
    vi.mocked(rankedFoodsFor).mockResolvedValue([ranked(food(), 0.95)]);
    await priceMealItems(USER, [{ name: 'yogurt' }, { name: 'granola' }, { name: 'berries' }]);
    expect(loadResolveShared).toHaveBeenCalledOnce();
    expect(rankedFoodsFor).toHaveBeenCalledTimes(3);
  });

  it('sums a mixed plate and reports it as not fully priced', async () => {
    vi.mocked(rankedFoodsFor)
      .mockResolvedValueOnce([ranked(food(), 0.95)])
      .mockResolvedValueOnce([]);
    vi.mocked(estimateFood).mockRejectedValue(new Error('no estimate'));

    const out = await priceMealItems(USER, [
      { name: 'greek yogurt', qty: 1, unit: 'container' },
      { name: 'granola', qty: 1, est: { kcal: 200, protein_g: 4 } },
    ]);

    expect(out.priced_count).toBe(1);
    expect(out.item_count).toBe(2);
    expect(out.fully_priced).toBe(false);
    // The total still counts both — the unpriced item keeps the parse's number.
    expect(out.macros?.kcal).toBeCloseTo(300.3, 1);
  });
});
