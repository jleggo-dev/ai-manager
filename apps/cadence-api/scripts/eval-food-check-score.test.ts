import { describe, expect, it } from 'vitest';
import { matchMeasure, priceItem, scoreMeal, within, type ShownCandidate } from './eval-food-check-score.ts';
import type { FoodCheckCase } from './eval-food-check-cases.ts';

const milk: ShownCandidate = {
  id: 'c1',
  name: 'Milk, 2%',
  per_g: { kcal: 0.5, protein_g: 0.034 },
  measures: [
    { label: '1 cup', grams: 244 },
    { label: '100 ml', grams: 103 },
  ],
};
const shown = new Map([[milk.id, milk]]);

describe('priceItem — the model chooses, code counts', () => {
  it('prices a returned record at a measure it offers, times the count', () => {
    const o = priceItem({ said: 'milk', pick: 'c1', measure: '1 cup', count: 1.5 }, shown);
    expect(o.basis).toBe('record');
    expect(o.kcal).toBeCloseTo(183, 0);
  });

  it('grams always work as a measure', () => {
    expect(priceItem({ pick: 'c1', measure: 'g', count: 150 }, shown).kcal).toBeCloseTo(75, 0);
  });

  it('a made-up id counts nothing — not even the estimate beside it', () => {
    const o = priceItem({ pick: 'c9', measure: '1 cup', estimate: { kcal: 100 } }, shown);
    expect(o).toMatchObject({ basis: 'none', kcal: null, problem: 'made-up id c9' });
  });

  it('a measure the record does not offer falls back to the labelled estimate, and says why', () => {
    const o = priceItem({ pick: 'c1', measure: '1 glass', estimate: { kcal: 120, protein_g: 8 } }, shown);
    expect(o).toMatchObject({ basis: 'estimate', kcal: 120, problem: 'measure "1 glass" is not one c1 offers' });
  });

  it('no pick: a labelled estimate counts as an estimate, nothing at all counts as none', () => {
    expect(priceItem({ said: 'x', estimate: { kcal: 50 } }, shown).basis).toBe('estimate');
    expect(priceItem({ said: 'x' }, shown).basis).toBe('none');
  });

  it('measure names match ignoring case and spacing', () => {
    expect(priceItem({ pick: 'c1', measure: ' 1  CUP ' }, shown).basis).toBe('record');
  });
});

describe('matchMeasure — what the model meant, never a guess', () => {
  const ms = [
    { label: '1 medium (7" to 7-7/8" long) (118g)', grams: 118 },
    { label: '1 large (136g)', grams: 136 },
    { label: '1 cup, sliced', grams: 150 },
    { label: '1 cup, mashed', grams: 225 },
  ];
  it('ignores the bracketed grams a model drops', () => {
    expect(matchMeasure(ms, '1 medium')?.grams).toBe(118);
    expect(matchMeasure(ms, '1 LARGE')?.grams).toBe(136);
  });
  it('ignores the "= grams" a model copies from the book', () => {
    expect(matchMeasure(ms, '1 medium (7" to 7-7/8" long) = 118.0 g')?.grams).toBe(118);
    expect(matchMeasure(ms, '1 large = 136 g')?.grams).toBe(136);
  });
  it('an ambiguous prefix is no match', () => {
    expect(matchMeasure(ms, '1 cup')).toBeNull();
  });
  it('a unique prefix matches; something not offered does not', () => {
    expect(matchMeasure(ms, '1 cup, sl')?.grams).toBe(150);
    expect(matchMeasure(ms, '1 small')).toBeNull();
    expect(matchMeasure(ms, '')).toBeNull();
  });
});

describe('within', () => {
  it('relative under 1, absolute over 1', () => {
    expect(within(110, 100, 0.2)).toBe(true);
    expect(within(125, 100, 0.2)).toBe(false);
    expect(within(4, 3, 2)).toBe(true);
    expect(within(6, 3, 2)).toBe(false);
    expect(within(null, 3, 2)).toBe(false);
  });
});

describe('scoreMeal', () => {
  const c: FoodCheckCase = {
    id: 't',
    kind: 'real',
    meal: 'breakfast',
    text: '1.5 c milk',
    kcal: 183,
    protein_g: 12,
    flag: ['milk'],
    why: '',
  };

  it('right when both totals land, and counts a stated assumption on a flagged word', () => {
    const items = [{ said: 'milk', pick: 'c1', measure: '1 cup', count: 1.5, assumption: 'I took it as 2% milk' }];
    const s = scoreMeal(c, items, items.map((i) => priceItem(i, shown)));
    expect(s).toMatchObject({ right: true, flagged: 1, flagsWanted: 1, madeUpIds: 0 });
  });

  it('silently picking leaves the flag unanswered; a made-up id is counted', () => {
    const items = [{ said: 'milk', pick: 'c7', measure: '1 cup', count: 1.5 }];
    const s = scoreMeal(c, items, items.map((i) => priceItem(i, shown)));
    expect(s).toMatchObject({ right: false, flagged: 0, madeUpIds: 1 });
  });
});

describe('uniqueMeasures — a headline measure listed twice must not make every match ambiguous', () => {
  it('keeps the first of each label, ignoring case and outer spaces', async () => {
    const { uniqueMeasures } = await import('./eval-food-check-protocol.ts');
    const ms = uniqueMeasures([
      { label: '0.5 cup (115 g)', grams: 115 },
      { label: '100 ml', grams: 100 },
      { label: ' 0.5 CUP (115 g) ', grams: 115 },
    ]);
    expect(ms.map((m) => m.label)).toEqual(['0.5 cup (115 g)', '100 ml']);
    expect(matchMeasure(ms, '0.5 cup')?.grams).toBe(115);
  });
});
