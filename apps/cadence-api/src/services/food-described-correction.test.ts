/**
 * "Not quite": the previous answer and what was wrong with it, as the food-check reads them in
 * its notes. The shape is pinned because the model is told what to do with it in the first line.
 */
import { describe, expect, it } from 'vitest';
import { CORRECTION_MAX_CHARS, PREVIOUS_ROWS_MAX } from '@cadence/shared';
import { CORRECTION_LEAD, correctionNotes } from './food-described-correction.ts';

describe('correctionNotes — the previous answer and the correction, for the model', () => {
  it('leads with what to do, lists the rows as the card showed them, then the correction in their words', () => {
    const notes = correctionNotes({
      words: 'the guinness was the 0.0 non-alcoholic one',
      previous: ['Fried Chicken Wing No Coating, 453.6 g', 'Red Robin Guinness (Can), 1 serving'],
    });
    expect(notes).toBe(
      [
        CORRECTION_LEAD,
        'Previous answer:',
        '- Fried Chicken Wing No Coating, 453.6 g',
        '- Red Robin Guinness (Can), 1 serving',
        'Their correction: "the guinness was the 0.0 non-alcoholic one"',
      ].join('\n'),
    );
  });

  it('no rows says so, blank rows are dropped, and the caps hold', () => {
    expect(correctionNotes({ words: 'x', previous: [] })).toContain('- (no rows were shown)');
    expect(correctionNotes({ words: 'x', previous: ['   ', 'a row'] }).split('\n')).toContain('- a row');
    const long = correctionNotes({
      words: 'w'.repeat(CORRECTION_MAX_CHARS + 50),
      previous: Array.from({ length: PREVIOUS_ROWS_MAX + 3 }, (_, i) => `row ${i}`),
    });
    expect(long).toContain(`"${'w'.repeat(CORRECTION_MAX_CHARS)}"`);
    expect(long).not.toContain('w'.repeat(CORRECTION_MAX_CHARS + 1));
    expect(long.split('\n').filter((l) => l.startsWith('- '))).toHaveLength(PREVIOUS_ROWS_MAX);
  });
});
