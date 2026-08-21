/**
 * The grader goes on trial before the thing it grades.
 *
 * Every case here is a real failure or a real near-miss from the first runs on 2026-08-20. A bug in
 * this file does not look like a bug — it looks like a model getting worse, and it would be argued
 * about for a week before anyone suspected the ruler.
 */
import { describe, it, expect } from 'vitest';
import { scoreDescription, scoreMacros, extractJson } from './eval-food-vision-score.ts';
import { FOOD_VISION_CASES } from './eval-food-vision-cases.ts';

const latte = FOOD_VISION_CASES.find((c) => c.key === 'latte')!;
const parfait = FOOD_VISION_CASES.find((c) => c.key === 'parfait')!;

describe('scoreDescription — negation', () => {
  /**
   * The first real run scored gpt-5-mini as INVENTING whipped cream. It had written "no visible
   * whipped cream, syrups, or toppings" — the prompt working as designed. Saying what is absent is
   * the behaviour we want; scoring it as a hallucination punishes exactly the right answer.
   */
  it('does not count a denial as a claim', () => {
    const s = scoreDescription('A latte. There is no visible whipped cream, syrups, or toppings.', latte);
    expect(s.invented).toEqual([]);
  });

  it.each([
    ["I can't see any whipped cream on top.", false],
    ['Served without whipped cream.', false],
    ['Topped with whipped cream and caramel.', true],
    // Clause boundary: a denial of the NEXT thing must not retroactively clear the previous one.
    ['It has whipped cream. No sugar was added.', true],
  ])('%s → invented=%s', (text, expected) => {
    const s = scoreDescription(`a latte. ${text}`, latte);
    expect(s.invented.includes('whipped cream')).toBe(expected);
  });
});

describe('scoreDescription — matching', () => {
  it('matches aliases and stems, so plurals and synonyms count', () => {
    const s = scoreDescription('Greek yoghurt layered with fresh blueberries.', parfait);
    expect(s.missed).toEqual([]);
    expect(s.recall).toBe(1);
  });

  /** "goat cheese" must not satisfy an "oat" alias — the left-edge guard. */
  it('does not match a stem inside a longer word', () => {
    const s = scoreDescription('A goat cheese salad.', {
      ...parfait,
      components: [{ name: 'oats', aliases: ['oat'], qty: null }],
    });
    expect(s.found).toEqual([]);
  });

  it('flags a refusal separately from a bad description', () => {
    const s = scoreDescription("I'm unable to view images.", latte);
    expect(s.refused).toBe(true);
    expect(s.recall).toBe(0);
  });

  it('separates anchoring from merely stating a number', () => {
    const anchored = scoreDescription('The cup is a standard 12oz takeaway cup, filled near the rim.', latte);
    expect(anchored.anchored).toBe(true);
    // A bare quantity with nothing to scale it against is the failure mode that reads as success.
    const bare = scoreDescription('A coffee drink of about 300.', latte);
    expect(bare.anchored).toBe(false);
  });
});

describe('scoreMacros', () => {
  it('reads a fenced JSON reply', () => {
    expect(extractJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
  });

  /**
   * THE bug. `{"items":[],"est_macros":{}}` parsed fine and was stored as a settled 0-kcal meal.
   * "Parsed" and "has numbers" must never be the same question again.
   */
  it('marks a well-formed but empty result as having no numbers', () => {
    const m = scoreMacros('{"meal":"breakfast","items":[],"est_macros":{}}', latte);
    expect(m.parsed).toBe(true);
    expect(m.hasNumbers).toBe(false);
  });

  it('counts items alone as numbers — a different failure from empty-everything', () => {
    const m = scoreMacros('{"items":[{"name":"latte"}],"est_macros":{}}', latte);
    expect(m.hasNumbers).toBe(true);
  });

  it('distinguishes an empty reply from unparseable prose', () => {
    expect(scoreMacros('', latte).parseError).toBe('empty reply');
    expect(scoreMacros('I think it was a latte.', latte).parseError).toBe('no JSON object in reply');
  });

  it('skips kcal error when the case has no verified truth', () => {
    const m = scoreMacros('{"est_macros":{"kcal":150}}', latte);
    expect(latte.kcal).toBeNull();
    expect(m.kcalErrorPct).toBeNull();
  });

  it('computes kcal error when truth exists', () => {
    const m = scoreMacros('{"est_macros":{"kcal":180}}', { ...latte, kcal: 150 });
    expect(m.kcalErrorPct).toBe(20);
  });
});
