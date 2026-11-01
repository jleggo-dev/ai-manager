import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * `preview_meal` wraps `previewMealParse` (nutrition.ts) — a thin read, so what is tested here is
 * the translation: usage hints for bad calls, the fully/partly-priced split, and that an unresolved
 * item names research_food (with a brand) or the Food screen (without one) rather than guessing.
 */
vi.mock('../nutrition.ts', () => ({ previewMealParse: vi.fn() }));

import { previewMealParse } from '../nutrition.ts';
import { PREVIEW_MEAL } from './food-log-function.ts';

beforeEach(() => {
  vi.mocked(previewMealParse).mockReset();
});

describe('preview_meal.run', () => {
  it('returns null and does not call the parser when text is blank', async () => {
    const out = await PREVIEW_MEAL.run('u1', { text: '  ' });
    expect(out).toBeNull();
    expect(previewMealParse).not.toHaveBeenCalled();
  });

  it('trims text and forwards a recognised meal hint', async () => {
    vi.mocked(previewMealParse).mockResolvedValue({
      meal: 'breakfast',
      items: [],
      flags: {},
      confidence: 0.9,
      macros: null,
      raw_text: 'eggs',
    } as never);
    await PREVIEW_MEAL.run('u1', { text: '  eggs  ', meal: 'breakfast' });
    expect(previewMealParse).toHaveBeenCalledWith('u1', 'eggs', 'breakfast');
  });

  it('ignores an unrecognised meal value rather than passing it through', async () => {
    vi.mocked(previewMealParse).mockResolvedValue({
      meal: 'other',
      items: [],
      flags: {},
      confidence: null,
      macros: null,
      raw_text: 'eggs',
    } as never);
    await PREVIEW_MEAL.run('u1', { text: 'eggs', meal: 'brunch' });
    expect(previewMealParse).toHaveBeenCalledWith('u1', 'eggs', undefined);
  });
});

describe('preview_meal.render', () => {
  it('gives a usage hint for a bare call, never a fault or empty text', () => {
    const out = PREVIEW_MEAL.render(null);
    expect(out).toContain('pass text');
  });

  it('reports a fault distinctly from an empty or usage result', () => {
    const out = PREVIEW_MEAL.render(undefined);
    expect(out).toMatch(/could not.*read/i);
    expect(out).not.toContain('pass text');
  });

  it('says nothing readable when the parse produced no items', () => {
    const out = PREVIEW_MEAL.render({ meal: 'other', items: [], macros: null, raw_text: 'blah blah' } as never);
    expect(out).toContain('Nothing readable as food in "blah blah"');
  });

  it('reports fully priced when every item has numbers', () => {
    const out = PREVIEW_MEAL.render({
      meal: 'snack',
      raw_text: 'a banana',
      macros: { kcal: 105, protein_g: 1, carbs_g: 27, fat_g: 0 },
      items: [{ name: 'banana', qty: 1, unit: 'item', est: { kcal: 105, protein_g: 1, carbs_g: 27, fat_g: 0 } }],
    } as never);
    expect(out).toContain('Fully priced (snack)');
    expect(out).toContain('105 kcal');
    expect(out).toContain('Everything here is settled');
    // What is true since FOOD-LOGGING-COACH-LED step 3: log_meal runs this same read and logs it.
    expect(out).toContain('log_meal runs this same read and logs what it shows');
    expect(out).toContain('a row waiting on their answer is handed back, not logged');
    expect(out).not.toContain('does not run this read');
    expect(out).not.toContain('older automatic match');
    expect(out).not.toContain('Unresolved');
  });

  it('a row with an open question is listed as waiting, never as unresolved, and the meal is not fully priced', () => {
    const out = PREVIEW_MEAL.render({
      meal: 'breakfast',
      raw_text: 'milk and a banana',
      macros: { kcal: 105 },
      items: [
        { name: 'milk', question: 'Whole milk or 2%?', basis: 'none' },
        { name: 'banana', qty: 1, unit: 'medium', est: { kcal: 105 }, basis: 'record', source_label: 'USDA' },
      ],
      coach: { reached: true, calls: 1, checked: [] },
    } as never);
    expect(out).toContain('Partly priced (breakfast): 1/2 items have numbers, 1 waiting on their answer');
    expect(out).toContain('- milk: not priced yet (not counted; waiting on their answer: Whole milk or 2%?)');
    expect(out).toContain('Waiting on their answer:\n- milk: Whole milk or 2%?');
    expect(out).toContain('- 1 medium banana: 105 kcal (a record the coach picked; from USDA)');
    expect(out).not.toContain('Fully priced');
    expect(out).not.toContain('Unresolved');
  });

  it("an estimate row reads as the coach's own estimate, apart from a record", () => {
    const out = PREVIEW_MEAL.render({
      meal: 'snack',
      raw_text: 'a parfait and a banana',
      macros: { kcal: 485 },
      items: [
        {
          name: 'yogurt parfait',
          qty: 1,
          unit: 'serving',
          est: { kcal: 380 },
          basis: 'estimate',
          source_label: "the coach's estimate",
        },
        { name: 'banana', qty: 1, unit: 'medium', est: { kcal: 105 }, basis: 'record', source_label: 'USDA' },
      ],
      coach: { reached: true, calls: 1, checked: [] },
    } as never);
    expect(out).toContain("- 1 serving yogurt parfait: 380 kcal (the coach's own estimate; from the coach's estimate)");
    expect(out).toContain('- 1 medium banana: 105 kcal (a record the coach picked; from USDA)');
    expect(out).toContain('Fully priced (snack)');
  });

  it('says why a row counted nothing, and that the fallback priced an unreached read', () => {
    const out = PREVIEW_MEAL.render({
      meal: 'snack',
      raw_text: 'a thing',
      macros: null,
      items: [{ name: 'a thing', basis: 'none', problem: 'no record fits and no estimate was given' }],
      coach: { reached: false, calls: 1, checked: [] },
    } as never);
    expect(out).toContain('could not be reached');
    expect(out).toContain('why: no record fits and no estimate was given');
  });

  it('names an unresolved branded item and points at research_food with its exact args', () => {
    const out = PREVIEW_MEAL.render({
      meal: 'dinner',
      raw_text: 'wild mushroom co dried mushrooms',
      macros: null,
      items: [{ name: 'dried mushrooms', brand: 'the wild mushroom co', qty: 15, unit: 'pieces' }],
    } as never);
    expect(out).toContain('Partly priced (dinner)');
    expect(out).toContain('research_food');
    expect(out).toContain('"name": "dried mushrooms"');
    expect(out).toContain('"brand": "the wild mushroom co"');
    expect(out).toContain('Do not log_meal this and call it done');
  });

  it('points an unresolved item with no brand at the Food screen rather than research_food', () => {
    const out = PREVIEW_MEAL.render({
      meal: 'lunch',
      raw_text: 'some kind of grain bowl',
      macros: null,
      items: [{ name: 'grain bowl' }],
    } as never);
    expect(out).toContain('Ask them for more detail');
    expect(out).toContain('Food screen');
    expect(out).not.toContain('research_food');
  });

  it('reports partly priced with a running total when some items are priced and some are not', () => {
    const out = PREVIEW_MEAL.render({
      meal: 'dinner',
      raw_text: 'chicken and something unknown',
      macros: { kcal: 220, protein_g: 40, carbs_g: 0, fat_g: 6 },
      items: [
        { name: 'chicken breast', qty: 150, unit: 'g', est: { kcal: 220, protein_g: 40, carbs_g: 0, fat_g: 6 } },
        { name: 'mystery sauce' },
      ],
    } as never);
    expect(out).toContain('Partly priced (dinner): 1/2 items have numbers');
  });
});
