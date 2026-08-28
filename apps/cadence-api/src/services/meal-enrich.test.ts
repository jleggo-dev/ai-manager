/**
 * The background half of the waterfall — "show logged, improve it after".
 *
 * Owner's ruling (2026-08-23): *"we don't have to show that slowness to the user. We can just show
 * 'logged' and input the information in the background — updating the user's UI / macros whenever
 * we get the update back."* Everything here defends the two properties that makes safe: it must be
 * idempotent (a retry or a second device must not buy the same lookup twice), and it must never
 * damage a meal that is already correct.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NutritionLog } from '@cadence/shared';

const findNutritionLog = vi.hoisted(() => vi.fn());
const updateNutritionLog = vi.hoisted(() => vi.fn());
const insertFood = vi.hoisted(() => vi.fn());
const updateFood = vi.hoisted(() => vi.fn());
const searchFoods = vi.hoisted(() => vi.fn());
const researchFood = vi.hoisted(() => vi.fn());

vi.mock('../repos/nutrition.ts', () => ({ findNutritionLog, updateNutritionLog }));
// updateFood/searchFoods are MP37 additions — `homeForResearchedFood` tries the existing row first
// (updateFood) and falls back to a name search (searchFoods, via food-pricing.ts's
// findOwnDuplicate) before ever minting a new one.
vi.mock('../repos/foods.ts', () => ({ insertFood, updateFood, searchFoods }));
vi.mock('./food-research.ts', async (orig) => ({ ...(await orig()), researchFood }));

import { enrichFlags, enrichMeal, itemsWantingResearch } from './meal-enrich.ts';

const meal = (over: Partial<NutritionLog> = {}): NutritionLog =>
  ({
    log_id: 'm1',
    date: '2026-08-23',
    meal: 'lunch',
    items: [{ name: 'dill pickle peanuts', brand: 'Couche-Tard', qty: 35.5, unit: 'g', est: { kcal: 180 } }],
    macros: { kcal: 180 },
    flags: { needs_enrich: true },
    ...over,
  }) as NutritionLog;

const found = {
  food: {
    food_id: '',
    name: 'Dill Pickle Peanuts',
    brand: 'The Carolina Nut Co.',
    source: 'research',
    base_unit: 'g',
    macros_per_base: { kcal: 571.4, protein_g: 21.4, carbs_g: 35.7, fat_g: 39.3, sodium_mg: 429 },
    servings: [{ label: '1 oz', unit: '1 oz', amount_g: 28 }],
    default_serving: 0,
    confidence: 0.9,
  },
  source_url: 'https://example.com/label',
};

beforeEach(() => {
  for (const m of [findNutritionLog, updateNutritionLog, insertFood, updateFood, searchFoods, researchFood]) {
    m.mockReset();
  }
  updateNutritionLog.mockImplementation(async (_u, _id, patch) => ({ ...meal(), ...patch }));
  insertFood.mockResolvedValue({ food_id: 'pinned-1' });
  searchFoods.mockResolvedValue([]); // no existing duplicate under this name, by default
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('enrichFlags', () => {
  it('flags a log only when something is actually worth looking up', () => {
    expect(enrichFlags([0])).toEqual({ needs_enrich: true });
    expect(enrichFlags([])).toEqual({});
  });
});

describe('itemsWantingResearch', () => {
  it('picks vendor-named items that matched nothing', () => {
    expect(itemsWantingResearch(meal())).toEqual([0]);
  });

  it('skips an item already priced from the ledger', () => {
    // A REAL priced item always carries `est` alongside `food_id` (`priceOne` sets both together) —
    // a food_id with no macros behind it is not what "already priced" looks like.
    const priced = meal({
      items: [
        {
          name: 'peanuts',
          brand: 'Couche-Tard',
          food_id: 'f-1',
          est: { kcal: 585, protein_g: 24, carbs_g: 20, fat_g: 45 },
        },
      ],
    });
    expect(itemsWantingResearch(priced)).toEqual([]);
  });

  it('skips an item with no vendor — the expensive rung needs the strong signal', () => {
    expect(itemsWantingResearch(meal({ items: [{ name: 'an apple' }] }))).toEqual([]);
  });

  /**
   * MP37: `food_id` alone used to mean "resolved, leave it alone" — so a food matched with
   * calories and nothing else earned a food_id at price time and was never reconsidered here.
   * `item.est` mirrors the matched food's completeness (it IS that food's macros, scaled), so this
   * checks the same bar `food-pricing.ts`'s `wants_research` checks instead of just presence.
   */
  it('still wants a lookup when the food it matched is THIN — calories and nothing else', () => {
    const thin = meal({
      items: [{ name: 'peanuts', brand: 'Couche-Tard', food_id: 'existing-thin-1', est: { kcal: 585 } }],
    });
    expect(itemsWantingResearch(thin)).toEqual([0]);
  });
});

describe('enrichMeal', () => {
  it('replaces the numbers AND the name, pins the food, and recomputes the meal', async () => {
    findNutritionLog.mockResolvedValue(meal());
    researchFood.mockResolvedValue(found);

    const out = await enrichMeal('u1', 'm1');
    expect(out.improved).toBe(1);

    const patch = updateNutritionLog.mock.calls[0]![2] as { items: NutritionLog['items']; macros: unknown };
    const item = patch.items[0]!;
    // "dill pickle peanuts" from a convenience store becomes the manufacturer's own name, with
    // nobody retyping anything — 571.4/100g × 35.5g.
    expect(item.name).toBe('Dill Pickle Peanuts');
    expect(item.brand).toBe('The Carolina Nut Co.');
    expect(item.food_id).toBe('pinned-1');
    expect(item.est!.kcal).toBeCloseTo(202.8, 0);
    expect(patch.macros).toMatchObject({ kcal: expect.any(Number), source: 'ledger' });
  });

  it('is idempotent — a retry or a second device buys nothing', async () => {
    findNutritionLog.mockResolvedValue(meal({ flags: { enriched: true } }));
    const out = await enrichMeal('u1', 'm1');
    expect(researchFood).not.toHaveBeenCalled();
    expect(updateNutritionLog).not.toHaveBeenCalled();
    expect(out.improved).toBe(0);
  });

  it('marks itself done even when there was nothing to look up', async () => {
    findNutritionLog.mockResolvedValue(meal({ items: [{ name: 'an apple' }] }));
    await enrichMeal('u1', 'm1');
    expect(researchFood).not.toHaveBeenCalled();
    expect(updateNutritionLog).toHaveBeenCalledWith('u1', 'm1', { flags: { enriched: true } });
  });

  it('leaves the meal exactly as it was when research finds nothing', async () => {
    findNutritionLog.mockResolvedValue(meal());
    researchFood.mockResolvedValue(null);

    const out = await enrichMeal('u1', 'm1');
    expect(out.improved).toBe(0);
    const patch = updateNutritionLog.mock.calls[0]![2] as { items: NutritionLog['items'] };
    expect(patch.items[0]!.name).toBe('dill pickle peanuts');
    expect(patch.items[0]!.est).toEqual({ kcal: 180 });
  });

  it('keeps the better numbers even if the pin fails — the meal is what the user sees', async () => {
    findNutritionLog.mockResolvedValue(meal());
    researchFood.mockResolvedValue(found);
    insertFood.mockRejectedValue(new Error('db down'));

    const out = await enrichMeal('u1', 'm1');
    expect(out.improved).toBe(1);
    const patch = updateNutritionLog.mock.calls[0]![2] as { items: NutritionLog['items'] };
    expect(patch.items[0]!.est!.kcal).toBeCloseTo(202.8, 0);
    expect(patch.items[0]!.food_id).toBeUndefined();
  });

  it('says so plainly when the meal is gone', async () => {
    findNutritionLog.mockResolvedValue(null);
    expect(await enrichMeal('u1', 'nope')).toEqual({ meal: null, improved: 0 });
  });
});
