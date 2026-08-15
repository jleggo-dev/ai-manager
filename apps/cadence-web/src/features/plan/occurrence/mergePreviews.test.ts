import { describe, expect, it } from 'vitest';
import { mergePreviews } from './useMealCapture.ts';
import type { MealPreview } from '../../../lib/api.ts';

const preview = (over: Partial<MealPreview>): MealPreview => ({
  meal: 'breakfast',
  items: [],
  macros: null,
  confidence: 0.8,
  flags: {},
  raw_text: '',
  ...over,
});

/**
 * A meal is almost always several things (owner, 2026-08-15), so a card that already read one
 * thing has to be able to grow. The alternative — log twice and hope the day adds up — is what
 * lost a latte: it was estimated cleanly and then never written down at all.
 */
describe('mergePreviews', () => {
  const smoothie = preview({
    items: [
      { name: 'skyr', qty: 0.67, unit: 'cup', est: { kcal: 100, protein_g: 17 } },
      { name: 'strawberries', qty: 1, unit: 'cup', est: { kcal: 50, vitamin_c_mg: 90 } },
    ],
    macros: { kcal: 150, protein_g: 17, vitamin_c_mg: 90 },
    raw_text: '2/3 cup skyr, 1 cup strawberries',
  });
  const latte = preview({
    items: [{ name: 'latte', qty: 1, unit: 'cup', est: { kcal: 120, calcium_mg: 300 } }],
    macros: { kcal: 120, calcium_mg: 300 },
    confidence: 0.6,
    raw_text: 'one small latte',
  });

  it('joins the items rather than replacing them', () => {
    const m = mergePreviews(smoothie, latte);
    expect(m.items.map((i) => i.name)).toEqual(['skyr', 'strawberries', 'latte']);
  });

  it('adds the totals, including nutrients only one side had', () => {
    const m = mergePreviews(smoothie, latte);
    expect(m.macros).toMatchObject({ kcal: 270, protein_g: 17, vitamin_c_mg: 90, calcium_mg: 300 });
  });

  it('keeps both halves of what they actually said', () => {
    expect(mergePreviews(smoothie, latte).raw_text).toBe('2/3 cup skyr, 1 cup strawberries; one small latte');
  });

  it('takes the LOWER confidence — a meal is only as sure as its least sure part', () => {
    expect(mergePreviews(smoothie, latte).confidence).toBe(0.6);
    expect(mergePreviews(preview({ confidence: null }), latte).confidence).toBe(0.6);
  });

  it('carries a flag raised by either half', () => {
    const beer = preview({ flags: { alcohol: true }, items: [{ name: 'beer' }] });
    expect(mergePreviews(smoothie, beer).flags.alcohol).toBe(true);
  });

  it('respects the parser item cap so a long day cannot overflow the row', () => {
    const many = preview({ items: Array.from({ length: 11 }, (_, i) => ({ name: `item${i}` })) });
    expect(mergePreviews(many, latte).items).toHaveLength(12);
    expect(mergePreviews(many, many).items).toHaveLength(12);
  });

  it('survives a side with no macros at all', () => {
    expect(mergePreviews(smoothie, preview({ macros: null })).macros).toMatchObject({ kcal: 150 });
    expect(mergePreviews(preview({ macros: null }), latte).macros).toMatchObject({ kcal: 120 });
  });
});
