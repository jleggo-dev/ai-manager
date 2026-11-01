import { describe, expect, it } from 'vitest';
import type { FanOutResult } from '../src/services/food-source-fanout.ts';
import type { FoodCheckVars } from '../src/services/food-check.ts';
import {
  buildSinglePrompt,
  partsToLookups,
  runMealConfig,
  splitMealParts,
  stripAmount,
} from './eval-food-check-single.ts';
import type { FoodCheckCase } from './eval-food-check-cases.ts';

describe('splitMealParts — separators a person actually types', () => {
  it.each([
    ['150ml 2% mulk', ['150ml 2% mulk']],
    ['1.5 c milk\n2 shots espresso', ['1.5 c milk', '2 shots espresso']],
    ['coffee with cream', ['coffee', 'cream']],
    ['eggs, toast and butter', ['eggs', 'toast', 'butter']],
    ['1 cup coconut milk beverage, unsweetened', ['1 cup coconut milk beverage', 'unsweetened']],
    ['Starbucks venti latte', ['Starbucks venti latte']],
    ['a sandwich', ['a sandwich']],
  ])('%j → %j', (text, parts) => {
    expect(splitMealParts(text)).toEqual(parts);
  });

  it('dictated prose with no separators stays one part (the second round catches it)', () => {
    const parts = splitMealParts('Quarter cup of frozen blueberries quarter cup of frozen strawberries');
    expect(parts).toHaveLength(1);
  });
});

describe('stripAmount — the amount comes off, the food stays', () => {
  it.each([
    ['150ml 2% mulk', '2% mulk', '150ml'],
    ['2 tbsp powdered peanut butter', 'powdered peanut butter', '2 tbsp'],
    ['1/2 cup uncooked white rice', 'uncooked white rice', '1/2 cup'],
    ['a handful of almonds', 'almonds', 'a handful'],
    ['a banana', 'banana', null],
    ['1 medium baked sweet potato', 'baked sweet potato', '1 medium'],
    ['6 oz grilled chicken breast', 'grilled chicken breast', '6 oz'],
    ['Starbucks venti latte', 'Starbucks venti latte', null],
    ["siggi's creamy skyr plain", "siggi's creamy skyr plain", null],
    ['2 Roma tomatoes', 'Roma tomatoes', '2'],
  ])('%j → q %j, measure %j', (part, q, measure) => {
    expect(stripAmount(part)).toEqual({ q, measure });
  });

  it('never strips a part down to nothing', () => {
    expect(stripAmount('2 large')).toEqual({ q: '2 large', measure: null });
  });
});

describe('partsToLookups', () => {
  it('one lookup per distinct part, amount as the measure', () => {
    expect(partsToLookups('1.5 c milk\n2 shots espresso')).toEqual([
      { said: '1.5 c milk', q: 'milk', measure: '1.5 c', brand: null },
      { said: '2 shots espresso', q: 'espresso', measure: '2 shots', brand: null },
    ]);
  });
  it('the same food twice is looked up once', () => {
    expect(partsToLookups('milk, milk')).toHaveLength(1);
  });
});

describe('buildSinglePrompt — the last call cannot ask for more', () => {
  const c: FoodCheckCase = { id: 'x', kind: 'real', meal: 'lunch', text: 'eggs', kcal: 1, protein_g: 1, why: '' };
  it('offers lookups on the first call only', () => {
    expect(buildSinglePrompt(c, [], false)).toContain('"lookups"');
    const last = buildSinglePrompt(c, [], true);
    expect(last).not.toContain('"lookups"');
    expect(last).toContain('last reply');
  });
});

describe('runMealConfig — the shipped job, the production way', () => {
  const c: FoodCheckCase = {
    id: 'x',
    kind: 'real',
    meal: 'snack',
    text: 'a banana',
    kcal: 105,
    protein_g: 1.3,
    why: '',
  };
  const found: FanOutResult = {
    query: 'banana',
    brand: null,
    requested_measure: null,
    candidates: [
      {
        source: 'usda',
        food_id: 'f-banana',
        name: 'Banana, raw',
        brand: null,
        per: { measure: '1 medium (118g)', grams: 118, nutrients: { kcal: 105, protein_g: 1.3 } },
        measures: [{ label: '1 medium (118g)', grams: 118 }],
        micros: 'measured',
        completeness: 'full',
        notes: [],
      },
    ],
    sources_checked: [],
    disagreements: [],
  };

  it("sends the template's variables, never a prompt it filled itself, and scores against what the book showed", async () => {
    const sent: FoodCheckVars[] = [];
    const run = await runMealConfig(c, {
      lookup: async () => found,
      run: async (vars) => {
        sent.push(vars);
        return {
          raw: JSON.stringify({
            items: [
              {
                said: 'a banana',
                name: null,
                brand: null,
                pick: 'c1',
                measure: '1 medium (118g)',
                count: 1,
                assumption: null,
                question: null,
                estimate: null,
              },
            ],
            lookups: [],
          }),
          ms: 1,
          promptTokens: 1,
          completionTokens: 1,
        };
      },
    });
    expect(sent).toHaveLength(1);
    // Exactly the variables the config declares — the engine wraps and caps them server-side.
    expect(Object.keys(sent[0]!).sort()).toEqual(['book', 'guard_notes', 'meal', 'notes', 'round_rule', 'said']);
    // A typed meal has no photo reader: its notes are empty, not absent.
    expect(sent[0]!.notes).toBe('');
    expect(sent[0]!.book).toContain('c1 · usda · Banana, raw');
    expect(run.error).toBeNull();
    expect(run.final?.[0]?.pick).toBe('c1');
    expect([...run.shown.keys()]).toEqual(['c1']);
  });
});
