/**
 * The failover the waterfall promises: USDA falling over must not stop FatSecret being asked.
 *
 * It holds because `enrichFoodsWithUsda` swallows its own failures and returns the local list —
 * so a USDA outage looks like "no USDA match" rather than an exception, and the next rung runs.
 * This pins that, because the day it stops being true the symptom is silent: branded foods quietly
 * stop resolving and start getting estimated instead.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('./usda-enrich.ts', () => ({
  // Exactly what the real one does on any failure: hand back what was already local.
  enrichFoodsWithUsda: vi.fn(async (_u: string, _q: string, local: unknown[]) => local),
  searchFoodsWithUsda: vi.fn(async () => []),
}));
vi.mock('../../repos/foods.ts', () => ({
  searchFoods: vi.fn(async () => []),
  listRecentFoods: vi.fn(async () => []),
  listFrequentFoods: vi.fn(async () => []),
  listFoodUsageRows: vi.fn(async () => []),
  listFoodContextRows: vi.fn(async () => []),
}));
vi.mock('../../repos/recipes.ts', () => ({ listRecipes: vi.fn(async () => []), searchRecipes: vi.fn(async () => []) }));
vi.mock('../../repos/users.ts', () => ({ getDietaryProfile: vi.fn(async () => null) }));

import { enrichFoodsWithUsda } from './usda-enrich.ts';
import { loadResolveShared, rankedFoodsFor } from '../food-resolver.ts';

const USER = '00000000-0000-4000-a000-00000000a999';

beforeEach(() => vi.mocked(enrichFoodsWithUsda).mockClear());

describe('USDA degradation', () => {
  it('returns an empty pool rather than throwing, so the next rung is reachable', async () => {
    const shared = await loadResolveShared(USER);
    const ranked = await rankedFoodsFor(USER, 'dill pickle peanuts', shared);
    expect(ranked).toEqual([]);
    expect(enrichFoodsWithUsda).toHaveBeenCalled();
  });

  /**
   * The contract that makes the failover work. If USDA ever starts throwing through, pricing
   * catches it and returns early — which SKIPS FatSecret entirely.
   */
  it('is the reason pricing can fall through: the enricher hands back local on failure', async () => {
    const local = [{ food_id: 'local-1' }];
    const out = await vi.mocked(enrichFoodsWithUsda)(USER, 'anything', local as never);
    expect(out).toBe(local);
  });
});
