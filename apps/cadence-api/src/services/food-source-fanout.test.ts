import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Food } from '@cadence/shared';

/**
 * The fan-out: every eligible source asked at once, nothing decided.
 *
 * What is actually under test is the inversion. The waterfall this replaces stopped at the first
 * rung that cleared a threshold, so a second opinion was never fetched — which is why nothing in
 * the system had ever held two records for one food and compared them. Here every source that can
 * answer does, and all of them come back.
 *
 * The other half is honesty about what ran. `sources_checked` feeds the visible trace, and the
 * owner's requirement is that the trace be real — so a rung that was SKIPPED must say skipped, a
 * rung that broke must say error, and neither may look like "found nothing".
 */

const searchFoods = vi.hoisted(() => vi.fn());
const enrichFoodsWithUsda = vi.hoisted(() => vi.fn());
const findFatSecretMatch = vi.hoisted(() => vi.fn());

vi.mock('../repos/foods.ts', () => ({ searchFoods }));
vi.mock('./food-sources/usda-enrich.ts', () => ({ enrichFoodsWithUsda }));
const isUsdaConfigured = vi.hoisted(() => vi.fn(() => true));
vi.mock('./food-sources/usda.ts', () => ({ isUsdaConfigured }));
vi.mock('./food-sources/fatsecret-enrich.ts', () => ({ findFatSecretMatch }));

const { fanOutFoodSources } = await import('./food-source-fanout.ts');

const food = (over: Partial<Food> = {}): Food =>
  ({
    food_id: 'f1',
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

const check = (r: Awaited<ReturnType<typeof fanOutFoodSources>>, source: string) =>
  r.sources_checked.find((c) => c.source === source);

beforeEach(() => {
  for (const m of [searchFoods, enrichFoodsWithUsda, findFatSecretMatch]) m.mockReset();
  searchFoods.mockResolvedValue([]);
  enrichFoodsWithUsda.mockImplementation(async (_u: string, _q: string, local: Food[]) => local);
  findFatSecretMatch.mockResolvedValue(null);
  isUsdaConfigured.mockReturnValue(true);
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('every eligible source is asked, and all of them come back', () => {
  it('returns candidates from more than one source at once', async () => {
    searchFoods.mockResolvedValue([food({ food_id: 'own-1', source: 'llm', name: 'my shallots' })]);
    enrichFoodsWithUsda.mockResolvedValue([
      food({ food_id: 'own-1', source: 'llm', name: 'my shallots' }),
      food({ food_id: 'usda-1' }),
    ]);
    findFatSecretMatch.mockResolvedValue(food({ food_id: 'fs-1', source: 'fatsecret', name: 'Shallot' }));

    const r = await fanOutFoodSources('u1', { query: 'shallots', includeFatSecret: true });

    expect(r.candidates.map((c) => c.source)).toEqual(['ledger', 'usda', 'fatsecret']);
    // The first rung's answer is not consumed by the second — both are reported.
    expect(r.candidates).toHaveLength(3);
  });

  it('does not re-report a ledger row that USDA enrichment merely passed through', async () => {
    const own = food({ food_id: 'own-1' });
    searchFoods.mockResolvedValue([own]);
    enrichFoodsWithUsda.mockResolvedValue([own]);

    const r = await fanOutFoodSources('u1', { query: 'shallots' });

    expect(r.candidates).toHaveLength(1);
    expect(check(r, 'usda')?.status).toBe('miss');
  });

  it('prices every source at the measure that was asked for', async () => {
    searchFoods.mockResolvedValue([
      food({ servings: [{ label: '1 tbsp chopped', unit: 'tbsp', amount_g: 10 }], default_serving: 0 }),
    ]);
    const r = await fanOutFoodSources('u1', { query: 'shallots', measure: '1 tbsp chopped' });

    expect(r.requested_measure).toBe('1 tbsp chopped');
    expect(r.candidates[0]?.per.grams).toBe(10);
  });
});

describe('the trace says what really happened', () => {
  it('reports a hit with a count and a timing', async () => {
    searchFoods.mockResolvedValue([food(), food({ food_id: 'f2' })]);
    const r = await fanOutFoodSources('u1', { query: 'shallots' });

    const ledger = check(r, 'ledger');
    expect(ledger?.status).toBe('hit');
    expect(ledger?.detail).toContain('2 already on file');
    expect(ledger?.ms).toBeGreaterThanOrEqual(0);
  });

  /** Billed, so opt-in — and a skip must never be mistaken for "looked and found nothing". */
  it('skips FatSecret by default and says why', async () => {
    const r = await fanOutFoodSources('u1', { query: 'shallots' });
    const fs = check(r, 'fatsecret');

    expect(fs?.status).toBe('skipped');
    expect(fs?.detail).toContain('billed');
    expect(findFatSecretMatch).not.toHaveBeenCalled();
  });

  it('calls FatSecret only when asked', async () => {
    await fanOutFoodSources('u1', { query: 'shallots', includeFatSecret: true });
    expect(findFatSecretMatch).toHaveBeenCalledOnce();
  });

  it('skips USDA for a barcode rather than calling it', async () => {
    const r = await fanOutFoodSources('u1', { query: '0123456789012' });

    expect(check(r, 'usda')?.status).toBe('skipped');
    expect(enrichFoodsWithUsda).not.toHaveBeenCalled();
  });

  /** A broken rung and an empty rung are different facts and must read differently. */
  it('reports a thrown rung as error, not as a miss, and keeps the others', async () => {
    searchFoods.mockResolvedValue([food()]);
    enrichFoodsWithUsda.mockRejectedValue(new Error('FDC 503'));

    const r = await fanOutFoodSources('u1', { query: 'shallots' });

    expect(check(r, 'usda')?.status).toBe('error');
    expect(check(r, 'usda')?.detail).toContain('503');
    expect(check(r, 'ledger')?.status).toBe('hit');
    expect(r.candidates).toHaveLength(1);
  });

  it('reports an honest empty result rather than throwing', async () => {
    const r = await fanOutFoodSources('u1', { query: 'nothing anywhere' });

    expect(r.candidates).toEqual([]);
    expect(check(r, 'ledger')?.status).toBe('miss');
    expect(check(r, 'ledger')?.detail).toContain('nothing on file');
  });

  it('does nothing at all for an empty query', async () => {
    const r = await fanOutFoodSources('u1', { query: '   ' });
    expect(r.candidates).toEqual([]);
    expect(r.sources_checked).toEqual([]);
    expect(searchFoods).not.toHaveBeenCalled();
  });
});

describe('brand steers the search without becoming the query', () => {
  it('passes the vendor through to USDA, which is what opens its branded set', async () => {
    await fanOutFoodSources('u1', { query: 'greek yogurt', brand: 'Chobani' });
    expect(enrichFoodsWithUsda).toHaveBeenCalledWith('u1', 'greek yogurt', [], { brand: 'Chobani' });
  });
});

describe('the trace never claims a source it did not call', () => {
  /**
   * The bug this pins: `enrichFoodsWithUsda` returns the local list unchanged with no API key, so
   * diffing it found nothing new and the trace read "miss — no new match". That told the Coach USDA
   * had been consulted and had nothing, when USDA was never called. Decorative copy, which the
   * file header forbids.
   */
  it('reports USDA as skipped, not missed, when it is not configured', async () => {
    isUsdaConfigured.mockReturnValue(false);
    const r = await fanOutFoodSources('u1', { query: 'shallots' });

    const usda = check(r, 'usda');
    expect(usda?.status).toBe('skipped');
    expect(usda?.detail).toContain('not configured');
    expect(enrichFoodsWithUsda).not.toHaveBeenCalled();
  });

  it('still reports a genuine miss as a miss when it IS configured', async () => {
    isUsdaConfigured.mockReturnValue(true);
    const r = await fanOutFoodSources('u1', { query: 'shallots' });
    expect(check(r, 'usda')?.status).toBe('miss');
    expect(enrichFoodsWithUsda).toHaveBeenCalledOnce();
  });
});
