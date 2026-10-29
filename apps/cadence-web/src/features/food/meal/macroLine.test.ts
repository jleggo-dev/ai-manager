/** The tile's "P 12 · C 30 · F 8" line — what it says when it knows all three, some, or none. */
import { describe, expect, it } from 'vitest';
import { macroLine } from './macroLine.ts';

describe('macroLine', () => {
  it.each([
    [{ protein_g: 12.4, carbs_g: 30, fat_g: 7.6 }, 'P 12 · C 30 · F 8'],
    [{ protein_g: 0, carbs_g: 27, fat_g: 0.3 }, 'P 0 · C 27 · F 0'],
    [{ protein_g: 5 }, 'P 5'],
    [{ carbs_g: 9, fat_g: 2 }, 'C 9 · F 2'],
    [{}, null],
    [undefined, null],
  ])('%o → %s', (m, want) => {
    expect(macroLine(m)).toBe(want);
  });
});
