import { describe, expect, it } from 'vitest';
import {
  amountChoices,
  amountSource,
  countAsked,
  macroEnergyShare,
  macroLineProteinFirst,
  scaleMacros,
} from './amounts.ts';

describe('amountSource — the rule', () => {
  it('keeps an amount they said', () => {
    expect(
      amountSource({ name: 'sourdough toast', qty: 2, unit: 'slice' }, '2 slices of sourdough toast and eggs'),
    ).toBe('given');
  });

  it('asks for an amount they did not give', () => {
    expect(amountSource({ name: 'sourdough toast' }, 'toast and eggs')).toBe('asked');
    expect(amountSource({ name: 'sourdough toast', qty: null }, 'toast and eggs')).toBe('asked');
  });

  it('labels an amount Cadence supplied as assumed, not as theirs', () => {
    // The parser counted two eggs off the plate; the words never said "two".
    expect(amountSource({ name: 'eggs, fried', qty: 2, unit: 'large' }, 'toast and eggs')).toBe('assumed');
  });

  it('reads the segment that names the item, not the whole sentence', () => {
    const text = '2 slices of toast and some yogurt';
    expect(amountSource({ name: 'toast', qty: 2, unit: 'slice' }, text)).toBe('given');
    // The "2" belongs to the toast — the yogurt's amount is Cadence's, not theirs.
    expect(amountSource({ name: 'yogurt', qty: 1, unit: 'cup' }, text)).toBe('assumed');
  });

  it('treats a missing raw text as Cadence having supplied everything', () => {
    expect(amountSource({ name: 'oat latte', qty: 1 }, null)).toBe('assumed');
  });

  it('counts only the open ones', () => {
    const items = [{ name: 'eggs', qty: 2 }, { name: 'toast' }, { name: 'coffee' }];
    expect(countAsked(items, 'two eggs, toast, coffee')).toBe(2);
  });
});

describe('amountChoices — chips, never a keypad', () => {
  it('offers one, two, and a weight in the food’s own unit', () => {
    expect(amountChoices({ name: 'sourdough toast' })).toEqual([
      { label: '1 slice', qty: 1, unit: 'slice' },
      { label: '2 slices', qty: 2, unit: 'slice' },
      { label: '40 g', qty: 40, unit: 'g' },
    ]);
  });

  it('prefers the unit the parser already named', () => {
    expect(amountChoices({ name: 'granola', unit: 'bowl' }).slice(0, 2)).toEqual([
      { label: '1 bowl', qty: 1, unit: 'bowl' },
      { label: '2 bowls', qty: 2, unit: 'bowl' },
    ]);
  });

  it('falls back to a bare count when the food names no portion', () => {
    expect(amountChoices({ name: 'leftover casserole' })).toEqual([
      { label: '1', qty: 1 },
      { label: '2', qty: 2 },
    ]);
  });

  it('pluralises an -h unit properly', () => {
    expect(amountChoices({ name: 'cashews' })[1]?.label).toBe('2 handfuls');
  });
});

describe('scaleMacros', () => {
  it('scales the numbers and leaves everything else alone', () => {
    expect(scaleMacros({ kcal: 100, protein_g: 5, source: 'ai' }, 2)).toEqual({
      kcal: 200,
      protein_g: 10,
      source: 'ai',
    });
  });

  it('returns the estimate untouched at a factor of one', () => {
    const est = { kcal: 100 };
    expect(scaleMacros(est, 1)).toBe(est);
  });

  it('survives an undefined estimate and a nonsense factor', () => {
    expect(scaleMacros(undefined, 2)).toBeUndefined();
    expect(scaleMacros({ kcal: 100 }, Number.NaN)).toEqual({ kcal: 100 });
  });
});

describe('macroEnergyShare', () => {
  it('divides the energy, not the grams', () => {
    // The design's own numbers: 5g protein, 27g carbs, 2.5g fat → 13 / 72 / 15.
    expect(macroEnergyShare({ protein_g: 5, carbs_g: 27, fat_g: 2.5 })).toEqual({ protein: 13, carbs: 72, fat: 15 });
  });

  it('is null when there is nothing to divide', () => {
    expect(macroEnergyShare({})).toBeNull();
    expect(macroEnergyShare({ protein_g: 0, carbs_g: 0, fat_g: 0 })).toBeNull();
  });
});

describe('macroLineProteinFirst', () => {
  it('reads protein first', () => {
    expect(macroLineProteinFirst({ protein_g: 17, carbs_g: 34, fat_g: 13 })).toBe('17g protein · 34g carbs · 13g fat');
  });

  it('drops what it does not have', () => {
    expect(macroLineProteinFirst({ protein_g: 17 })).toBe('17g protein');
    expect(macroLineProteinFirst(null)).toBe('');
  });
});
