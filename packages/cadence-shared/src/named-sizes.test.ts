import { describe, expect, it } from 'vitest';
import { namedSizeOf } from './named-sizes.ts';

/** A size picks WHICH food; a measure prices one already found. Positives AND near-misses. */
describe('namedSizeOf', () => {
  it.each([
    ['Venti', 'venti'],
    ['grande', 'grande'],
    [' Tall ', 'tall'],
    ['SHORT', 'short'],
    ['Trenta', 'trenta'],
    ['large', 'large'],
    ['Extra  Large', 'extra large'],
    ['kids', 'kids'],
  ])('%j is a size', (unit, size) => {
    expect(namedSizeOf(unit)).toBe(size);
  });

  it.each([
    ['g'],
    ['ml'],
    ['cup'],
    ['slice'],
    ['bowl'],
    ['tbsp'],
    ['can'],
    ['venti latte'], // a whole phrase is not a unit
    ['largest'],
    ['tallboy'],
    [''],
  ])('%j is not a size', (unit) => {
    expect(namedSizeOf(unit)).toBeNull();
  });

  it('reads nothing as no size', () => {
    expect(namedSizeOf(null)).toBeNull();
    expect(namedSizeOf(undefined)).toBeNull();
  });
});
