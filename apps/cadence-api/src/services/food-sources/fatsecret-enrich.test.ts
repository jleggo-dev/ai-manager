/**
 * The last rung, and the 24-hour rule that shapes it.
 *
 * FatSecret's terms let us keep `food_id` forever and nothing else, so the interesting behaviour
 * here is not "does it find food" but "does it refuse to serve numbers it is no longer allowed to
 * hold". A stale row whose refresh fails must expire, not quietly price a meal.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Food } from '@cadence/shared';

vi.mock('../../repos/foods.ts', () => ({
  findFoodByFatSecretId: vi.fn(),
  upsertFatSecretFood: vi.fn(),
  expireFatSecretFood: vi.fn(async () => undefined),
}));
vi.mock('./fatsecret.ts', () => ({
  isFatSecretConfigured: vi.fn(() => true),
  searchFatSecretFoods: vi.fn(),
  fetchFatSecretFood: vi.fn(),
}));

import { expireFatSecretFood, findFoodByFatSecretId, upsertFatSecretFood } from '../../repos/foods.ts';
import { fetchFatSecretFood, isFatSecretConfigured, searchFatSecretFoods } from './fatsecret.ts';
import {
  FATSECRET_TTL_MS,
  fatSecretQuery,
  findFatSecretMatch,
  isFatSecretRowFresh,
  matchFatSecret,
  rankFatSecretHits,
  refreshFatSecretFood,
  topTie,
} from './fatsecret-enrich.ts';
import type { FatSecretHit } from './fatsecret-map.ts';

function row(over: Partial<Food> = {}): Food {
  return {
    food_id: 'row-1',
    owner_user_id: null,
    visibility: 'shared',
    name: 'Dill Pickle Peanuts',
    brand: 'Couche-Tard',
    source: 'fatsecret',
    off_id: null,
    fdc_id: null,
    fatsecret_id: '12345',
    source_fetched_at: new Date().toISOString(),
    base_unit: 'g',
    macros_per_base: { kcal: 591 },
    servings: [{ label: '1 pack', unit: 'pack', amount_g: 71 }],
    default_serving: 0,
    confidence: 1,
    photo_ref: null,
    ...over,
  } as Food;
}

beforeEach(() => {
  vi.mocked(findFoodByFatSecretId).mockReset();
  vi.mocked(upsertFatSecretFood).mockReset();
  vi.mocked(expireFatSecretFood).mockReset().mockResolvedValue(undefined);
  vi.mocked(searchFatSecretFoods).mockReset();
  vi.mocked(fetchFatSecretFood).mockReset();
  vi.mocked(isFatSecretConfigured).mockReturnValue(true);
});

describe('isFatSecretRowFresh', () => {
  it('holds a row for its 24 hours and not a minute longer', () => {
    const now = Date.now();
    expect(isFatSecretRowFresh(row({ source_fetched_at: new Date(now - 1000).toISOString() }), now)).toBe(true);
    expect(
      isFatSecretRowFresh(row({ source_fetched_at: new Date(now - FATSECRET_TTL_MS - 1).toISOString() }), now),
    ).toBe(false);
  });

  it('treats an unstamped FatSecret row as stale, never as timeless', () => {
    expect(isFatSecretRowFresh(row({ source_fetched_at: null }))).toBe(false);
  });

  /** USDA is public domain and OFF is ODbL — neither expires, so neither is asked to. */
  it('leaves other sources alone', () => {
    expect(isFatSecretRowFresh(row({ source: 'usda', source_fetched_at: null }))).toBe(true);
    expect(isFatSecretRowFresh(row({ source: 'off', source_fetched_at: null }))).toBe(true);
  });
});

describe('refreshFatSecretFood', () => {
  it('serves a fresh row without spending a call', async () => {
    vi.mocked(findFoodByFatSecretId).mockResolvedValue(row());
    const out = await refreshFatSecretFood('12345');
    expect(out?.food_id).toBe('row-1');
    expect(fetchFatSecretFood).not.toHaveBeenCalled();
  });

  it('re-reads and re-stamps a stale one', async () => {
    vi.mocked(findFoodByFatSecretId).mockResolvedValue(row({ source_fetched_at: '2020-01-01T00:00:00.000Z' }));
    vi.mocked(fetchFatSecretFood).mockResolvedValue({
      fatsecret_id: '12345',
      name: 'Dill Pickle Peanuts',
      brand: 'Couche-Tard',
      base_unit: 'g',
      macros_per_base: { kcal: 591 },
      servings: [{ label: '1 pack', unit: 'pack', amount_g: 71 }],
      default_serving: 0,
    });
    vi.mocked(upsertFatSecretFood).mockResolvedValue(row());

    const out = await refreshFatSecretFood('12345');
    expect(fetchFatSecretFood).toHaveBeenCalledWith('12345');
    expect(upsertFatSecretFood).toHaveBeenCalledOnce();
    expect(out).not.toBeNull();
  });

  /** THE RULE. Past its day and unrefreshable: expire it, do not serve it. */
  it('expires a stale row rather than pricing from numbers we may no longer hold', async () => {
    vi.mocked(findFoodByFatSecretId).mockResolvedValue(row({ source_fetched_at: '2020-01-01T00:00:00.000Z' }));
    vi.mocked(fetchFatSecretFood).mockRejectedValue(new Error('network down'));

    const out = await refreshFatSecretFood('12345');
    expect(out).toBeNull();
    expect(expireFatSecretFood).toHaveBeenCalledWith('12345');
  });
});

describe('findFatSecretMatch', () => {
  it('imports the best-named hit', async () => {
    vi.mocked(searchFatSecretFoods).mockResolvedValue([
      { food_id: '999', name: 'Almonds', brand: null, description: '' },
      { food_id: '12345', name: 'Dill Pickle Peanuts', brand: 'Couche-Tard', description: '' },
    ]);
    vi.mocked(findFoodByFatSecretId).mockResolvedValue(row());

    const out = await findFatSecretMatch('dill pickle peanuts', 'Couche-Tard');
    expect(out?.fatsecret_id).toBe('12345');
  });

  it('takes nothing rather than a badly-named match', async () => {
    vi.mocked(searchFatSecretFoods).mockResolvedValue([
      { food_id: '999', name: 'Pickled herring', brand: null, description: '' },
    ]);
    expect(await findFatSecretMatch('venti latte', 'Starbucks')).toBeNull();
    expect(findFoodByFatSecretId).not.toHaveBeenCalled();
  });

  /** Absent, unconfigured or failing, it degrades to "no match" — never to an exception. */
  it('stays quiet when there are no credentials', async () => {
    vi.mocked(isFatSecretConfigured).mockReturnValue(false);
    expect(await findFatSecretMatch('peanuts')).toBeNull();
    expect(searchFatSecretFoods).not.toHaveBeenCalled();
  });

  it('swallows a search failure so the caller can still pin an estimate', async () => {
    vi.mocked(searchFatSecretFoods).mockRejectedValue(new Error('429'));
    expect(await findFatSecretMatch('peanuts')).toBeNull();
  });

  it('needs something to search for', async () => {
    expect(await findFatSecretMatch('   ')).toBeNull();
  });
});

/**
 * Starbucks' real menu rows, as FatSecret returned them on 2026-10-29. "Starbucks, Venti latte"
 * logged a Matcha Latte (Grande): every one of these scored the same, and the first listed won.
 */
const STARBUCKS: FatSecretHit[] = [
  ['m-g', 'Matcha Latte (Grande)', '220kcal'],
  ['c-g', 'Caff\u00e8 Latte (Grande)', '190kcal'],
  ['psl', 'Pumpkin Spice Latte', '470kcal'],
  ['ch-v', 'Chai Latte (Venti)', '240kcal'],
  ['m-v', 'Matcha Latte (Venti)', '290kcal'],
  ['c-v', 'Caff\u00e8 Latte (Venti)', '250kcal'],
  ['ic-v', 'Iced Caff\u00e8 Latte (Venti)', '180kcal'],
  ['nf-v', 'Hot Caff\u00e8 Latte - Nonfat Milk (Venti)', '170kcal'],
  ['c-t', 'Caff\u00e8 Latte (Tall)', '150kcal'],
].map(([food_id, name, kcal]) => ({ food_id: food_id!, name: name!, brand: 'Starbucks', description: kcal! }));

function pick(said: string, size?: string): string[] {
  return topTie(rankFatSecretHits(fatSecretQuery(said, 'Starbucks', size), STARBUCKS)).map((r) => r.hit.food_id);
}

describe('fatSecretQuery', () => {
  it.each([
    ['latte', 'Starbucks', 'Venti', 'Starbucks venti latte'],
    ['latte', 'Starbucks', 'grande', 'Starbucks grande latte'],
    ['latte', 'Starbucks', 'cup', 'Starbucks latte'], // a measure, not a size
    ['latte', 'Starbucks', 'g', 'Starbucks latte'],
    ['latte', 'Starbucks', null, 'Starbucks latte'],
    ['peanuts', null, null, 'peanuts'],
  ])('%j + %j + %j → %j', (q, brand, size, out) => {
    expect(fatSecretQuery(q, brand, size)).toBe(out);
  });
});

describe("choosing among a chain's menu rows", () => {
  it.each([
    // The exact drink, accent or not, at the size they said.
    ['caffe latte', 'Venti', ['c-v']],
    ['caff\u00e8 latte', 'venti', ['c-v']],
    ['caffe latte', 'Tall', ['c-t']],
    ['matcha latte', 'Venti', ['m-v']],
    ['pumpkin spice latte', undefined, ['psl']],
    ['iced caffe latte', 'Venti', ['ic-v']],
  ])('%j (%s) takes exactly that row', (said, size, want) => {
    expect(pick(said, size)).toEqual(want);
  });

  it.each([
    // Near-misses: "latte" alone names no one drink here — Caff\u00e8, Chai and Matcha each add one word.
    ['latte', 'Venti'],
    ['latte', undefined],
    // No size said: the Grande and the Tall are different foods with different labels.
    ['caffe latte', undefined],
  ])('%j (%s) is a tie, and nothing is taken', (said, size) => {
    expect(pick(said, size).length).toBeGreaterThan(1);
  });

  it('never takes the Matcha for a latte, whatever order the rows arrive in', () => {
    expect(pick('latte', 'Venti')).not.toEqual(['m-g']);
    expect(pick('latte', 'Venti')).not.toEqual(['m-v']);
  });

  it('treats the same food listed twice as one food, not a tie', () => {
    const twice: FatSecretHit[] = [
      { food_id: 'a', name: 'Caff\u00e8 Latte (Venti)', brand: 'Starbucks', description: '' },
      { food_id: 'b', name: 'Caffe Latte (Venti)', brand: 'Starbucks', description: '' },
    ];
    const top = topTie(rankFatSecretHits('Starbucks venti caffe latte', twice));
    expect(top.map((r) => r.hit.food_id)).toEqual(['a']);
  });
});

describe('matchFatSecret', () => {
  it('reports a tie instead of importing one of it', async () => {
    vi.mocked(searchFatSecretFoods).mockResolvedValue(STARBUCKS);
    const out = await matchFatSecret('latte', 'Starbucks', 'Venti');
    expect(out.food).toBeNull();
    expect(out.tied.map((h) => h.food_id).sort()).toEqual(['c-v', 'ch-v', 'm-v']);
    expect(findFoodByFatSecretId).not.toHaveBeenCalled();
    expect(fetchFatSecretFood).not.toHaveBeenCalled();
  });

  it('searches with the size, so the right size is on the page at all', async () => {
    vi.mocked(searchFatSecretFoods).mockResolvedValue([]);
    await matchFatSecret('caffe latte', 'Starbucks', 'Venti');
    expect(vi.mocked(searchFatSecretFoods).mock.calls[0]?.[0]).toBe('Starbucks venti caffe latte');
  });

  it('imports the one clear row', async () => {
    vi.mocked(searchFatSecretFoods).mockResolvedValue(STARBUCKS);
    vi.mocked(findFoodByFatSecretId).mockResolvedValue(row({ fatsecret_id: 'c-v', name: 'Caff\u00e8 Latte (Venti)' }));
    const out = await findFatSecretMatch('caffe latte', 'Starbucks', 'Venti');
    expect(out?.fatsecret_id).toBe('c-v');
    expect(findFoodByFatSecretId).toHaveBeenCalledWith('c-v');
  });
});
