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
    // No `needs_enrich` on this meal — it was never flagged, so zero targets is a genuinely empty
    // result, not the MP37 mismatch the next describe block covers. Silent here is correct.
    findNutritionLog.mockResolvedValue(meal({ items: [{ name: 'an apple' }], flags: {} }));
    await enrichMeal('u1', 'm1');
    expect(researchFood).not.toHaveBeenCalled();
    expect(updateNutritionLog).toHaveBeenCalledWith('u1', 'm1', { flags: { enriched: true } });
    expect(console.error).not.toHaveBeenCalled();
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

/**
 * MP37 round trip — a thin MATCHED item, not just a flat miss, must actually get improved, and
 * must never turn into a second row for the same words. The incident on record in
 * `food-pricing.ts`'s pin-gate comment is the one to design against: a completeness-gated PIN once
 * made a calories-only row fail its own check on every later log, pin a SECOND row each time, and
 * the same words resolve to a different food on every occurrence.
 */
describe('enrichMeal — a thin MATCHED item is improved in place, never duplicated (MP37)', () => {
  const thinMatch = (foodId: string) =>
    meal({
      items: [{ name: 'peanuts', brand: 'Couche-Tard', qty: 35.5, unit: 'g', food_id: foodId, est: { kcal: 180 } }],
    });

  it('updates the row it already matched — same id, no second pin', async () => {
    findNutritionLog.mockResolvedValue(thinMatch('existing-thin-1'));
    researchFood.mockResolvedValue(found);
    updateFood.mockResolvedValue({ ...found.food, food_id: 'existing-thin-1' });

    const out = await enrichMeal('u1', 'm1');

    expect(out.improved).toBe(1);
    // The row these words already resolved to is the one that gets better.
    expect(updateFood).toHaveBeenCalledWith(
      'u1',
      'existing-thin-1',
      expect.objectContaining({ name: 'Dill Pickle Peanuts', macros_per_base: found.food.macros_per_base }),
    );
    // Never a second row: no dedup search needed (the update itself succeeded) and no fresh pin.
    expect(searchFoods).not.toHaveBeenCalled();
    expect(insertFood).not.toHaveBeenCalled();

    const patch = updateNutritionLog.mock.calls[0]![2] as { items: NutritionLog['items'] };
    // SAME id as before the lookup — a LATER log of these same words still resolves here.
    expect(patch.items[0]!.food_id).toBe('existing-thin-1');
    expect(patch.items[0]!.est!.kcal).toBeCloseTo(202.8, 0);
  });

  it('falls back to the dedup search when the matched row is SHARED — updateFood correctly refuses it', async () => {
    // `updateFood`'s own WHERE clause (owner_user_id = userId) returns null for a row this user
    // does not own — a CNF/USDA/FatSecret row, thin, and matched the same way for every user who
    // searches these words. Mutating it on the strength of one person's web lookup would be wrong
    // in the OPPOSITE direction from the duplicate-pin incident, so this must fall through instead.
    findNutritionLog.mockResolvedValue(thinMatch('shared-thin-1'));
    researchFood.mockResolvedValue(found);
    updateFood.mockResolvedValue(null);

    const out = await enrichMeal('u1', 'm1');

    expect(out.improved).toBe(1);
    expect(updateFood).toHaveBeenCalledWith('u1', 'shared-thin-1', expect.anything());
    // Fell through to the exact dedup-then-insert path a flat miss uses — never touched the shared row.
    expect(searchFoods).toHaveBeenCalled();
    expect(insertFood).toHaveBeenCalledOnce();
    const patch = updateNutritionLog.mock.calls[0]![2] as { items: NutritionLog['items'] };
    expect(patch.items[0]!.food_id).toBe('pinned-1');
  });

  it('reuses a food the user already owns under this name, rather than minting a duplicate', async () => {
    // The exact guard `pinItem` uses before minting from `estimate-food` (`food-pricing.ts`,
    // `findOwnDuplicate`) — reused here rather than re-implemented, so the two callers can never
    // drift into disagreeing about what counts as "the same food".
    findNutritionLog.mockResolvedValue(meal()); // no food_id at all — a flat miss, not a thin match
    researchFood.mockResolvedValue(found);
    searchFoods.mockResolvedValue([
      {
        food_id: 'own-existing-1',
        owner_user_id: 'u1',
        visibility: 'private',
        name: 'Dill Pickle Peanuts',
        brand: 'The Carolina Nut Co.',
        source: 'llm',
        base_unit: 'g',
        macros_per_base: { kcal: 500 },
        servings: [{ label: '100 g', unit: 'g', amount_g: 100 }],
        default_serving: 0,
        confidence: null,
        photo_ref: null,
      },
    ]);

    const out = await enrichMeal('u1', 'm1');

    expect(out.improved).toBe(1);
    expect(insertFood).not.toHaveBeenCalled();
    const patch = updateNutritionLog.mock.calls[0]![2] as { items: NutritionLog['items'] };
    expect(patch.items[0]!.food_id).toBe('own-existing-1');
  });

  it('mismatch: needs_enrich said there was work, this found none — logged loudly, not silently completed', async () => {
    /**
     * `targets.length === 0` used to read as "nothing to do" whatever the flag said (MP37). But
     * "I found nothing to do" and "I was told there was work and found none" are different facts —
     * the same error-vs-empty distinction this PR enforces for tool text (`tool-response.ts`), one
     * layer over. `needs_enrich: true` is set at price time from the identical gate read here, so
     * a real mismatch means the meal's items changed shape in between — worth knowing about, not
     * worth hiding behind the same "all done" flag a legitimate empty pass also sets.
     */
    findNutritionLog.mockResolvedValue(meal({ items: [{ name: 'an apple' }], flags: { needs_enrich: true } }));

    const out = await enrichMeal('u1', 'm1');

    expect(researchFood).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('m1'));
    // Still marked enriched — retrying changes nothing about this meal's current items, and an
    // endless, silent retry loop is worse than a completion that also said something was off.
    expect(updateNutritionLog).toHaveBeenCalledWith('u1', 'm1', { flags: { enriched: true } });
    expect(out.improved).toBe(0);
  });
});
