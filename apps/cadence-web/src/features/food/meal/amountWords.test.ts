import { describe, expect, it } from 'vitest';
import { amountWords } from './amountWords.ts';

describe('amountWords', () => {
  it.each([
    [{ qty: 2, unit: 'large' }, '2 large'],
    [{ qty: 1, unit: 'venti' }, '1 venti'],
    [{ qty: 0.5, unit: 'cup' }, '0.5 cup'],
    [{ qty: 3 }, '3'],
    [{ qty: 1, unit: '' }, '1'],
  ])('%j → %j', (row, out) => {
    expect(amountWords(row)).toBe(out);
  });

  it('an amount nobody said is a question — never a guessed number', () => {
    expect(amountWords({})).toBe('how much?');
    expect(amountWords({ unit: 'slice' })).toBe('how much?');
  });
});
