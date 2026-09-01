/**
 * The food parse gate. `getFoodById` is what every one-tap add goes through — the quick-add rows on
 * the trail, the Log screen's search/recents/usual rows, the drink composer, the Kitchen composer —
 * and a food it refuses to parse reads to the user as a button that does nothing at all.
 *
 * It refused every store-sourced food for weeks: the parser carried its own hand-written list of
 * sources that predated the cnf / fatsecret / research rungs, so a 200 OK came back and turned into
 * null. These pin that a food is parsed by SOURCE the same way the canonical list defines it — the
 * value of `source` is never a reason to drop a row.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { FOOD_SOURCES } from '@cadence/shared';
import { getFoodById } from './foods.ts';

/** A complete, valid food detail body — only `source` varies across these tests. */
function foodBody(source: string): Record<string, unknown> {
  return {
    food_id: 'f1',
    name: 'Frozen blueberries',
    brand: null,
    source,
    base_unit: 'g',
    macros_per_base: { kcal: 0.57, protein_g: 0.007, carbs_g: 0.145, fat_g: 0.003 },
    servings: [{ label: '1 cup', unit: 'cup', amount_g: 140 }],
    default_serving: 0,
  };
}

describe('getFoodById — parsing by source', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each(FOOD_SOURCES)('opens a food whose source is %s', async (source) => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify(foodBody(source)), { status: 200 }));

    const r = await getFoodById('f1');

    expect(r.status).toBe('ok');
    expect(r.food?.source).toBe(source);
    expect(r.food?.name).toBe('Frozen blueberries');
  });

  it('rejects a source that names nothing real, rather than inventing one', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify(foodBody('not_a_source')), { status: 200 }));

    const r = await getFoodById('f1');

    expect(r.status).toBe('error');
    expect(r.food).toBeNull();
  });
});
