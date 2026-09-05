import { describe, it, expect } from 'vitest';
import type { Food } from '@cadence/shared';
import {
  candidateNotes,
  findDisagreements,
  hasFullMacros,
  matchMeasure,
  preferredServing,
  sortByAuthority,
  sourceAuthority,
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

/**
 * MP15 — owner: "she should actually prioritize the image, since it's a more authoritative
 * source." A photographed label answers the exact question for the exact product; a `research`
 * candidate is a generic web guess. The ordering must be explicit (sourceAuthority/sortByAuthority)
 * AND nothing may be dropped — the fan-out's contract is every source that answered comes back.
 */
describe('a photographed label outranks a web lookup', () => {
  const candidate = (over: Partial<SourceCandidate>): SourceCandidate =>
    ({
      source: 'ledger',
      food_id: 'x',
      name: 'Mixed dried mushroom',
      brand: null,
      per: { measure: '15 pieces', grams: 15, nutrients: { kcal: 40 } },
      measures: [],
      micros: 'none',
      completeness: 'partial',
      notes: [],
      ...over,
    }) as SourceCandidate;

  it('ranks label ahead of every other rung, and research last', () => {
    expect(sourceAuthority('label')).toBeLessThan(sourceAuthority('ledger'));
    expect(sourceAuthority('ledger')).toBeLessThanOrEqual(sourceAuthority('usda'));
    expect(sourceAuthority('usda')).toBeLessThanOrEqual(sourceAuthority('fatsecret'));
    expect(sourceAuthority('fatsecret')).toBeLessThan(sourceAuthority('research'));
  });

  it('sorts a label candidate ahead of a research candidate, dropping neither', () => {
    const research = candidate({ source: 'research', name: 'Dried mushrooms (generic)' });
    const label = candidate({ source: 'label', name: 'Wild Mushroom Co mixed dried mushroom' });

    // Fed in the "wrong" order on purpose — sortByAuthority must be doing the work, not fixture order.
    const sorted = sortByAuthority([research, label]);

    expect(sorted).toHaveLength(2);
    expect(sorted[0]!.source).toBe('label');
    expect(sorted[1]!.source).toBe('research');
    // Nothing filtered — the fan-out's contract survives sorting.
    expect(sorted).toEqual(expect.arrayContaining([research, label]));
  });

  it('is stable when authority ties, so equal-ranked candidates keep their relative order', () => {
    const usda = candidate({ source: 'usda', name: 'USDA row' });
    const fatsecret = candidate({ source: 'fatsecret', name: 'FatSecret row' });
    expect(sortByAuthority([usda, fatsecret]).map((c) => c.source)).toEqual(['usda', 'fatsecret']);
    expect(sortByAuthority([fatsecret, usda]).map((c) => c.source)).toEqual(['fatsecret', 'usda']);
  });

  it("names the label as the maker's own printed figures, right in the notes she reads", () => {
    const label = food({ source: 'label_photo' });
    const notes = candidateNotes(label, label.macros_per_base).join(' ');
    expect(notes).toContain("maker's own printed figures");
  });

  it('toCandidate accepts an unsaved capture (no food_id yet) the same way it accepts a saved food', () => {
    // MP14's read_label reports a FoodCandidate — no food_id, because it has not been saved. The
    // serving's unit ("g") deliberately equals base_unit — this is the exact shape that used to
    // mis-price (below), so this fixture doubles as the regression case.
    const capture = {
      name: 'Wild Mushroom Co mixed dried mushroom',
      brand: 'The Wild Mushroom Co',
      source: 'label_photo' as const,
      base_unit: 'g' as const,
      macros_per_base: { kcal: 72, protein_g: 2.5, carbs_g: 16.8, fat_g: 0.1 },
      servings: [{ label: '100 g', unit: 'g', amount_g: 100 }],
      default_serving: 0,
      confidence: 0.9,
      photo_ref: 'user1/2026-08-28/x.jpg',
    };
    const c = toCandidate(capture, 'label');
    expect(c.food_id).toBeNull();
    // A "100 g" serving on a base_unit:'g' food is the food's own macros unscaled — this used to
    // come back at 1/100th of this value (the exact-100g-serving instance of the bug below).
    expect(c.per.nutrients.kcal).toBeCloseTo(72, 0);
    expect(c.notes.join(' ')).toContain("maker's own printed figures");
  });

  /**
   * The mushroom-jar fixture is the real shape `parse-nutrition-label` returns — verified against
   * the job's own worked example in ai-admin.config.json: `serving_size:15, serving_unit:"g"`.
   *
   * Regression pair for a real bug that was live on `main`: `toCandidate` reported this exact
   * fixture's numbers at 1/15th of the printed figure, because its `priceFood(food, {qty:1, unit,
   * text})` call read a bare "g" unit as an ABSOLUTE amount ("1 gram") whenever it matched the
   * food's own base_unit, discarding the serving's real `amount_g`. Both branches that used to hit
   * this — no requested measure (falls to the food's preferred serving) and an EXPLICITLY requested
   * measure that matches one (`matchMeasure`'s `exact`) — are covered below, since the fix
   * (`nutrientsAtServing`, using `servingFactor`/`scaleNutrients` directly) applies to both.
   */
  describe('the mushroom-jar fixture prices correctly (regression: was 1/15th on main)', () => {
    const mushroomCapture = () => ({
      name: 'Dried Mixed Mushrooms',
      brand: 'The Wild Mushroom Co',
      source: 'label_photo' as const,
      base_unit: 'g' as const,
      // macros_per_base is per 100 g (servingMacrosToPerBase's g/ml convention); the label's own
      // "15 g" serving is what scales it back down to the printed per-15-pieces figures.
      macros_per_base: {
        kcal: (40 / 15) * 100,
        protein_g: (3 / 15) * 100,
        carbs_g: (8 / 15) * 100,
        fat_g: (1 / 15) * 100,
        fiber_g: (5 / 15) * 100,
        sodium_mg: (4 / 15) * 100,
        potassium_mg: (250 / 15) * 100,
        calcium_mg: (10 / 15) * 100,
        iron_mg: (0.3 / 15) * 100,
      },
      servings: [
        { label: '15 g', unit: 'g', amount_g: 15 },
        { label: '100 g', unit: 'g', amount_g: 100 },
      ],
      default_serving: 0,
      confidence: 0.9,
      photo_ref: 'user1/2026-08-28/mushroom.jpg',
    });

    const assertsPrintedFigures = (c: SourceCandidate) => {
      expect(c.food_id).toBeNull();
      expect(c.per.measure).toBe('15 g');
      expect(c.per.grams).toBe(15);
      // MP12: potassium/calcium/iron must survive — they are the three the mushroom label prints,
      // and the ones parse-nutrition-label did not used to ask for.
      expect(c.per.nutrients.kcal).toBeCloseTo(40, 0);
      expect(c.per.nutrients.potassium_mg).toBeCloseTo(250, 0);
      expect(c.per.nutrients.calcium_mg).toBeCloseTo(10, 0);
      expect(c.per.nutrients.iron_mg).toBeCloseTo(0.3, 1);
      expect(c.notes.join(' ')).toContain("maker's own printed figures");
    };

    it('at its own preferred serving (no requested measure — the toCandidate fallback branch)', () => {
      assertsPrintedFigures(toCandidate(mushroomCapture(), 'label'));
    });

    it('at an explicitly requested measure that matches one (the toCandidate exact branch)', () => {
      assertsPrintedFigures(toCandidate(mushroomCapture(), 'label', '15 g'));
    });

    it("is never off by the tell-tale 15×/100× that priceFood's absolute-unit branch produced", () => {
      const kcal = toCandidate(mushroomCapture(), 'label').per.nutrients.kcal ?? 0;
      expect(kcal).not.toBeCloseTo(40 / 15, 1); // the old fallback-branch answer
      expect(kcal).not.toBeCloseTo(40 / 100, 2); // the old exact-100g-serving answer
    });
  });
});
