import { describe, it, expect } from 'vitest';
import type { Food } from '@cadence/shared';
import {
  candidateNotes,
  findDisagreements,
  hasFullMacros,
  matchMeasure,
  preferredServing,
  toCandidate,
  type SourceCandidate,
} from './food-source-report.ts';

/**
 * The Coach's view of one source's answer.
 *
 * The contract under test is the owner's sentence: macros and nutrients **by a quantity of a
 * measure**, with the other measures listed so she can ask for a different one. And the harder
 * half — that nothing here decides anything. A thin row comes back labelled thin, a source that
 * contradicts itself comes back with the contradiction attached, and two sources that disagree
 * both survive. Adjudication is hers.
 */

const food = (over: Partial<Food> = {}): Food =>
  ({
    food_id: 'f1',
    owner_user_id: null,
    visibility: 'public',
    name: 'Shallots, raw',
    brand: null,
    source: 'usda',
    off_id: null,
    fdc_id: 11677,
    base_unit: 'g',
    macros_per_base: { kcal: 72, protein_g: 2.5, carbs_g: 16.8, fat_g: 0.1, iron_mg: 1.2 },
    servings: [
      { label: '1 tbsp chopped', unit: 'tbsp', amount_g: 10 },
      { label: '100 g', unit: 'g', amount_g: 100 },
    ],
    default_serving: 0,
    confidence: null,
    photo_ref: null,
    created_at: '',
    ...over,
  }) as Food;

describe('a candidate answers in the measure that was asked for', () => {
  it('prices at the requested measure rather than per 100 g', () => {
    const c = toCandidate(food(), 'usda', '1 tbsp chopped');
    expect(c.per.measure).toBe('1 tbsp chopped');
    expect(c.per.grams).toBe(10);
    // 10 g of a 72 kcal/100 g food.
    expect(c.per.nutrients.kcal).toBeCloseTo(7.2, 1);
  });

  it('matches a measure loosely, because she types like a person', () => {
    expect(matchMeasure(food(), 'tbsp')?.amount_g).toBe(10);
    expect(matchMeasure(food(), '1 TBSP CHOPPED')?.amount_g).toBe(10);
    expect(matchMeasure(food(), 'cup')).toBeNull();
  });

  it('lists the other measures so asking for a different one is one more call', () => {
    const c = toCandidate(food(), 'usda');
    expect(c.measures).toEqual([
      { label: '1 tbsp chopped', grams: 10 },
      { label: '100 g', grams: 100 },
    ]);
  });

  it('falls back to the default serving when no measure is named', () => {
    expect(preferredServing(food())?.label).toBe('1 tbsp chopped');
    expect(toCandidate(food(), 'usda').per.measure).toBe('1 tbsp chopped');
  });

  /**
   * The shallots case. The food is fine; the unit is not, and the code must NOT invent a density —
   * it says so and points at the tool that can find one.
   */
  it('says plainly when the source has no such measure, and never guesses a density', () => {
    const c = toCandidate(food(), 'usda', '1/4 cup');
    expect(c.notes.join(' ')).toContain('no "1/4 cup" measure');
    expect(c.notes.join(' ')).toMatch(/resolve_portion/);
    expect(c.per.measure).not.toContain('cup');
  });

  /**
   * MP1: a CNF row spells its household measures as raw "15 mL (16 g)" rows, never as "tbsp" —
   * even though Health Canada's own convention already IS 1 tbsp = 15 mL. Before this fix, asking
   * for "1 tbsp" against a food shaped like this fell all the way to the "no such measure" branch
   * above and reported per-100g with a note, even though the food's OWN data already answered it.
   * Real CNF row shape (Spices, rosemary, dried), verified against production 2026-08-28.
   */
  it('reaches a CNF-shaped food\'s own ml row for a spoken "tbsp" instead of falling back to 100 g', () => {
    const rosemary = food({
      name: 'Spices, rosemary, dried',
      source: 'cnf',
      macros_per_base: { kcal: 331, protein_g: 4.9, carbs_g: 64.1, fat_g: 15.2 },
      servings: [
        { unit: '5ml', label: '5ml (1.2g)', amount_g: 1.2 },
        { unit: '15ml', label: '15ml (3.3g)', amount_g: 3.3 },
        { unit: 'g', label: '100 g', amount_g: 100 },
      ],
      default_serving: 2,
    });
    const c = toCandidate(rosemary, 'ledger', '1 tbsp');
    expect(c.per.measure).toBe('1 tbsp');
    expect(c.per.grams).toBeCloseTo(3.25, 1); // scaled from the food's own 15 ml row, not 100 g
    expect(c.per.nutrients.kcal).toBeCloseTo(10.8, 0); // NOT 331 (the old, per-100g fallback)
    expect(c.notes.join(' ')).toContain('scaled from its own');
  });
});

describe('guards report as evidence, never as a veto', () => {
  it('keeps a record whose energy contradicts its own macros, and says so', () => {
    // 160 kcal claimed; 4(21.4) + 4(35.7) + 9(39.3) implies ~582 — the real dill-pickle-peanut
    // shape, where a per-ounce label was filed as per-100g and every number shifted together.
    const notes = candidateNotes(food(), { kcal: 160, protein_g: 21.4, carbs_g: 35.7, fat_g: 39.3 });
    expect(notes.join(' ')).toContain('Energy and macros disagree');
    expect(notes.join(' ')).toContain('582');
  });

  it('stays quiet when Atwater agrees', () => {
    expect(candidateNotes(food(), { kcal: 72, protein_g: 2.5, carbs_g: 16.8, fat_g: 0.1 }).join(' ')).not.toContain(
      'disagree',
    );
  });

  it('will not speak when it does not actually know — a partial macro set implies nothing', () => {
    expect(candidateNotes(food(), { kcal: 89, protein_g: 1.1 }).join(' ')).not.toContain('disagree');
  });

  it('flags label-derived micros so an absence is never read as a zero', () => {
    expect(candidateNotes(food(), { kcal: 100, sodium_mg: 40 }).join(' ')).toContain('printed label');
  });

  it('marks an estimated row as estimated', () => {
    expect(candidateNotes(food({ source: 'research' }), { kcal: 100, protein_g: 1 }).join(' ')).toContain('Estimated');
  });

  it('labels a thin record rather than dropping it', () => {
    const c = toCandidate(food({ macros_per_base: { kcal: 90 } }), 'ledger');
    expect(c.completeness).toBe('unusable');
    expect(hasFullMacros(c)).toBe(false);
    expect(c.notes.join(' ')).toContain('No usable numbers');
  });
});

describe('disagreements are named, not resolved', () => {
  const candidate = (over: Partial<SourceCandidate>): SourceCandidate =>
    ({
      source: 'ledger',
      food_id: 'x',
      name: 'Thing',
      brand: null,
      per: { measure: '100 g', grams: 100, nutrients: { kcal: 100 } },
      measures: [],
      micros: 'none',
      completeness: 'partial',
      notes: [],
      ...over,
    }) as SourceCandidate;

  it('spots a calorie gap wider than a quarter', () => {
    const out = findDisagreements([
      candidate({ source: 'usda', per: { measure: '100 g', grams: 100, nutrients: { kcal: 160 } } }),
      candidate({ source: 'fatsecret', per: { measure: '100 g', grams: 100, nutrients: { kcal: 571 } } }),
    ]);
    expect(out.join(' ')).toContain('Calories differ');
  });

  /** Two measures of the same food are not a disagreement — comparing them raw would be the bug. */
  it('normalises to 100 g first, so different measures do not read as a conflict', () => {
    const out = findDisagreements([
      candidate({ source: 'usda', per: { measure: '100 g', grams: 100, nutrients: { kcal: 72 } } }),
      candidate({ source: 'ledger', per: { measure: '1 tbsp', grams: 10, nutrients: { kcal: 7.2 } } }),
    ]);
    expect(out.join(' ')).not.toContain('Calories differ');
  });

  it('points at the lab panel when one source measured and another transcribed', () => {
    const out = findDisagreements([
      candidate({ source: 'usda', micros: 'measured' }),
      candidate({ source: 'fatsecret', micros: 'label' }),
    ]);
    expect(out.join(' ')).toContain('lab panel');
  });

  it('says nothing when there is only one opinion', () => {
    expect(findDisagreements([candidate({})])).toEqual([]);
  });
});
