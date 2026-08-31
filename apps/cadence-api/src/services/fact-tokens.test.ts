import { describe, expect, it } from 'vitest';
import { factTokens, factTokensContained } from './fact-tokens.ts';

describe('factTokens', () => {
  it('lowercases, splits punctuation, drops stopwords', () => {
    expect(factTokens('Wednesday afternoons — at work')).toEqual(['wednesday', 'afternoon', 'work']);
  });

  it('folds plurals but keeps a double-s word whole', () => {
    expect(factTokens('Saturdays')).toEqual(['saturday']);
    expect(factTokens('piano class')).toEqual(['piano', 'class']);
  });

  it('folds number words and splits digit-times-digit compounds', () => {
    expect(factTokens('two 50lb dumbbells')).toEqual(['2', '50lb', 'dumbbell']);
    expect(factTokens('2x50lb dumbbells')).toEqual(['2', '50lb', 'dumbbell']);
  });

  it('keeps meaning-bearing small words', () => {
    expect(factTokens('no afternoon workout')).toContain('no');
    expect(factTokens('can only do one workout')).toEqual(['can', 'only', 'do', '1', 'workout']);
  });
});

describe('factTokensContained', () => {
  it('sees through plural + stopword variation', () => {
    expect(factTokensContained(factTokens('Saturday piano class'), factTokens('Weekly piano class on Saturdays'))).toBe(
      true,
    );
    expect(
      factTokensContained(factTokens('work on Wednesday afternoons'), factTokens('Wednesday afternoons — at work')),
    ).toBe(true);
  });

  it('a short single token is never enough evidence', () => {
    expect(factTokensContained(factTokens('arm'), factTokens('warm-up arm band'))).toBe(false);
  });

  it('a real single token still contains into its fuller telling', () => {
    expect(factTokensContained(factTokens('knee'), factTokens('left knee — patellar tendinopathy'))).toBe(true);
  });

  it('disjoint facts do not contain', () => {
    expect(factTokensContained(factTokens('knee pain'), factTokens('back pain'))).toBe(false);
  });
});
