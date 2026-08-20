/**
 * The two judgement calls in promoting a logged item to a Food: what shape it takes, and whether
 * the user already has it. Pure — no DB, no AI.
 *
 * The round-trip assertions are the point of the whole feature: `macrosForLog(food)` with the
 * food's own default serving and quantity 1 must reproduce exactly what was logged, because that
 * is what makes "I had a second latte" one tap that invents no numbers.
 */
import { describe, it, expect } from 'vitest';
import { macrosForLog, type Food } from '@cadence/shared';
import { isPromotable, matchOwnFood, promotableName, shapeFromItem } from './food-promote-shape.ts';

function asFood(shape: NonNullable<ReturnType<typeof shapeFromItem>>, name = 'x'): Food {
  return {
    food_id: 'f1',
    owner_user_id: 'u1',
    visibility: 'private',
    name,
    brand: null,
    source: 'llm',
    off_id: null,
    fdc_id: null,
    confidence: 0.8,
    photo_ref: null,
    ...shape,
  };
}

function own(name: string, brand: string | null = null, food_id = name): Food {
  return {
    food_id,
    owner_user_id: 'u1',
    visibility: 'private',
    name,
    brand,
    source: 'llm',
    off_id: null,
    fdc_id: null,
    base_unit: 'item',
    macros_per_base: { kcal: 100 },
    servings: [{ label: '1 serving', unit: 'serving', amount_g: 1 }],
    default_serving: 0,
    confidence: null,
    photo_ref: null,
  };
}

describe('shapeFromItem', () => {
  it("keeps a free-text unit as a named serving — the owner's venti latte", () => {
    // Exactly the row on his account: full macros, no food_id, a unit the food model never knew.
    const shape = shapeFromItem({
      name: 'Starbucks latte',
      unit: 'venti',
      qty: 1,
      est: { kcal: 250, protein_g: 13, carbs_g: 24, fat_g: 11, source: 'ai' },
    });
    expect(shape).not.toBeNull();
    expect(shape!.base_unit).toBe('item');
    expect(shape!.servings).toEqual([{ label: 'venti', unit: 'venti', amount_g: 1 }]);
    // No `source` leaks into a food's per-base nutrients.
    expect(shape!.macros_per_base).not.toHaveProperty('source');
    // One tap re-logs the same latte, to the calorie.
    expect(macrosForLog(asFood(shape!))).toMatchObject({ kcal: 250, protein_g: 13, carbs_g: 24, fat_g: 11 });
  });

  it('divides a multi-unit portion down to one, and serves the portion back whole', () => {
    const shape = shapeFromItem({ name: 'eggs', qty: 3, est: { kcal: 210, protein_g: 18 } })!;
    expect(shape.base_unit).toBe('item');
    expect(shape.macros_per_base.kcal).toBe(70); // per egg — so 2 eggs later is honest too
    expect(shape.servings[0]).toEqual({ label: '3 servings', unit: 'serving', amount_g: 3 });
    expect(macrosForLog(asFood(shape)).kcal).toBe(210);
  });

  it('converts unambiguous mass to a per-100 g base', () => {
    const shape = shapeFromItem({ name: 'oats', qty: 150, unit: 'g', est: { kcal: 580 } })!;
    expect(shape.base_unit).toBe('g');
    expect(shape.servings[0]).toEqual({ label: '150 g', unit: 'g', amount_g: 150 });
    expect(macrosForLog(asFood(shape)).kcal).toBeCloseTo(580, 0);
  });

  it('converts litres to millilitres', () => {
    const shape = shapeFromItem({ name: 'smoothie', qty: 0.5, unit: 'L', est: { kcal: 300 } })!;
    expect(shape.base_unit).toBe('ml');
    expect(shape.servings[0]).toEqual({ label: '500 ml', unit: 'ml', amount_g: 500 });
    expect(macrosForLog(asFood(shape)).kcal).toBeCloseTo(300, 0);
  });

  it('leaves ambiguous units named rather than guessing a mass', () => {
    // "oz" is fluid on a latte and weight on a steak; "cup" is a different mass for every food.
    for (const unit of ['oz', 'cup', 'bowl']) {
      const shape = shapeFromItem({ name: 'thing', qty: 1, unit, est: { kcal: 120 } })!;
      expect(shape.base_unit).toBe('item');
      expect(shape.servings[0]!.unit).toBe(unit);
      expect(macrosForLog(asFood(shape)).kcal).toBe(120);
    }
  });

  it('falls back to a plain serving when there is no unit at all', () => {
    const shape = shapeFromItem({ name: 'porridge', est: { kcal: 200 } })!;
    expect(shape.servings[0]).toEqual({ label: '1 serving', unit: 'serving', amount_g: 1 });
  });
});

describe('isPromotable', () => {
  it('remembers only items that carry real calories', () => {
    expect(isPromotable({ name: 'latte', est: { kcal: 250 } })).toBe(true);
    // No numbers: a word the parser could not price is not a food worth offering a one-tap ＋ for.
    expect(isPromotable({ name: 'a bit of salad' })).toBe(false);
    expect(isPromotable({ name: 'water', est: { protein_g: 0 } })).toBe(false);
  });

  it('leaves items that already have a Food behind them alone', () => {
    expect(isPromotable({ name: 'latte', est: { kcal: 250 }, food_id: 'f-existing' })).toBe(false);
  });

  it('rejects names that are not words', () => {
    expect(promotableName('  ')).toBeNull();
    expect(promotableName('-')).toBeNull();
    expect(promotableName('  Greek   yogurt ')).toBe('Greek yogurt');
  });
});

describe('matchOwnFood', () => {
  it('bumps the same food instead of minting a twin', () => {
    const foods = [own('Starbucks latte')];
    expect(matchOwnFood('starbucks latte', foods)?.food_id).toBe('Starbucks latte');
    expect(matchOwnFood('Starbucks Latte', foods)?.food_id).toBe('Starbucks latte');
  });

  it('survives plural and casing drift', () => {
    expect(matchOwnFood('greek yogurts', [own('Greek yogurt')])).not.toBeNull();
    expect(matchOwnFood('Scrambled Eggs', [own('scrambled egg')])).not.toBeNull();
  });

  it('matches across the brand/name split, either way round', () => {
    // A barcode scan saved it as name "Latte" + brand "Starbucks"; the parser says it in one line.
    expect(matchOwnFood('starbucks latte', [own('Latte', 'Starbucks')])).not.toBeNull();
  });

  it('does NOT merge a name that is merely contained in another', () => {
    // A latte made at home is not the 250-kcal Starbucks one — merging would re-log the wrong
    // numbers under a name the user never chose.
    expect(matchOwnFood('latte', [own('Starbucks latte')])).toBeNull();
    expect(matchOwnFood('rice', [own('fried rice with chicken')])).toBeNull();
  });

  it('does NOT merge names that differ only by a number', () => {
    // The ranker strips bare numerals so "3 eggs" matches "eggs" — which left 1% and 2% milk
    // scoring identically in both directions. A numeral inside a NAME is usually the difference.
    expect(matchOwnFood('2% milk', [own('1% milk')])).toBeNull();
    expect(matchOwnFood('thing 1', [own('thing 0')])).toBeNull();
    // …but the same name with the same numbers still merges.
    expect(matchOwnFood('2% Milk', [own('2% milk')])).not.toBeNull();
  });

  it('returns null against an empty or unrelated list', () => {
    expect(matchOwnFood('latte', [])).toBeNull();
    expect(matchOwnFood('latte', [own('porridge'), own('banana')])).toBeNull();
  });
});
