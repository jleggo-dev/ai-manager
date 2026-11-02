import { describe, it, expect } from 'vitest';
import {
  defaultServingIndex,
  mapUsdaFoodDetail,
  mapUsdaNutrients,
  mapUsdaPortions,
  parseUsdaSearchHit,
  usdaPortion,
} from './usda-map.ts';

describe('mapUsdaNutrients', () => {
  it('maps nutrient numbers to FoodNutrients (per 100g)', () => {
    const nutrients = mapUsdaNutrients([
      { nutrient: { id: 1008, number: 1008, name: 'Energy', unitName: 'kcal' }, amount: 89 },
      { nutrient: { number: 1003, name: 'Protein', unitName: 'g' }, amount: 1.09 },
      { nutrient: { number: 1005, name: 'Carbohydrate', unitName: 'g' }, amount: 22.84 },
      { nutrient: { number: 1004, name: 'Fat', unitName: 'g' }, amount: 0.33 },
      { nutrient: { number: 1095, name: 'Zinc', unitName: 'mg' }, amount: 0.15 },
      { nutrient: { number: 1008, name: 'Energy', unitName: 'kJ' }, amount: 371 },
    ]);
    expect(nutrients.kcal).toBe(89);
    expect(nutrients.protein_g).toBe(1.1);
    expect(nutrients.carbs_g).toBe(22.8);
    expect(nutrients.fat_g).toBe(0.3);
    expect(nutrients.zinc_mg).toBe(0.15);
  });

  it('maps vitamin B-12 (FDC id 1178) in µg at 2 decimal places', () => {
    const nutrients = mapUsdaNutrients([
      { nutrient: { id: 1178, number: '418', name: 'Vitamin B-12', unitName: 'µg' }, amount: 0.443 },
      { nutrient: { id: 1246, number: '578', name: 'Vitamin B-12, added', unitName: 'µg' }, amount: 0.9 },
    ]);
    // 0.44, not 0.4 — '_ug' must not fall into the '_g' 1dp bucket.
    expect(nutrients.vitamin_b12_ug).toBe(0.44);
    // "added" B-12 (1246) is a subset of the 1178 total — never mapped on its own.
    expect(Object.keys(nutrients)).toEqual(['vitamin_b12_ug']);
  });

  it('maps a real full-format payload, where nutrient.number is the legacy code and only the id matches', () => {
    // Trimmed from live GET /v1/food/175167 (salmon, SR Legacy): entry.id is the row id,
    // nutrient.id the FDC id we key on, nutrient.number the legacy string code.
    const nutrients = mapUsdaNutrients([
      {
        type: 'FoodNutrient',
        id: 1817900,
        nutrient: { id: 1008, number: '208', name: 'Energy', rank: 300, unitName: 'kcal' },
        amount: 208,
      },
      {
        type: 'FoodNutrient',
        id: 1817879,
        nutrient: { id: 1062, number: '268', name: 'Energy', rank: 400, unitName: 'kJ' },
        amount: 870,
      },
      {
        type: 'FoodNutrient',
        id: 1817943,
        nutrient: { id: 1003, number: '203', name: 'Protein', rank: 600, unitName: 'g' },
        amount: 20.42,
      },
      {
        type: 'FoodNutrient',
        id: 1817905,
        nutrient: { id: 1178, number: '418', name: 'Vitamin B-12', rank: 7300, unitName: 'µg' },
        amount: 3.23,
      },
    ]);
    expect(nutrients.kcal).toBe(208);
    expect(nutrients.protein_g).toBe(20.4);
    expect(nutrients.vitamin_b12_ug).toBe(3.23);
  });
});

describe('mapUsdaPortions', () => {
  it('maps household portions and always includes 100 g', () => {
    const servings = mapUsdaPortions([
      { amount: 1, modifier: 'medium', gramWeight: 118, measureUnit: { name: 'fruit' } },
      { amount: 1, modifier: 'cup', gramWeight: 150, measureUnit: { name: 'slices' } },
    ]);
    expect(servings.some((s) => s.amount_g === 118)).toBe(true);
    expect(servings.some((s) => s.unit === 'g' && s.amount_g === 100)).toBe(true);
    expect(defaultServingIndex(servings)).toBe(0);
  });
});

/**
 * The words on a serving. Survey (FNDDS) foods carry a numeric code in `modifier` and the words in
 * `portionDescription`; reading the code stored "61109" as the serving and the meal card said
 * "1 61109" (2026-11-01). Rows are the real FDC 2708729 (Spanakopita) portions plus near-misses.
 */
describe('usdaPortion — a serving is named in words, never a code', () => {
  const undetermined = { id: 9999, name: 'undetermined', abbreviation: 'undetermined' };
  const rows: Array<[string, Record<string, unknown>, number, { label: string; unit: string }]> = [
    [
      'FNDDS: code in modifier, words in the description',
      { modifier: '61109', portionDescription: '1 regular/large', measureUnit: undetermined },
      120,
      { label: '1 regular/large (120g)', unit: 'regular/large' },
    ],
    [
      'FNDDS: a two-word measure',
      { modifier: '51000', portionDescription: '1 cubic inch', measureUnit: undetermined },
      12,
      { label: '1 cubic inch (12g)', unit: 'cubic inch' },
    ],
    [
      'FNDDS: a fractional count',
      { modifier: '10205', portionDescription: '1/2 cup', measureUnit: undetermined },
      60,
      { label: '1/2 cup (60g)', unit: 'cup' },
    ],
    [
      'FNDDS: no household measure reads as one serving',
      { modifier: '90000', portionDescription: 'Quantity not specified', measureUnit: undetermined },
      90,
      { label: '1 serving (90g)', unit: 'serving' },
    ],
    [
      'a description with no count gets one',
      { modifier: '61109', portionDescription: 'piece', measureUnit: undetermined },
      120,
      { label: '1 piece (120g)', unit: 'piece' },
    ],
    [
      'nothing at all is one serving',
      { modifier: '61109', measureUnit: undetermined },
      120,
      { label: '1 serving (120g)', unit: 'serving' },
    ],
    // Near-misses: a modifier that is a WORD still wins, including one with a number in it.
    [
      'SR Legacy: the word modifier is kept',
      { amount: 1, modifier: 'medium', measureUnit: { name: 'fruit' } },
      118,
      { label: '1 medium fruit (118g)', unit: 'medium' },
    ],
    [
      'a modifier with digits AND words is not a code',
      { amount: 1, modifier: '2" slice', measureUnit: undetermined },
      40,
      { label: '1 2" slice (40g)', unit: '2" slice' },
    ],
    [
      'Foundation: the measure unit alone',
      { amount: 0.5, measureUnit: { name: 'cup' } },
      75,
      { label: '0.5 cup (75g)', unit: 'cup' },
    ],
  ];
  it.each(rows)('%s', (_why, portion, grams, want) => {
    expect(usdaPortion(portion, grams)).toEqual(want);
  });

  it('a whole FNDDS food has no code anywhere in its servings', () => {
    const servings = mapUsdaPortions(
      [
        ['51000', '1 cubic inch', 12],
        ['61109', '1 regular/large', 120],
        ['64770', '1 small/individual', 30],
        ['10205', '1 cup', 120],
        ['90000', 'Quantity not specified', 90],
      ].map(([modifier, portionDescription, gramWeight]) => ({
        modifier,
        portionDescription,
        gramWeight,
        measureUnit: undetermined,
      })),
    );
    expect(servings.map((s) => s.label)).toEqual(
      expect.arrayContaining(['1 regular/large (120g)', '1 cup (120g)', '1 serving (90g)']),
    );
    expect(servings.filter((s) => /\d{4,}/.test(`${s.unit} ${s.label}`))).toEqual([]);
  });
});

describe('parseUsdaSearchHit / mapUsdaFoodDetail', () => {
  it('parses a search hit', () => {
    const hit = parseUsdaSearchHit({
      fdcId: 173944,
      description: 'Bananas, raw',
      dataType: 'SR Legacy',
    });
    expect(hit).toEqual({
      fdc_id: 173944,
      name: 'Bananas, raw',
      brand: null,
      data_type: 'SR Legacy',
    });
  });

  it('maps a full food detail into an importable Food shape', () => {
    const mapped = mapUsdaFoodDetail({
      fdcId: 173944,
      description: 'Bananas, raw',
      foodNutrients: [
        { nutrient: { number: 1008, unitName: 'kcal' }, amount: 89 },
        { nutrient: { number: 1003, unitName: 'g' }, amount: 1.09 },
      ],
      foodPortions: [{ amount: 1, modifier: 'medium', gramWeight: 118, measureUnit: { name: 'fruit' } }],
    });
    expect(mapped).not.toBeNull();
    expect(mapped!.source).toBe('usda');
    expect(mapped!.fdc_id).toBe(173944);
    expect(mapped!.base_unit).toBe('g');
    expect(mapped!.macros_per_base.kcal).toBe(89);
    expect(mapped!.servings.length).toBeGreaterThanOrEqual(2);
    expect(mapped!.off_id).toBeNull();
  });

  it('rejects detail with no macros', () => {
    expect(
      mapUsdaFoodDetail({
        fdcId: 1,
        description: 'Water',
        foodNutrients: [{ nutrient: { number: 1095 }, amount: 0 }],
        foodPortions: [],
      }),
    ).toBeNull();
  });
});

/**
 * BRANDED foods — a different numbering and a different serving, in the same endpoint.
 *
 * These are regression tests for a silent failure, not hypotheticals. Every packaged product came
 * back `unmappable` while the search that found them worked perfectly, because Branded records
 * answer with USDA's legacy three-digit nutrient numbers (208 energy) where Foundation answers
 * with the modern four-digit set (1008). Nothing errored — the mapper simply found none of the
 * numbers it was looking for and the food was dropped as nutrient-less.
 */
describe('branded records', () => {
  const brandedNutrients = [
    { nutrient: { number: '208', unitName: 'KCAL' }, amount: 607 },
    { nutrient: { number: '203', unitName: 'G' }, amount: 25 },
    { nutrient: { number: '205', unitName: 'G' }, amount: 25 },
    { nutrient: { number: '204', unitName: 'G' }, amount: 46.4 },
    { nutrient: { number: '291', unitName: 'G' }, amount: 14.3 },
    { nutrient: { number: '307', unitName: 'MG' }, amount: 821 },
  ];

  it('reads the legacy nutrient numbers Branded uses', () => {
    expect(mapUsdaNutrients(brandedNutrients)).toEqual({
      kcal: 607,
      protein_g: 25,
      carbs_g: 25,
      fat_g: 46.4,
      fiber_g: 14.3,
      sodium_mg: 821,
    });
  });

  it('still prefers the modern number when a record carries both', () => {
    const both = [
      { nutrient: { number: '1008', unitName: 'KCAL' }, amount: 100 },
      { nutrient: { number: '208', unitName: 'KCAL' }, amount: 999 },
    ];
    expect(mapUsdaNutrients(both).kcal).toBe(100);
  });

  it('makes the label serving the default, in the unit USDA writes it', () => {
    // `servingSizeUnit` is UPPERCASE on branded records ('GRM'), not the 'g' of everywhere else —
    // matching only lowercase left every packaged food with 100 g as its only portion.
    const mapped = mapUsdaFoodDetail({
      fdcId: 2104495,
      description: 'DILL PICKLE PEANUTS',
      dataType: 'Branded',
      brandName: 'THE CAROLINA NUT CO.',
      brandOwner: 'Some Distributor LLC',
      servingSize: 28,
      servingSizeUnit: 'GRM',
      householdServingFullText: '1 ONZ',
      foodNutrients: brandedNutrients,
    });

    expect(mapped).not.toBeNull();
    expect(mapped!.servings[0]).toMatchObject({ amount_g: 28 });
    expect(mapped!.default_serving).toBe(0);
    // The name on the PACKET, not the distributor behind it — that is the word a person says.
    expect(mapped!.brand).toBe('THE CAROLINA NUT CO.');
  });
});
