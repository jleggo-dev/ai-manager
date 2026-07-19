/**
 * API-04 — unit tests for the pure nutrition helpers extracted from services/nutrition.ts.
 * Covers parse-meal shaping (valid / malformed / partial / confidence clamp) and wantsTargets.
 */
import { describe, it, expect } from 'vitest';
import { parseMealResult, wantsTargets } from './nutrition.ts';

describe('parseMealResult', () => {
  it('shapes a well-formed parse-meal blob', () => {
    const out = parseMealResult(
      JSON.stringify({
        meal: 'lunch',
        items: [
          { name: ' chicken bowl ', qty: 1, unit: 'bowl', est: { kcal: 520, protein_g: 40 } },
          { name: '', qty: 1 },
          null,
        ],
        flags: { alcohol: true, caffeine: false, spicy: true },
        confidence: 0.82,
        est_macros: { kcal: 520, protein_g: 40, carbs_g: 55, fat_g: 12 },
      }),
    );
    expect(out.meal).toBe('lunch');
    expect(out.items).toEqual([{ name: 'chicken bowl', qty: 1, unit: 'bowl', est: { kcal: 520, protein_g: 40 } }]);
    expect(out.flags).toEqual({ alcohol: true });
    expect(out.confidence).toBe(0.82);
    expect(out.macros).toEqual({ kcal: 520, protein_g: 40, carbs_g: 55, fat_g: 12, source: 'ai' });
  });

  it('throws on malformed JSON', () => {
    expect(() => parseMealResult('not-json{')).toThrow();
  });

  it('defaults meal to other and keeps empty items/flags when fields are missing', () => {
    const out = parseMealResult('{}');
    expect(out).toEqual({ meal: 'other', items: [], flags: {}, confidence: null, macros: null });
  });

  it('lets an explicit user meal outrank the model', () => {
    const out = parseMealResult(JSON.stringify({ meal: 'dinner', items: [{ name: 'oats' }] }), 'breakfast');
    expect(out.meal).toBe('breakfast');
    expect(out.items).toEqual([{ name: 'oats' }]);
  });

  it('clamps confidence into [0, 1]', () => {
    expect(parseMealResult(JSON.stringify({ confidence: 1.7 })).confidence).toBe(1);
    expect(parseMealResult(JSON.stringify({ confidence: -0.4 })).confidence).toBe(0);
  });

  it('caps items at 12 and drops nameless entries', () => {
    const items = Array.from({ length: 15 }, (_, i) => ({ name: `item-${i}` }));
    items.push({ name: '   ' });
    const out = parseMealResult(JSON.stringify({ items }));
    expect(out.items).toHaveLength(12);
    expect(out.items[0]?.name).toBe('item-0');
    expect(out.items[11]?.name).toBe('item-11');
  });
});

describe('wantsTargets', () => {
  it('is true for a nourishment-area goal', () => {
    expect(wantsTargets([{ area: 'nourishment', type: 'milestone' }])).toBe(true);
  });

  it('is true for a weight-measure target goal (unit or metric)', () => {
    expect(wantsTargets([{ area: 'movement', type: 'target', measure: { unit: 'lbs' } }])).toBe(true);
    expect(wantsTargets([{ area: 'movement', type: 'target', measure: { metric: 'body weight' } }])).toBe(true);
    expect(wantsTargets([{ area: 'movement', type: 'target', measure: { unit: 'kg' } }])).toBe(true);
  });

  it('is false for unrelated goals or empty list', () => {
    expect(wantsTargets([])).toBe(false);
    expect(wantsTargets([{ area: 'movement', type: 'target', measure: { unit: 'km' } }])).toBe(false);
    expect(wantsTargets([{ area: 'mind', type: 'milestone' }])).toBe(false);
  });
});
