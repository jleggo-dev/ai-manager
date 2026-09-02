/**
 * The day's foods, flattened — brief 04's view model.
 *
 * The rule that carries the most weight here is the smallest: a missing number renders "—", never
 * 0. A zero is a claim about the FOOD ("this has no fat"); a blank is a statement about US ("we
 * don't hold numbers for this"). The diary is full of hand-typed meals that matched nothing, so
 * the difference is the common case, not the edge one.
 */
import { describe, it, expect } from 'vitest';
import {
  amountText,
  cell,
  diaryGroups,
  diaryRows,
  isLegacyRecipeLog,
  isMealOpen,
  looseIndexesOf,
} from './foodDiaryRows.ts';
import type { Meal } from '../../lib/api.ts';

const meal = (over: Partial<Meal>): Meal => ({ log_id: 'm1', meal: 'lunch', items: [], macros: null, ...over }) as Meal;

/** Same helper, loose on shape: parts/state/item.part arrive off the wire wider than lib/api's
 *  `Meal` declares (see DiaryMeal), so the fixtures get to say them too. */
const wideMeal = (over: object): Meal =>
  ({ log_id: 'm1', date: '2026-09-02', meal: 'lunch', items: [], ...over }) as Meal;

describe('diaryRows', () => {
  it('gives every item its own row, addressed for correction', () => {
    const rows = diaryRows([
      meal({
        log_id: 'm1',
        items: [
          { name: 'seasoned peanuts', brand: 'couchetard or K.', qty: 35.5, unit: 'g', est: { kcal: 210 } },
          { name: 'dill pickles', est: { kcal: 5 } },
        ],
      }),
    ]);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ logId: 'm1', index: 0, name: 'seasoned peanuts', amount: '35.5 g' });
    expect(rows[1]).toMatchObject({ logId: 'm1', index: 1, name: 'dill pickles' });
  });

  it('keeps a meal that was never broken down as one row that owns the whole meal', () => {
    // index null — there is no addressable item, so it can be read but not repaired.
    const rows = diaryRows([meal({ items: [], raw_text: 'leftover curry', macros: { kcal: 600 } })]);
    expect(rows).toEqual([expect.objectContaining({ index: null, name: 'leftover curry', macros: { kcal: 600 } })]);
  });

  it('surfaces the vendor, which nothing else on any screen has ever shown', () => {
    const rows = diaryRows([meal({ items: [{ name: 'peanuts', brand: 'couchetard or K.' }] })]);
    expect(rows[0]!.brand).toBe('couchetard or K.');
  });
});

const chiaBowlMeal = wideMeal({
  log_id: 'm1',
  meal: 'breakfast',
  items: [
    { name: 'yogurt', qty: 150, unit: 'g', est: { kcal: 100 }, part: 'p1' },
    { name: 'chia', est: { kcal: 120 }, part: 'p1' },
    { name: 'whey', est: { kcal: 80 }, part: 'p1' },
    { name: 'strawberries', est: { kcal: 48 }, part: 'p1' },
    { name: 'chocolate chip muffin', qty: 1, unit: 'muffin', est: { kcal: 430 } },
  ],
  parts: [{ key: 'p1', name: 'Chia bowl', source: 'user' }],
  macros: { kcal: 778 },
});

const legacyMeal = wideMeal({
  log_id: 'm2',
  recipe_id: 'r9',
  items: [
    { name: 'Chia bowl', qty: 1, unit: 'serving', est: { kcal: 348 } },
    { name: 'yogurt', food_id: 'f1' },
    { name: 'chia', food_id: 'f2' },
  ],
  macros: { kcal: 348 },
});

describe('diaryGroups', () => {
  it('reads a bracket as one collapsed row — name, member count, part kcal — over addressable rows', () => {
    const groups = diaryGroups([chiaBowlMeal]);
    expect(groups).toHaveLength(2);
    expect(groups[0]).toMatchObject({
      kind: 'part',
      partKey: 'p1',
      logId: 'm1',
      label: 'Chia bowl',
      sub: '4 things',
      memberCount: 4,
      kcal: 348,
      several: false,
    });
    // The member rows keep their logId+index correction addresses — MealItemSheet's contract.
    const bowl = groups[0]!;
    expect(bowl.kind === 'part' && bowl.rows.map((r) => r.index)).toEqual([0, 1, 2, 3]);
    expect(groups[1]).toMatchObject({ kind: 'item', row: { index: 4, name: 'chocolate chip muffin' } });
  });

  it('rides yield on the same mark: "1 of 4 servings", no new row type', () => {
    const stew = wideMeal({
      items: [
        { name: 'chickpeas', est: { kcal: 80 }, part: 'p1' },
        { name: 'spinach', est: { kcal: 45 }, part: 'p1' },
      ],
      parts: [{ key: 'p1', name: 'Chickpea & spinach stew', yield_servings: 4, servings_logged: 1, source: 'user' }],
    });
    expect(diaryGroups([stew])[0]).toMatchObject({ kind: 'part', sub: '1 of 4 servings', several: true });
  });

  it('adapts a legacy recipe_id log reader-side: one part named by item[0], addresses intact', () => {
    const groups = diaryGroups([legacyMeal]);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({
      kind: 'part',
      partKey: null, // nothing to address on the server — it reads, it takes no ops
      label: 'Chia bowl',
      sub: '3 things',
      memberCount: 3,
      kcal: 348,
      several: false,
    });
    const g = groups[0]!;
    expect(g.kind === 'part' && g.rows.map((r) => r.index)).toEqual([0, 1, 2]);
  });

  it('does not read a parts meal — or a non-positional one — as legacy', () => {
    expect(isLegacyRecipeLog(legacyMeal)).toBe(true);
    expect(isLegacyRecipeLog(chiaBowlMeal)).toBe(false);
    expect(isLegacyRecipeLog(wideMeal({ recipe_id: 'r9', items: [{ name: 'stew', qty: 200, unit: 'g' }] }))).toBe(
      false,
    );
    expect(
      isLegacyRecipeLog(
        wideMeal({
          recipe_id: 'r9',
          items: [
            { name: 'stew', qty: 1, unit: 'serving', part: 'p1' },
            { name: 'x', part: 'p1' },
          ],
          parts: [{ key: 'p1', name: null, source: 'user' }],
        }),
      ),
    ).toBe(false);
  });
});

describe('looseIndexesOf', () => {
  it('offers only what is outside every bracket — and nothing on a legacy read', () => {
    expect(looseIndexesOf(chiaBowlMeal)).toEqual([4]);
    expect(looseIndexesOf(legacyMeal)).toEqual([]);
    expect(looseIndexesOf(meal({ items: [{ name: 'a' }, { name: 'b' }] }))).toEqual([0, 1]);
  });
});

describe('isMealOpen', () => {
  it('reads the state the API type does not declare yet', () => {
    expect(isMealOpen(wideMeal({ state: 'open' }))).toBe(true);
    expect(isMealOpen(meal({}))).toBe(false);
  });
});

describe('amountText', () => {
  it('says what they said', () => {
    expect(amountText(35.5, 'g')).toBe('35.5 g');
    expect(amountText(2, undefined)).toBe('2');
    expect(amountText(undefined, 'cup')).toBe('cup');
  });
  it('has nothing to say when nothing was said', () => {
    expect(amountText(undefined, undefined)).toBeNull();
  });
});

describe('cell', () => {
  it('is null — not zero — when we hold no number', () => {
    expect(cell({ kcal: 210 }, 'fat_g')).toBeNull();
    expect(cell(null, 'kcal')).toBeNull();
  });
  it('keeps a real zero, which is a fact about the food', () => {
    expect(cell({ fat_g: 0 }, 'fat_g')).toBe(0);
  });
  it('rounds — a diary is not a lab notebook', () => {
    expect(cell({ protein_g: 24.6 }, 'protein_g')).toBe(25);
  });
});
