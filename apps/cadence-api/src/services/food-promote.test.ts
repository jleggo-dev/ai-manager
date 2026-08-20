/**
 * Promotion, end to end over mocked repos — no DB, no AI.
 *
 * This is the regression net for the bug itself: a meal logged in words wrote a `nutrition_logs`
 * row and stopped, so `cadence.foods` and `cadence.food_usage` stayed empty and search found
 * nothing. Every test here asserts on what the repos were ASKED to do, because that — not the
 * shaping — is the half that was missing.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Food, NutritionLog } from '@cadence/shared';

const insertFood = vi.fn();
const listOwnFoods = vi.fn();
const touchFoodUsage = vi.fn();
const updateNutritionLog = vi.fn();

vi.mock('../repos/foods.ts', () => ({
  insertFood: (...a: unknown[]) => insertFood(...a),
  listOwnFoods: (...a: unknown[]) => listOwnFoods(...a),
  touchFoodUsage: (...a: unknown[]) => touchFoodUsage(...a),
}));
vi.mock('../repos/nutrition.ts', () => ({
  updateNutritionLog: (...a: unknown[]) => updateNutritionLog(...a),
}));

const { promoteLoggedFoods, promoteLoggedFoodsSafely } = await import('./food-promote.ts');

const LATTE = { name: 'Starbucks latte', unit: 'venti', qty: 1, est: { kcal: 250, protein_g: 13 } };

function log(partial: Partial<NutritionLog> = {}): NutritionLog {
  return {
    log_id: 'log-1',
    date: '2026-08-20',
    meal: 'breakfast',
    items: [LATTE],
    macros: { kcal: 250 },
    input_method: 'text',
    ai_confidence: 0.8,
    provisional: false,
    raw_text: 'starbucks venti latte',
    ...partial,
  };
}

function savedFood(name: string, food_id: string): Food {
  return {
    food_id,
    owner_user_id: 'u1',
    visibility: 'private',
    name,
    brand: null,
    source: 'llm',
    off_id: null,
    fdc_id: null,
    base_unit: 'item',
    macros_per_base: { kcal: 250 },
    servings: [{ label: 'venti', unit: 'venti', amount_g: 1 }],
    default_serving: 0,
    confidence: 0.8,
    photo_ref: null,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  listOwnFoods.mockResolvedValue([]);
  insertFood.mockImplementation((_u: string, input: { name: string }) =>
    Promise.resolve(savedFood(input.name, `new-${input.name}`)),
  );
  updateNutritionLog.mockImplementation((_u: string, _id: string, patch: { items: NutritionLog['items'] }) =>
    Promise.resolve(log({ items: patch.items })),
  );
});

describe('promoteLoggedFoods', () => {
  it('turns a meal logged in words into a Food, a usage row, and a correlated log', async () => {
    const out = await promoteLoggedFoods('u1', log());

    expect(out.created).toBe(1);
    expect(insertFood).toHaveBeenCalledTimes(1);
    const [, created] = insertFood.mock.calls[0]!;
    expect(created).toMatchObject({
      name: 'Starbucks latte',
      source: 'llm',
      base_unit: 'item',
      confidence: 0.8, // the parse's own confidence rides along, not a fresh claim
    });

    // Recents/frequents are a projection of food_usage — this call is the whole feature.
    expect(touchFoodUsage).toHaveBeenCalledWith('u1', 'new-Starbucks latte');

    // And the log now points at it, so "you usually have at breakfast" (which tallies by
    // items[].food_id) can finally see it.
    expect(out.log.items[0]!.food_id).toBe('new-Starbucks latte');
    expect(out.log.items[0]).toMatchObject({ name: 'Starbucks latte', unit: 'venti', qty: 1 });
  });

  it('logs a second latte against the SAME food instead of a twin', async () => {
    listOwnFoods.mockResolvedValue([savedFood('Starbucks latte', 'f-latte')]);

    const out = await promoteLoggedFoods('u1', log({ log_id: 'log-2' }));

    expect(insertFood).not.toHaveBeenCalled();
    expect(out.matched).toBe(1);
    expect(out.created).toBe(0);
    expect(touchFoodUsage).toHaveBeenCalledWith('u1', 'f-latte');
    expect(out.log.items[0]!.food_id).toBe('f-latte');
  });

  it('does not mint twins WITHIN one meal either', async () => {
    const items = [
      { name: 'toast', qty: 1, est: { kcal: 90 } },
      { name: 'Toast', qty: 1, est: { kcal: 90 } },
    ];
    const out = await promoteLoggedFoods('u1', log({ items }));

    expect(insertFood).toHaveBeenCalledTimes(1);
    expect(out.created).toBe(1);
    expect(out.matched).toBe(1);
    expect(out.log.items[0]!.food_id).toBe(out.log.items[1]!.food_id);
  });

  it('leaves a provisional parse entirely alone', async () => {
    const out = await promoteLoggedFoods('u1', log({ provisional: true, ai_confidence: 0.3 }));

    expect(listOwnFoods).not.toHaveBeenCalled();
    expect(insertFood).not.toHaveBeenCalled();
    expect(touchFoodUsage).not.toHaveBeenCalled();
    expect(updateNutritionLog).not.toHaveBeenCalled();
    expect(out.log.items[0]!.food_id).toBeUndefined();
  });

  it('skips items with no macros, and items that already have a food', async () => {
    const items = [
      { name: 'a handful of something', qty: 1 },
      { name: 'yogurt', qty: 1, est: { kcal: 120 }, food_id: 'f-already' },
    ];
    const out = await promoteLoggedFoods('u1', log({ items }));

    expect(insertFood).not.toHaveBeenCalled();
    expect(touchFoodUsage).not.toHaveBeenCalled();
    expect(updateNutritionLog).not.toHaveBeenCalled();
    expect(out).toMatchObject({ created: 0, matched: 0 });
  });

  it('caps how many foods one over-itemised parse can mint', async () => {
    const items = Array.from({ length: 12 }, (_, i) => ({ name: `thing ${i}`, qty: 1, est: { kcal: 50 } }));
    const out = await promoteLoggedFoods('u1', log({ items }));

    expect(out.created).toBe(8);
    expect(insertFood).toHaveBeenCalledTimes(8);
    expect(out.log.items[11]!.food_id).toBeUndefined();
  });

  it('keeps the meal when remembering the food fails', async () => {
    touchFoodUsage.mockRejectedValue(new Error('usage table on fire'));
    const original = log();

    await expect(promoteLoggedFoods('u1', original)).rejects.toThrow();
    // The wrapper the write paths actually call swallows it and hands the meal back intact.
    await expect(promoteLoggedFoodsSafely('u1', original)).resolves.toBe(original);
  });
});
