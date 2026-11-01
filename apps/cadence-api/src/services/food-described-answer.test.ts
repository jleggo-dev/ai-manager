/**
 * The answer to a question row (FOOD-LOGGING-COACH-LED.md, "chips in her voice"): the words the
 * question was about and the answer become ONE part through the same read (`readParts`), and the
 * priced row comes back for the card to put where the asked row was. Pinned here:
 *   - the merge of words and answer, as a table of positives and near-misses;
 *   - a chosen answer prices the part from the record the model picks and keeps `said` as the
 *     words the question was about, so the confirm teaches "milk" → that record;
 *   - a typed answer prices the same way but keeps the combined words as `said`;
 *   - an answer with a comma is one part, not two;
 *   - words the memory holds under the combined phrase are a hit with no call;
 *   - a model that still cannot tell hands back a question row again, with no number;
 *   - the log says what was answered; blank words or a blank answer never reach the read.
 */
import { describe, expect, it, vi } from 'vitest';
import type { Food } from '@cadence/shared';

vi.mock('../ai/aim.ts', () => ({ runJobBySlug: vi.fn() }));
vi.mock('../repos/foods.ts', () => ({ getFoodsByIds: vi.fn(async () => []) }));
vi.mock('../repos/food-phrases.ts', () => ({ recallFoodPhrases: vi.fn(), rememberFoodPhrase: vi.fn() }));
vi.mock('./ai-log.ts', () => ({ logAi: vi.fn() }));
vi.mock('./food-candidate-sources.ts', () => ({ wideLookup: () => async () => ({}) }));
vi.mock('./food-pricing.ts', async (orig) => {
  const actual = await orig<typeof import('./food-pricing.ts')>();
  return { ...actual, priceParsedMeal: vi.fn() };
});

import type { FoodPhraseRow } from '../repos/food-phrases.ts';
import type { FanOutResult } from './food-source-fanout.ts';
import type { SourceCandidate } from './food-source-report.ts';
import { answeredLookup, answeredWords, previewAnsweredPart } from './food-described-answer.ts';
import type { DescribedMealDeps } from './food-described-rows.ts';
import { phraseKey } from './food-phrases.ts';

const USER = '00000000-0000-4000-a000-00000000d001';

function food(over: Partial<Food> & { food_id: string; name: string }): Food {
  return {
    owner_user_id: null,
    visibility: 'shared',
    brand: null,
    source: 'usda',
    off_id: null,
    fdc_id: null,
    base_unit: 'g',
    macros_per_base: { kcal: 61, protein_g: 3.2 },
    servings: [{ label: '1 cup (244g)', unit: 'cup', amount_g: 244 }],
    default_serving: 0,
    confidence: 1,
    photo_ref: null,
    ...over,
  };
}
const wholeMilk = food({ food_id: 'f-whole', name: 'Milk, whole' });
const oatMilk = food({ food_id: 'f-oat', name: 'Oat milk, unsweetened', macros_per_base: { kcal: 40, protein_g: 1 } });
const FOODS = [wholeMilk, oatMilk];

function asCandidate(f: Food): SourceCandidate {
  const s = f.servings[0]!;
  return {
    source: 'usda',
    food_id: f.food_id,
    name: f.name,
    brand: f.brand,
    per: {
      measure: s.label,
      grams: s.amount_g,
      nutrients: {
        kcal: ((f.macros_per_base.kcal ?? 0) * s.amount_g) / 100,
        protein_g: ((f.macros_per_base.protein_g ?? 0) * s.amount_g) / 100,
      },
    },
    measures: [{ label: s.label, grams: s.amount_g }],
    base_unit: f.base_unit,
    micros: 'none',
    completeness: 'full',
    notes: [],
  };
}

const BY_Q: Record<string, Food[]> = {
  'whole milk': [wholeMilk],
  'lactose-free milk': [wholeMilk],
  'oat milk, unsweetened': [oatMilk],
};

function fanOut(q: string): FanOutResult {
  const rows = BY_Q[q] ?? [];
  return {
    query: q,
    brand: null,
    requested_measure: null,
    candidates: rows.map(asCandidate),
    sources_checked: [{ source: 'usda', status: rows.length ? 'hit' : 'miss', ms: 1, detail: `${rows.length} rows` }],
    disagreements: [],
  };
}

const item = (over: Record<string, unknown>) => ({
  said: '',
  name: null,
  brand: null,
  pick: null,
  measure: null,
  count: null,
  assumption: null,
  question: null,
  choices: null,
  estimate: null,
  ...over,
});

function deps(over: { reply?: Array<Record<string, unknown>>; memory?: Record<string, FoodPhraseRow> } = {}) {
  const calls: Array<{ said: string; book: string }> = [];
  const lookups: string[] = [];
  const log = vi.fn();
  const d: DescribedMealDeps = {
    lookup: async (l) => {
      lookups.push(l.q);
      return fanOut(l.q);
    },
    call: async (vars) => {
      calls.push({ said: vars.said, book: vars.book });
      return JSON.stringify({ items: over.reply ?? [], lookups: [] });
    },
    foods: async (ids) => FOODS.filter((f) => ids.includes(f.food_id)),
    recall: async (keys) => new Map(keys.flatMap((k) => (over.memory?.[k] ? [[k, over.memory[k]!] as const] : []))),
    fallback: vi.fn(async (text: string) => ({
      meal: 'other' as const,
      items: [{ name: text, qty: 1, unit: 'serving', est: { kcal: 10 } }],
      macros: { kcal: 10 },
      confidence: 0.5,
      flags: {},
      raw_text: text,
    })),
    log,
  };
  return { d, calls, lookups, log };
}

const wholePick = (said: string) => item({ said, pick: 'c1', measure: '1 cup (244g)', count: 1 });

describe('answeredWords — the words and the answer as one part', () => {
  it.each([
    ['milk', 'Whole milk', 'whole milk'],
    ['milk', 'Oat milk', 'oat milk'],
    ['milk', '2%', '2% milk'],
    ['milk', 'Skim', 'skim milk'],
    ['a glass of milk', 'Skim', 'a glass of skim milk'],
    ['a glass of milk', 'Oat milk', 'a glass of oat milk'],
    ['2 cups milk', '2%', '2 cups 2% milk'],
    ['a bowl of rice', 'Cooked', 'a bowl of cooked rice'],
    ['coffee', 'With milk', 'coffee with milk'],
    ['coffee', 'Black', 'black coffee'],
    ['a latte', 'Large', 'a large latte'],
    ['a parfait', 'The small one', 'a small parfait'],
    ['protein', 'A protein shake', 'a protein shake'],
    // Typed answers: filler dropped, an answer that repeats the amount stands alone, a comma stays.
    ['milk', 'it was 2%', '2% milk'],
    ['a glass of milk', 'a glass of oat milk', 'a glass of oat milk'],
    ['milk', 'oat milk, unsweetened', 'oat milk, unsweetened'],
    ['milk', '  Whole   milk  ', 'whole milk'],
    // Near-misses: a blank answer leaves the words; an answer with no food words still joins on.
    ['milk', '   ', 'milk'],
    ['milk', 'USDA', 'USDA milk'],
  ])('%j + %j → %j', (about, answer, words) => {
    expect(answeredWords(about, answer)).toBe(words);
  });

  it('answeredLookup never splits, and peels the amount the way the split does', () => {
    expect(answeredLookup('2 cups skim milk')).toEqual({
      said: '2 cups skim milk',
      q: 'skim milk',
      measure: '2 cups',
      brand: null,
    });
    expect(answeredLookup('oat milk, unsweetened')).toMatchObject({ q: 'oat milk, unsweetened', measure: null });
  });
});

describe('previewAnsweredPart — one part through the same read', () => {
  it('a chosen answer prices the part from the picked record and keeps the words the question was about', async () => {
    const { d, calls, lookups, log } = deps({ reply: [wholePick('whole milk')] });
    const p = await previewAnsweredPart(
      USER,
      { asked_about: 'milk', answer: 'Whole milk', chosen: true, meal: 'breakfast' },
      d,
    );

    expect(lookups).toEqual(['whole milk']);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.said).toBe('whole milk');
    expect(p.meal).toBe('breakfast');
    expect(p.raw_text).toBe('whole milk');
    expect(p.items).toHaveLength(1);
    // Priced, linked, and `said` is "milk": the confirm teaches "milk" → this record.
    expect(p.items[0]).toMatchObject({
      name: 'Milk, whole',
      food_id: 'f-whole',
      basis: 'record',
      qty: 1,
      unit: 'cup',
      said: 'milk',
    });
    expect(p.items[0]?.est?.kcal).toBeCloseTo(149, 0);
    expect(p.macros?.kcal).toBeCloseTo(149, 0);
    expect(p.coach).toMatchObject({ reached: true, calls: 1 });
    expect(log).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({ answered: { asked_about: 'milk', answer: 'Whole milk' } }),
      }),
    );
  });

  it('a typed answer prices the same way but keeps the combined words, so "milk" does not learn to mean it', async () => {
    const { d, calls } = deps({ reply: [wholePick('lactose-free milk')] });
    const p = await previewAnsweredPart(USER, { asked_about: 'milk', answer: 'lactose-free', meal: 'breakfast' }, d);
    expect(calls[0]?.said).toBe('lactose-free milk');
    expect(p.items[0]).toMatchObject({ food_id: 'f-whole', basis: 'record', said: 'lactose-free milk' });
  });

  it('an answer with a comma is one part: one lookup, one part in the words the model reads', async () => {
    const { d, calls, lookups } = deps({ reply: [wholePick('oat milk, unsweetened')] });
    await previewAnsweredPart(USER, { asked_about: 'milk', answer: 'oat milk, unsweetened', meal: 'snack' }, d);
    expect(lookups).toEqual(['oat milk, unsweetened']);
    expect(calls[0]?.said).toBe('oat milk, unsweetened');
  });

  it('words the memory holds under the combined phrase are a hit: no lookup, no call', async () => {
    const key = phraseKey('whole milk');
    const { d, calls, lookups } = deps({
      memory: { [key]: { phrase: key, food_id: 'f-whole', qty: 1, unit: 'cup', uses: 2 } },
    });
    const p = await previewAnsweredPart(USER, { asked_about: 'milk', answer: 'Whole milk', chosen: true }, d);
    expect(lookups).toEqual([]);
    expect(calls).toEqual([]);
    expect(p.items[0]).toMatchObject({ food_id: 'f-whole', basis: 'remembered', said: 'milk' });
    expect(p.coach).toMatchObject({ reached: true, calls: 0 });
  });

  it('when the model still cannot tell, the row comes back as a question again — no number, no link', async () => {
    const { d } = deps({
      reply: [
        item({
          said: 'whole milk',
          pick: 'c1',
          measure: '1 cup (244g)',
          count: 1,
          question: 'How much?',
        }),
      ],
    });
    const p = await previewAnsweredPart(USER, { asked_about: 'milk', answer: 'Whole milk', chosen: true }, d);
    expect(p.items[0]).toEqual({ name: 'whole milk', basis: 'none', question: 'How much?', asked_about: 'whole milk' });
    expect(p.macros).toBeNull();
  });

  it('near-miss: a slot the words cannot carry comes from the caller, else other', async () => {
    const { d } = deps({ reply: [wholePick('whole milk')] });
    expect((await previewAnsweredPart(USER, { asked_about: 'milk', answer: 'Whole milk' }, d)).meal).toBe('other');
  });

  it('blank words or a blank answer never reach the read', async () => {
    const { d, calls } = deps({ reply: [wholePick('whole milk')] });
    await expect(previewAnsweredPart(USER, { asked_about: '  ', answer: 'Whole milk' }, d)).rejects.toThrow(/words/);
    await expect(previewAnsweredPart(USER, { asked_about: 'milk', answer: '  ' }, d)).rejects.toThrow(/words/);
    expect(calls).toEqual([]);
  });
});
