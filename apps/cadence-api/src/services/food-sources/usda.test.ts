/**
 * USDA HTTP + enrich unit tests — mocked fetch, no live USDA_API_KEY required.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../config.ts', () => ({
  cadenceConfig: { usdaApiKey: 'test-key-not-real' },
}));

vi.mock('../../repos/foods.ts', () => ({
  findFoodByFdcId: vi.fn(),
  searchFoods: vi.fn(),
  upsertUsdaFood: vi.fn(),
}));

import { findFoodByFdcId, searchFoods, upsertUsdaFood } from '../../repos/foods.ts';
import { enrichFoodsWithUsda, importUsdaFood } from './usda-enrich.ts';
import { __setUsdaFetchForTests } from './usda-http.ts';
import { searchUsdaFoods, fetchUsdaFoodDetail } from './usda.ts';

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

describe('searchUsdaFoods / fetchUsdaFoodDetail', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __setUsdaFetchForTests(null);
  });

  it('searches Foundation/SR Legacy and maps hits', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        foods: [
          { fdcId: 173944, description: 'Bananas, raw', dataType: 'SR Legacy' },
          { fdcId: 173944, description: 'Bananas, raw', dataType: 'SR Legacy' },
        ],
      }),
    );
    __setUsdaFetchForTests(fetchMock as unknown as typeof fetch);

    const hits = await searchUsdaFoods('banana');
    expect(hits).toHaveLength(1);
    expect(hits[0]!.fdc_id).toBe(173944);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const url = String(fetchMock.mock.calls[0]![0]);
    expect(url).toContain('/foods/search?');
    expect(url).toContain('dataType=Foundation');
    expect(url).toContain('api_key=');
    // Never assert the key value — just that the query param is present.
  });

  it('coalesces concurrent identical requests (single-flight)', async () => {
    let resolveFetch!: (v: Response) => void;
    const pending = new Promise<Response>((r) => {
      resolveFetch = r;
    });
    const fetchMock = vi.fn().mockReturnValue(pending);
    __setUsdaFetchForTests(fetchMock as unknown as typeof fetch);

    const a = searchUsdaFoods('oats');
    const b = searchUsdaFoods('oats');
    resolveFetch(jsonResponse({ foods: [{ fdcId: 1, description: 'Oats', dataType: 'Foundation' }] }));
    const [ha, hb] = await Promise.all([a, b]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(ha).toEqual(hb);
  });

  it('backs off on 429', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ message: 'rate limit' }, 429, { 'retry-after': '1' }));
    __setUsdaFetchForTests(fetchMock as unknown as typeof fetch);
    await expect(searchUsdaFoods('rice')).rejects.toMatchObject({ status: 429 });
  });

  it('maps food detail', async () => {
    __setUsdaFetchForTests(
      vi.fn().mockResolvedValue(
        jsonResponse({
          fdcId: 173944,
          description: 'Bananas, raw',
          foodNutrients: [
            { nutrient: { number: 1008, unitName: 'kcal' }, amount: 89 },
            { nutrient: { number: 1003, unitName: 'g' }, amount: 1.09 },
          ],
          foodPortions: [{ amount: 1, modifier: 'medium', gramWeight: 118, measureUnit: { name: 'fruit' } }],
        }),
      ) as unknown as typeof fetch,
    );
    const detail = await fetchUsdaFoodDetail(173944);
    expect(detail.fdc_id).toBe(173944);
    expect(detail.macros_per_base.kcal).toBe(89);
  });
});

describe('importUsdaFood / enrichFoodsWithUsda', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __setUsdaFetchForTests(null);
  });

  it('returns cached food without calling USDA', async () => {
    const cached = {
      food_id: 'cached',
      owner_user_id: null,
      visibility: 'shared' as const,
      name: 'Bananas, raw',
      brand: null,
      source: 'usda' as const,
      off_id: null,
      fdc_id: 173944,
      base_unit: 'g' as const,
      macros_per_base: { kcal: 89 },
      servings: [{ label: '100 g', unit: 'g', amount_g: 100 }],
      default_serving: 0,
      confidence: 1,
      photo_ref: null,
    };
    vi.mocked(findFoodByFdcId).mockResolvedValueOnce(cached);
    const fetchMock = vi.fn();
    __setUsdaFetchForTests(fetchMock as unknown as typeof fetch);

    const food = await importUsdaFood(173944);
    expect(food.food_id).toBe('cached');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(upsertUsdaFood).not.toHaveBeenCalled();
  });

  it('fetches + upserts on cache miss', async () => {
    vi.mocked(findFoodByFdcId).mockResolvedValueOnce(null);
    __setUsdaFetchForTests(
      vi.fn().mockResolvedValue(
        jsonResponse({
          fdcId: 42,
          description: 'Spinach, raw',
          foodNutrients: [
            { nutrient: { number: 1008, unitName: 'kcal' }, amount: 23 },
            { nutrient: { number: 1003, unitName: 'g' }, amount: 2.9 },
          ],
          foodPortions: [],
        }),
      ) as unknown as typeof fetch,
    );
    const upserted = {
      food_id: 'new',
      owner_user_id: null,
      visibility: 'shared' as const,
      name: 'Spinach, raw',
      brand: null,
      source: 'usda' as const,
      off_id: null,
      fdc_id: 42,
      base_unit: 'g' as const,
      macros_per_base: { kcal: 23, protein_g: 2.9 },
      servings: [{ label: '100 g', unit: 'g', amount_g: 100 }],
      default_serving: 0,
      confidence: 1,
      photo_ref: null,
    };
    vi.mocked(upsertUsdaFood).mockResolvedValueOnce(upserted);

    const food = await importUsdaFood(42);
    expect(food.fdc_id).toBe(42);
    expect(upsertUsdaFood).toHaveBeenCalledWith(
      expect.objectContaining({ fdc_id: 42, name: 'Spinach, raw', base_unit: 'g' }),
    );
  });

  it('enrich skips USDA when local hit is strong', async () => {
    const local = [
      {
        food_id: 'local',
        owner_user_id: 'u',
        visibility: 'private' as const,
        name: 'Banana',
        brand: null,
        source: 'manual' as const,
        off_id: null,
        fdc_id: null,
        base_unit: 'g' as const,
        macros_per_base: { kcal: 90 },
        servings: [{ label: '100 g', unit: 'g', amount_g: 100 }],
        default_serving: 0,
        confidence: 1,
        photo_ref: null,
      },
    ];
    const fetchMock = vi.fn();
    __setUsdaFetchForTests(fetchMock as unknown as typeof fetch);
    const out = await enrichFoodsWithUsda('user-1', 'banana', local);
    expect(out).toEqual(local);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('enrich imports top USDA hits on cache miss then merges', async () => {
    vi.mocked(findFoodByFdcId).mockResolvedValue(null);
    vi.mocked(searchFoods).mockResolvedValue([]);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          foods: [{ fdcId: 99, description: 'Kale, raw', dataType: 'Foundation' }],
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          fdcId: 99,
          description: 'Kale, raw',
          foodNutrients: [
            { nutrient: { number: 1008, unitName: 'kcal' }, amount: 35 },
            { nutrient: { number: 1003, unitName: 'g' }, amount: 2.9 },
          ],
          foodPortions: [],
        }),
      );
    __setUsdaFetchForTests(fetchMock as unknown as typeof fetch);
    const upserted = {
      food_id: 'kale-1',
      owner_user_id: null,
      visibility: 'shared' as const,
      name: 'Kale, raw',
      brand: null,
      source: 'usda' as const,
      off_id: null,
      fdc_id: 99,
      base_unit: 'g' as const,
      macros_per_base: { kcal: 35 },
      servings: [{ label: '100 g', unit: 'g', amount_g: 100 }],
      default_serving: 0,
      confidence: 1,
      photo_ref: null,
    };
    vi.mocked(upsertUsdaFood).mockResolvedValue(upserted);

    const out = await enrichFoodsWithUsda('user-1', 'kale', []);
    expect(upsertUsdaFood).toHaveBeenCalled();
    expect(out.some((f) => f.fdc_id === 99)).toBe(true);
  });
});
