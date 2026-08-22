/**
 * API-04 — unit tests for the pure nutrition helpers extracted from services/nutrition.ts.
 * Covers parse-meal shaping (valid / malformed / partial / confidence clamp) and wantsTargets.
 */
import { describe, it, expect } from 'vitest';
import { parseMealResult, usageSlot, wantsTargets } from './nutrition-parse.ts';

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

describe('parseMealResult — the vendor (A23 §1b)', () => {
  it('keeps a brand the model heard', () => {
    const out = parseMealResult(
      JSON.stringify({ items: [{ name: 'venti latte', brand: ' Starbucks ', qty: 1, unit: 'latte' }] }),
    );
    expect(out.items[0]).toEqual({ name: 'venti latte', brand: 'Starbucks', qty: 1, unit: 'latte' });
  });

  it('omits the field rather than carrying an empty one', () => {
    const out = parseMealResult(JSON.stringify({ items: [{ name: 'oats', brand: '   ' }, { name: 'toast' }] }));
    expect(out.items[0]).not.toHaveProperty('brand');
    expect(out.items[1]).not.toHaveProperty('brand');
  });

  it('ignores a non-string brand and caps a runaway one', () => {
    const out = parseMealResult(
      JSON.stringify({
        items: [
          { name: 'oats', brand: 42 },
          { name: 'toast', brand: 'x'.repeat(400) },
        ],
      }),
    );
    expect(out.items[0]).not.toHaveProperty('brand');
    expect(out.items[1]?.brand).toHaveLength(120);
  });
});

describe('usageSlot', () => {
  it('reads the UTC weekday off the log date, Sunday-first', () => {
    expect(usageSlot('2026-08-19', 'breakfast')).toEqual({ dow: 3, meal: 'breakfast' }); // a Wednesday
    expect(usageSlot('2026-08-16', 'dinner')).toEqual({ dow: 0, meal: 'dinner' }); // a Sunday
  });

  it('is undefined when there is nothing to count — ranking just falls back', () => {
    expect(usageSlot(undefined, 'breakfast')).toBeUndefined();
    expect(usageSlot('2026-08-19', undefined)).toBeUndefined();
    expect(usageSlot('2026-08-19', '')).toBeUndefined();
    expect(usageSlot('not-a-date', 'breakfast')).toBeUndefined();
  });
});
