import { describe, it, expect } from 'vitest';
import {
  assessDietarySafety,
  expandAllergenTerms,
  normalizeDietaryToken,
  partitionByDietarySafety,
  sanitizeDietaryProfile,
} from './dietary-safety.ts';
import type { DietaryProfile } from './types/dietary.ts';

const profile = (partial: Partial<DietaryProfile>): DietaryProfile => ({
  allergies: [],
  diet: null,
  dislikes: [],
  notes: null,
  ...partial,
});

describe('normalizeDietaryToken', () => {
  it('lowercases and collapses punctuation/whitespace', () => {
    expect(normalizeDietaryToken('  Peanut-Butter! ')).toBe('peanut butter');
  });
});

describe('expandAllergenTerms', () => {
  it('expands peanut to common synonyms', () => {
    const terms = expandAllergenTerms('peanuts');
    expect(terms).toContain('peanut');
    expect(terms).toContain('peanut butter');
  });

  it('expands a synonym back to its cluster', () => {
    const terms = expandAllergenTerms('shrimp');
    expect(terms).toContain('shellfish');
    expect(terms).toContain('shrimp');
  });
});

describe('assessDietarySafety', () => {
  it('hard-flags a profiled allergen match (never silently safe)', () => {
    const result = assessDietarySafety(profile({ allergies: ['peanuts'] }), 'Fage yogurt with peanut butter swirl');
    expect(result.safe).toBe(false);
    expect(result.flags.some((f) => f.severity === 'allergy' && f.matched.includes('peanut'))).toBe(true);
  });

  it('hard-flags shellfish via synonym (shrimp)', () => {
    const result = assessDietarySafety(profile({ allergies: ['shellfish'] }), ['garlic shrimp', 'rice']);
    expect(result.safe).toBe(false);
    expect(result.flags[0]?.severity).toBe('allergy');
  });

  it('soft-flags dislikes without failing safe', () => {
    const result = assessDietarySafety(profile({ dislikes: ['cilantro'] }), 'taco bowl with cilantro');
    expect(result.safe).toBe(true);
    expect(result.flags).toEqual([{ severity: 'dislike', term: 'cilantro', matched: 'cilantro' }]);
  });

  it('soft-flags vegan diet conflicts', () => {
    const result = assessDietarySafety(profile({ diet: 'vegan' }), 'chicken rice bowl');
    expect(result.safe).toBe(true);
    expect(result.flags.some((f) => f.severity === 'diet' && f.matched === 'chicken')).toBe(true);
  });

  it('returns safe with no flags for an empty profile', () => {
    expect(assessDietarySafety(profile({}), 'anything goes')).toEqual({ safe: true, flags: [] });
  });

  it('treats null/undefined profile as empty', () => {
    expect(assessDietarySafety(null, 'peanut butter')).toEqual({ safe: true, flags: [] });
  });
});

describe('partitionByDietarySafety', () => {
  it('keeps soft-flagged items in safe; moves allergy hits to flagged', () => {
    const items = [{ name: 'Greek yogurt' }, { name: 'Peanut sauce noodles' }, { name: 'Cilantro lime rice' }];
    const { safe, flagged } = partitionByDietarySafety(
      profile({ allergies: ['peanut'], dislikes: ['cilantro'] }),
      items,
      (i) => i.name,
    );
    expect(safe.map((i) => i.name)).toEqual(['Greek yogurt', 'Cilantro lime rice']);
    expect(flagged).toHaveLength(1);
    expect(flagged[0]?.item.name).toBe('Peanut sauce noodles');
    expect(flagged[0]?.assessment.safe).toBe(false);
  });
});

describe('sanitizeDietaryProfile', () => {
  it('coerces a well-formed object', () => {
    expect(
      sanitizeDietaryProfile({
        allergies: [' Peanuts ', 'peanuts', ''],
        diet: 'Vegan',
        dislikes: ['cilantro'],
        notes: '  keep it gentle  ',
      }),
    ).toEqual({
      allergies: ['Peanuts'],
      diet: 'vegan',
      dislikes: ['cilantro'],
      notes: 'keep it gentle',
    });
  });

  it('rejects non-objects', () => {
    expect(sanitizeDietaryProfile(null)).toBeNull();
    expect(sanitizeDietaryProfile('vegan')).toBeNull();
    expect(sanitizeDietaryProfile([])).toBeNull();
  });
});
