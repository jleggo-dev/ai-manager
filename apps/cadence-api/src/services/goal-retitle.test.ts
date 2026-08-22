/**
 * The timidity is the design, so most of these assert that it does NOTHING.
 *
 * Retargeting used to leave "Read 100 books this year" saying 100 while the goal aimed at 50 — and
 * the title is what every list and card shows. But a title is the user's own words, so the only
 * thing this may correct is a digit that is now false. Anything ambiguous is left alone: a stale
 * title nobody promised to maintain is better than a rewrite that mangles their sentence.
 */
import { describe, it, expect } from 'vitest';
import { retitleForTarget } from './goal-retitle.ts';

describe('retitleForTarget', () => {
  it('carries the number when it stands alone — the case that was wrong', () => {
    expect(retitleForTarget('Read 100 books this year', 100, 50)).toBe('Read 50 books this year');
  });

  it.each([
    ['no number at all', 'Read more books', 100, 50],
    ['a different number', 'Read 12 books this year', 100, 50],
    ['the same number twice — which one did they mean?', 'Run 100 miles in 100 days', 100, 50],
    ['embedded in a longer number', 'Save $1000 by December', 100, 50],
    ['a decimal neighbour', 'Hit 100.5kg', 100, 50],
    ['target unchanged', 'Read 100 books', 100, 100],
    ['no previous target to find', 'Read books', null, 50],
    ['an empty title', '   ', 100, 50],
  ])('leaves it alone: %s', (_label, title, was, target) => {
    expect(retitleForTarget(title as string, was, target as number)).toBeNull();
  });

  it('handles a title that is only the number', () => {
    expect(retitleForTarget('100', 100, 50)).toBe('50');
  });

  it('does not touch a number that is part of a word', () => {
    expect(retitleForTarget('Complete my 100k ultra', 100, 50)).toBeNull();
  });
});
