/**
 * What these pin (docs/cadence/MEAL-LOGGING.md, "Making and unmaking"):
 *   • NO reducer ever changes the meal's numbers — grouping only changes how the day reads back;
 *   • a part below two members dissolves on its own — a recipe of one item isn't a recipe;
 *   • nested brackets are refused at the reducer, not just at the server;
 *   • totals are floors: a nutrient nobody carries never appears as an invented zero.
 */
import { describe, it, expect } from 'vitest';
import type { MealItem, MealPart } from '@cadence/shared';
import {
  addToPart,
  canDissolve,
  collapsedSub,
  groupIndexes,
  looseItems,
  membersOf,
  nextPartKey,
  orderedRows,
  partLabel,
  partTotal,
  removeFromPart,
  renamePart,
  sumEst,
  ungroup,
  type PartsState,
} from './partModel.ts';

/** The A1 breakfast: two brackets and a loose muffin. Frozen — a reducer must never mutate. */
function fixture(): PartsState {
  const items: MealItem[] = [
    {
      name: 'Greek yogurt, plain 2%',
      qty: 1,
      unit: 'cup',
      est: { kcal: 146, protein_g: 20, iron_mg: 0.1 },
      part: 'p1',
    },
    { name: 'Chia seeds', qty: 1, unit: 'tbsp', est: { kcal: 58, fat_g: 4 }, part: 'p1' },
    { name: 'Whey protein, vanilla', qty: 1, unit: 'scoop', est: { kcal: 120, protein_g: 24 }, part: 'p1' },
    { name: 'Strawberries, raw', qty: 0.5, unit: 'cup', est: { kcal: 24, vitamin_c_mg: 42 }, part: 'p1' },
    { name: 'Filter coffee, black', qty: 1, unit: 'mug', est: { kcal: 5 }, part: 'p2' },
    { name: 'Oat milk, barista', qty: 100, unit: 'ml', est: { kcal: 57 }, part: 'p2' },
    { name: 'Chocolate chip muffin', qty: 1, unit: 'muffin', est: { kcal: 430, carbs_g: 55 } },
  ];
  const parts: MealPart[] = [
    { key: 'p1', name: 'Chia bowl', source: 'user' },
    { key: 'p2', name: 'Coffee & oat milk', source: 'user' },
  ];
  for (const it of items) {
    if (it.est) Object.freeze(it.est);
    Object.freeze(it);
  }
  parts.forEach(Object.freeze);
  return { items: Object.freeze(items) as unknown as MealItem[], parts: Object.freeze(parts) as unknown as MealPart[] };
}

const allIndexes = (items: MealItem[]) => items.map((_, i) => i);

/** The invariant every reducer must keep: the meal's summed numbers are untouched. */
function expectSameTotals(before: PartsState, after: PartsState) {
  expect(sumEst(after.items, allIndexes(after.items))).toEqual(sumEst(before.items, allIndexes(before.items)));
  // Stronger than equal sums: every est object survives by REFERENCE — nothing was recomputed.
  for (const it of after.items) {
    expect(before.items.some((o) => o.est === it.est)).toBe(true);
  }
}

describe('reading helpers', () => {
  it('membersOf / looseItems split the meal', () => {
    const s = fixture();
    expect(membersOf(s.items, 'p1')).toEqual([0, 1, 2, 3]);
    expect(membersOf(s.items, 'p2')).toEqual([4, 5]);
    expect(looseItems(s.items, s.parts)).toEqual([6]);
  });

  it('an item pointing at a part that does not exist reads as loose', () => {
    const items: MealItem[] = [{ name: 'ghost', part: 'gone' }, { name: 'plain' }];
    expect(looseItems(items, [])).toEqual([0, 1]);
  });

  it('partTotal sums every nutrient present and invents none', () => {
    const s = fixture();
    const total = partTotal(s.items, 'p1');
    expect(total.kcal).toBe(348);
    expect(total.protein_g).toBe(44);
    expect(total.fat_g).toBe(4);
    expect(total.iron_mg).toBeCloseTo(0.1);
    expect(total.vitamin_c_mg).toBe(42);
    // Nobody in the bowl carries carbs — the total is a floor, not a zero.
    expect('carbs_g' in total).toBe(false);
    expect('source' in total).toBe(false);
  });

  it('partLabel: the name they gave it, or a plain count', () => {
    expect(partLabel({ key: 'p1', name: 'Chia bowl' }, 4)).toBe('Chia bowl');
    expect(partLabel({ key: 'p1', name: null }, 4)).toBe('4 things');
  });

  it('collapsedSub: "4 things", or "1 of 4 servings" when the yield says so', () => {
    expect(collapsedSub({ key: 'p1', name: 'Chia bowl' }, 4)).toBe('4 things');
    expect(collapsedSub({ key: 'p3', name: 'Chickpea & spinach stew', yield_servings: 4, servings_logged: 1 }, 5)).toBe(
      '1 of 4 servings',
    );
  });

  it('orderedRows: parts as blocks in first-member order, loose items in place', () => {
    const s = fixture();
    const rows = orderedRows(s.items, s.parts);
    expect(rows.map((r) => (r.kind === 'part' ? r.part.key : `i${r.index}`))).toEqual(['p1', 'p2', 'i6']);
    const first = rows[0];
    expect(first?.kind === 'part' && first.memberIndexes).toEqual([0, 1, 2, 3]);
  });

  it('canDissolve: true at two members, false above', () => {
    const s = fixture();
    expect(canDissolve(s.items, 'p1')).toBe(false);
    expect(canDissolve(s.items, 'p2')).toBe(true);
  });

  it('nextPartKey skips keys already in use', () => {
    expect(nextPartKey([])).toBe('p1');
    expect(
      nextPartKey([
        { key: 'p1', name: null },
        { key: 'p3', name: null },
      ]),
    ).toBe('p2');
  });
});

describe('groupIndexes', () => {
  const flat = (): PartsState => ({
    items: ['a', 'b', 'c', 'd', 'e'].map((name, i) => ({ name, est: { kcal: (i + 1) * 10 } })),
    parts: [],
  });

  it('brackets the chosen loose rows and changes no numbers', () => {
    const before = flat();
    const after = groupIndexes(before, [0, 1, 3], 'Chia bowl');
    expect(after.parts).toEqual([{ key: 'p1', name: 'Chia bowl', source: 'user' }]);
    expect(membersOf(after.items, 'p1')).toEqual([0, 1, 3]);
    expect(looseItems(after.items, after.parts)).toEqual([2, 4]);
    expectSameTotals(before, after);
  });

  it('an unnamed group is legal and reads as a count', () => {
    const after = groupIndexes(flat(), [1, 2]);
    expect(after.parts[0]?.name).toBeNull();
  });

  it('ignores indexes already inside a bracket — brackets never nest', () => {
    const before = fixture();
    // Only one loose row survives the filter, so there is nothing to make.
    expect(groupIndexes(before, [0, 1, 6])).toBe(before);
    // With a second loose row, the bracketed index is dropped and the loose pair still groups.
    const withJuice: PartsState = {
      items: [...before.items, { name: 'juice', est: { kcal: 40 } }],
      parts: before.parts,
    };
    const after = groupIndexes(withJuice, [0, 6, 7]);
    expect(membersOf(after.items, 'p3')).toEqual([6, 7]);
    expect(membersOf(after.items, 'p1')).toEqual([0, 1, 2, 3]);
    expectSameTotals(withJuice, after);
  });

  it('fewer than two survivors is a no-op', () => {
    const before = flat();
    expect(groupIndexes(before, [2])).toBe(before);
    expect(groupIndexes(before, [])).toBe(before);
  });
});

describe('ungroup', () => {
  it('dissolves the bracket, keeps every item and every number', () => {
    const before = fixture();
    const after = ungroup(before, 'p1');
    expect(after.parts.map((p) => p.key)).toEqual(['p2']);
    expect(looseItems(after.items, after.parts)).toEqual([0, 1, 2, 3, 6]);
    expect(after.items).toHaveLength(before.items.length);
    expectSameTotals(before, after);
  });

  it('an unknown part is a no-op', () => {
    const before = fixture();
    expect(ungroup(before, 'p9')).toBe(before);
  });
});

describe('addToPart', () => {
  it('a loose row joins; numbers untouched', () => {
    const before = fixture();
    const after = addToPart(before, 'p2', 6);
    expect(membersOf(after.items, 'p2')).toEqual([4, 5, 6]);
    expectSameTotals(before, after);
  });

  it('a member of another bracket cannot join — no nesting, no theft', () => {
    const before = fixture();
    expect(addToPart(before, 'p2', 0)).toBe(before);
  });
});

describe('removeFromPart', () => {
  it('a member leaves a bracket of three or more; the bracket stays', () => {
    const before = fixture();
    const after = removeFromPart(before, 'p1', 3);
    expect(membersOf(after.items, 'p1')).toEqual([0, 1, 2]);
    expect(looseItems(after.items, after.parts)).toEqual([3, 6]);
    expectSameTotals(before, after);
  });

  it('taking the second-to-last member out dissolves the bracket', () => {
    const before = fixture();
    const after = removeFromPart(before, 'p2', 4);
    expect(after.parts.map((p) => p.key)).toEqual(['p1']);
    expect(looseItems(after.items, after.parts)).toEqual([4, 5, 6]);
    expectSameTotals(before, after);
  });

  it('removing an item that is not a member is a no-op', () => {
    const before = fixture();
    expect(removeFromPart(before, 'p1', 6)).toBe(before);
  });
});

describe('renamePart', () => {
  it('names, un-names, and never touches membership or numbers', () => {
    const before = fixture();
    const named = renamePart(before, 'p1', 'Yogurt bowl');
    expect(named.parts[0]?.name).toBe('Yogurt bowl');
    expect(named.items).toBe(before.items);
    expectSameTotals(before, named);
    const unnamed = renamePart(named, 'p1', null);
    expect(unnamed.parts[0]?.name).toBeNull();
  });
});
