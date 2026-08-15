import { describe, it, expect } from 'vitest';
import {
  buildCaptureServings,
  normalizeBaseUnit,
  parseEstimateResult,
  parseIdentifyResult,
  parseLabelResult,
  sanitizeCaptureNutrients,
  servingMacrosToPerBase,
} from './food-capture-parse.ts';

describe('normalizeBaseUnit / servingMacrosToPerBase', () => {
  it('maps g/ml words and defaults other units to item', () => {
    expect(normalizeBaseUnit('g')).toBe('g');
    expect(normalizeBaseUnit('Grams')).toBe('g');
    expect(normalizeBaseUnit('ml')).toBe('ml');
    expect(normalizeBaseUnit('container')).toBe('item');
    expect(normalizeBaseUnit(null)).toBe('item');
  });

  it('converts per-serving macros to per-100g', () => {
    const perBase = servingMacrosToPerBase({ kcal: 90, protein_g: 18 }, 170, 'g');
    expect(perBase.kcal).toBeCloseTo(52.9, 1);
    expect(perBase.protein_g).toBeCloseTo(10.6, 1);
  });

  it('keeps item macros per-1 when serving_size is 1', () => {
    expect(servingMacrosToPerBase({ kcal: 72, protein_g: 6 }, 1, 'item')).toMatchObject({
      kcal: 72,
      protein_g: 6,
    });
  });
});

describe('buildCaptureServings', () => {
  it('adds a 100 g option for mass foods', () => {
    const servings = buildCaptureServings({
      servingSize: 170,
      servingUnit: 'container',
      servingLabel: '1 container (170g)',
      baseUnit: 'g',
    });
    expect(servings).toEqual([
      { label: '1 container (170g)', unit: 'container', amount_g: 170 },
      { label: '100 g', unit: 'g', amount_g: 100 },
    ]);
  });

  it('does not duplicate when the serving is already 100 g', () => {
    expect(
      buildCaptureServings({
        servingSize: 100,
        servingUnit: 'g',
        servingLabel: '100 g',
        baseUnit: 'g',
      }),
    ).toHaveLength(1);
  });
});

describe('sanitizeCaptureNutrients', () => {
  /**
   * Micros used to be gated to label reads — "those come from labels/databases, not estimates".
   * That rule sounded rigorous and cost the user the whole column: a model can place a cup of
   * strawberries at roughly 90mg of vitamin C, and the number printed on the bag is an
   * approximation too. Provenance keeps it honest (`source: 'ai'`), not silence.
   */
  it('keeps micros from an estimate, not only from a label', () => {
    const raw = { kcal: 90, protein_g: 18, carbs_g: 5, fat_g: 0, sodium_mg: 65, iron_mg: 0.2 };
    expect(sanitizeCaptureNutrients(raw, true)?.sodium_mg).toBe(65);
    expect(sanitizeCaptureNutrients(raw, false)?.sodium_mg).toBe(65);
    expect(sanitizeCaptureNutrients(raw, false)?.iron_mg).toBe(0.2);
  });

  it('keeps micrograms at a precision that does not erase them', () => {
    // B12's entire daily reference is 2.4µg — one decimal place would round a real value to zero.
    const m = sanitizeCaptureNutrients({ kcal: 90, vitamin_b12_ug: 1.26 }, false);
    expect(m?.vitamin_b12_ug).toBe(1.26);
  });

  it('drops a negative micro rather than storing it', () => {
    expect(sanitizeCaptureNutrients({ kcal: 90, iron_mg: -3 }, false)?.iron_mg).toBeUndefined();
  });

  it('returns null when no macros present', () => {
    expect(sanitizeCaptureNutrients({ fiber_g: 2 }, true)).toBeNull();
  });
});

describe('parseLabelResult', () => {
  it('shapes a readable label into a label_photo candidate', () => {
    const raw = JSON.stringify({
      serving_size: 170,
      serving_unit: 'g',
      serving_label: '1 container (170g)',
      macros_per_serving: { kcal: 90, protein_g: 18, carbs_g: 5, fat_g: 0, fiber_g: 0, sodium_mg: 65 },
      name: 'Total 0% Greek Yogurt',
      brand: 'Fage',
      confidence: 0.92,
      label_readable: true,
    });
    const { candidate, label_readable } = parseLabelResult(raw, { photoRef: 'u/d/p.jpg' });
    expect(label_readable).toBe(true);
    expect(candidate.source).toBe('label_photo');
    expect(candidate.photo_ref).toBe('u/d/p.jpg');
    expect(candidate.name).toBe('Total 0% Greek Yogurt');
    expect(candidate.brand).toBe('Fage');
    expect(candidate.base_unit).toBe('g');
    expect(candidate.macros_per_base.kcal).toBeCloseTo(52.9, 1);
    expect(candidate.macros_per_base.sodium_mg).toBeCloseTo(38.2, 1);
    expect(candidate.servings[0]?.amount_g).toBe(170);
  });

  it('honors name/brand overrides and marks unreadable panels', () => {
    const raw = JSON.stringify({
      serving_size: null,
      serving_unit: null,
      macros_per_serving: null,
      confidence: 0.2,
      label_readable: false,
    });
    const { candidate, label_readable } = parseLabelResult(raw, {
      nameOverride: 'My yogurt',
      brandOverride: 'Mine',
    });
    expect(label_readable).toBe(false);
    expect(candidate.name).toBe('My yogurt');
    expect(candidate.brand).toBe('Mine');
    expect(candidate.macros_per_base).toEqual({});
  });
});

describe('parseEstimateResult / parseIdentifyResult', () => {
  it('shapes estimate-food, micros included', () => {
    const candidate = parseEstimateResult(
      JSON.stringify({
        name: 'Nonfat Greek Yogurt',
        brand: null,
        serving_size: 170,
        serving_unit: 'g',
        serving_label: '1 container (170g)',
        macros_per_serving: { kcal: 90, protein_g: 18, carbs_g: 6, fat_g: 0, calcium_mg: 190 },
        confidence: 0.85,
      }),
    );
    expect(candidate.source).toBe('llm');
    // Scaled to the base like every other nutrient: 190mg in a 170g container → per 100g.
    expect(candidate.macros_per_base.calcium_mg).toBeCloseTo((190 / 170) * 100, 1);
    expect(candidate.confidence).toBe(0.85);
  });

  it('rejects estimate output missing name or macros', () => {
    expect(() => parseEstimateResult(JSON.stringify({ confidence: 0.1 }))).toThrow(/no name/);
    expect(() =>
      parseEstimateResult(
        JSON.stringify({
          name: 'x',
          serving_size: 1,
          serving_unit: 'item',
          macros_per_serving: {},
          confidence: 0.5,
        }),
      ),
    ).toThrow(/no macros/);
  });

  it('shapes identify-food name + brand', () => {
    expect(
      parseIdentifyResult(JSON.stringify({ name: 'Cheerios', brand: 'General Mills', confidence: 0.9 }), 'p.jpg'),
    ).toEqual({
      name: 'Cheerios',
      brand: 'General Mills',
      confidence: 0.9,
      photo_ref: 'p.jpg',
    });
  });
});
