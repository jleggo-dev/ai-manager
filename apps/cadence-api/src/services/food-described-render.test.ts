/**
 * The row words both of the coach's food tools use — pinned exactly, one line per basis, because
 * they are read by a model as facts: the card's own labels are in the second person ("your saved
 * food", "what you picked last time"), and a line that repeated them beside the basis read
 * "what they picked last time; from what you picked last time" (step 3 review, 2026-11-01).
 */
import { describe, expect, it } from 'vitest';
import { basisWords, macroLine, questionWords, rowName, rowWords, type CoachRow } from './food-described-render.ts';

describe('rowWords — one line per basis, the basis said once, in the third person', () => {
  it.each<[string, CoachRow, string]>([
    [
      'a record from a shared source',
      { name: 'Banana, raw', qty: 1, unit: 'medium', est: { kcal: 105 }, basis: 'record', source_label: 'USDA' },
      '1 medium Banana, raw: 105 kcal (a record the coach picked, priced from USDA)',
    ],
    [
      "a record from the person's own food",
      { name: 'Eggs', qty: 2, unit: 'large', est: { kcal: 144 }, basis: 'record', source_label: 'your saved food' },
      '2 large Eggs: 144 kcal (a record the coach picked, priced from their saved food)',
    ],
    [
      'a remembered row',
      {
        name: 'Caffè Latte (Venti)',
        brand: 'Starbucks',
        qty: 1,
        unit: 'venti',
        est: { kcal: 250 },
        basis: 'remembered',
        source_label: 'what you picked last time',
      },
      '1 venti Starbucks Caffè Latte (Venti): 250 kcal (what they picked before, priced from that food)',
    ],
    [
      "the coach's estimate, with her assumption",
      {
        name: 'yogurt parfait',
        qty: 1,
        unit: 'serving',
        est: { kcal: 380, protein_g: 10 },
        basis: 'estimate',
        source_label: "the coach's estimate",
        assumption: 'the small one',
      },
      "1 serving yogurt parfait: 380 kcal · 10g protein (the coach's own estimate; assumed: the small one)",
    ],
    [
      'a fallback row',
      {
        name: 'milk',
        qty: 1,
        unit: 'serving',
        est: { kcal: 10 },
        basis: 'fallback',
        source_label: 'an automatic estimate',
      },
      '1 serving milk: 10 kcal (an automatic estimate, the coach not reached)',
    ],
    [
      'a question row',
      { name: 'milk', basis: 'none', question: 'Whole milk or 2%?' },
      'milk: not priced yet (not counted; waiting on their answer: Whole milk or 2%?)',
    ],
    [
      'a question row with the answers offered as buttons',
      { name: 'milk', basis: 'none', question: 'Whole milk, 2% or skim?', choices: ['Whole milk', '2%', 'Skim'] },
      'milk: not priced yet (not counted; waiting on their answer: Whole milk, 2% or skim? (choices: Whole milk / 2% / Skim))',
    ],
    [
      'a row that counted nothing',
      { name: 'a thing', basis: 'none', problem: 'no record fits and no estimate was given' },
      'a thing: not priced yet (not counted; why: no record fits and no estimate was given)',
    ],
    [
      'an estimate the confirm priced from a food it matched by name',
      {
        name: 'yogurt parfait',
        qty: 1,
        unit: 'serving',
        est: { kcal: 300 },
        basis: 'estimate',
        source_label: "the coach's estimate",
        priced_by_name: 'Yogurt parfait',
      },
      "1 serving yogurt parfait: 300 kcal (priced from a food the store matched by name (Yogurt parfait), not the coach's estimate)",
    ],
    [
      'the same, the food unnamed when its row could not be read',
      { name: 'milk', qty: 1, unit: 'serving', est: { kcal: 10 }, basis: 'fallback', priced_by_name: null },
      "1 serving milk: 10 kcal (priced from a food the store matched by name, not the coach's estimate)",
    ],
    [
      'a row with no basis and no source',
      { name: 'milk', qty: 1, unit: 'cup', est: { kcal: 122 } },
      '1 cup milk: 122 kcal',
    ],
  ])('%s', (_label, row, line) => {
    expect(rowWords(row)).toBe(line);
    // Never the card's second person, never the basis twice.
    expect(rowWords(row)).not.toMatch(/\byou\b|\byour\b/);
    expect(rowWords(row).split('estimate').length).toBeLessThanOrEqual(3);
  });

  it('basisWords on a row with only a card label says where it was priced from, once', () => {
    expect(basisWords({ name: 'x', source_label: 'FatSecret' })).toBe('priced from FatSecret');
    expect(basisWords({ name: 'x' })).toBe('');
  });
});

describe('questionWords — the question, and the answers offered beside it', () => {
  it('lists the choices after the question, and the question alone when there are none', () => {
    expect(questionWords({ question: 'Whole milk or 2%?', choices: ['Whole milk', '2%'] })).toBe(
      'Whole milk or 2%? (choices: Whole milk / 2%)',
    );
    expect(questionWords({ question: 'How much?' })).toBe('How much?');
    expect(questionWords({ question: 'How much?', choices: [] })).toBe('How much?');
  });
});

describe('macroLine and rowName', () => {
  it('lists the four macros it has and says when there is no number', () => {
    expect(macroLine({ kcal: 250.4, protein_g: 12.2, carbs_g: 30, fat_g: 8 })).toBe(
      '250 kcal · 12g protein · 30g carbs · 8g fat',
    );
    expect(macroLine({ kcal: 105 })).toBe('105 kcal');
    expect(macroLine({ fiber_g: 3 })).toBe('not priced yet');
    expect(macroLine(null)).toBe('not priced yet');
  });

  it('puts the brand before the name', () => {
    expect(rowName({ brand: 'Starbucks', name: 'Caffè Latte (Venti)' })).toBe('Starbucks Caffè Latte (Venti)');
    expect(rowName({ name: 'milk' })).toBe('milk');
  });
});
