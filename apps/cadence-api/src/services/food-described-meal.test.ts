/**
 * The described-meal read through its seam (`DescribedMealDeps`): every source faked, nothing on
 * the network, the rules the card relies on each pinned with a positive and a near-miss.
 *
 *   - a row with an open question carries no number and no link, and is not in the total;
 *   - the model is asked only about the parts the memory did not settle, and a row it writes for a
 *     remembered part anyway is dropped — never two lattes;
 *   - the memory never skips a part it holds: a bare count takes the remembered unit, an amount
 *     the store cannot read falls back to the remembered amount;
 *   - when she cannot be reached the fallback prices the pending words, labelled, and the trace does
 *     not repeat the notice;
 *   - the trace is built from what ran.
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
import { CandidateBook, partsToLookups } from './food-candidate-book.ts';
import { previewDescribedMeal, traceLines, type DescribedMealDeps } from './food-described-meal.ts';
import { rememberedRows, saidPortion } from './food-described-rows.ts';
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
    macros_per_base: { kcal: 100, protein_g: 5 },
    servings: [{ label: '100 g', unit: 'g', amount_g: 100 }],
    default_serving: 0,
    confidence: 1,
    photo_ref: null,
    ...over,
  };
}

const banana = food({
  food_id: 'f-banana',
  name: 'Banana, raw',
  macros_per_base: { kcal: 89, protein_g: 1.1 },
  servings: [{ label: '1 medium (118g)', unit: 'medium', amount_g: 118 }],
});
const milk = food({
  food_id: 'f-milk',
  name: 'Milk, 2%',
  macros_per_base: { kcal: 50, protein_g: 3.3 },
  servings: [{ label: '1 cup (244g)', unit: 'cup', amount_g: 244 }],
});
const latte = food({
  food_id: 'f-latte',
  owner_user_id: USER,
  name: 'Caffè Latte (Venti)',
  brand: 'Starbucks',
  source: 'fatsecret',
  macros_per_base: { kcal: 42.3, protein_g: 2.7 },
  servings: [{ label: '1 venti', unit: 'venti', amount_g: 591 }],
});
const eggs = food({
  food_id: 'f-eggs',
  owner_user_id: USER,
  name: 'Eggs',
  source: 'llm',
  base_unit: 'item',
  macros_per_base: { kcal: 72, protein_g: 6.3 },
  servings: [{ label: '1 large', unit: 'large', amount_g: 1 }],
});
const almonds = food({ food_id: 'f-almonds', name: 'Almonds', macros_per_base: { kcal: 579, protein_g: 21 } });
const chicken = food({
  food_id: 'f-chicken',
  name: 'Chicken breast, cooked',
  macros_per_base: { kcal: 165, protein_g: 31 },
});
const FOODS = [banana, milk, latte, eggs, almonds, chicken];

function asCandidate(f: Food): SourceCandidate {
  const s = f.servings[0]!;
  const factor = f.base_unit === 'item' ? s.amount_g : s.amount_g / 100;
  return {
    source: f.source === 'usda' ? 'usda' : f.source === 'fatsecret' ? 'fatsecret' : 'ledger',
    food_id: f.food_id,
    name: f.name,
    brand: f.brand,
    per: {
      measure: s.label,
      grams: s.amount_g,
      nutrients: {
        kcal: (f.macros_per_base.kcal ?? 0) * factor,
        protein_g: (f.macros_per_base.protein_g ?? 0) * factor,
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
  banana: [banana],
  milk: [milk],
  'Starbucks venti latte': [latte],
  'venti latte from Starbucks': [latte],
  eggs: [eggs],
  almonds: [almonds],
  chicken: [chicken],
};

function fanOut(q: string): FanOutResult {
  const rows = BY_Q[q] ?? [];
  return {
    query: q,
    brand: null,
    requested_measure: null,
    candidates: rows.map(asCandidate),
    sources_checked: [
      {
        source: 'ledger',
        status: rows.length ? 'hit' : 'miss',
        ms: 2,
        detail: rows.length ? `${rows.length} rows` : 'no match',
      },
      { source: 'usda', status: 'skipped', ms: 0, detail: 'not a whole food' },
      { source: 'fatsecret', status: 'error', ms: 900, detail: 'timeout' },
    ],
    disagreements: [],
  };
}

type Reply = Array<Record<string, unknown>>;
const item = (over: Record<string, unknown>) => ({
  said: '',
  name: null,
  brand: null,
  pick: null,
  measure: null,
  count: null,
  assumption: null,
  question: null,
  estimate: null,
  ...over,
});

function deps(over: Partial<DescribedMealDeps> & { reply?: Reply; memory?: Record<string, FoodPhraseRow> } = {}) {
  const calls: Array<{ said: string; book: string }> = [];
  const d: DescribedMealDeps = {
    lookup: async (l) => fanOut(l.q),
    call: async (vars) => {
      calls.push({ said: vars.said, book: vars.book });
      return JSON.stringify({ items: over.reply ?? [], lookups: [] });
    },
    foods: async (ids) => FOODS.filter((f) => ids.includes(f.food_id)),
    recall: async (keys) => new Map(keys.flatMap((k) => (over.memory?.[k] ? [[k, over.memory[k]!] as const] : []))),
    fallback: vi.fn(async (text: string) => ({
      meal: 'other' as const,
      items: text.split(', ').map((name) => ({ name, qty: 1, unit: 'serving', est: { kcal: 10 } })),
      macros: { kcal: 10 },
      confidence: 0.5,
      flags: {},
      raw_text: text,
    })),
    log: vi.fn(),
    ...over,
  };
  return { d, calls };
}

describe('a row with an open question (the question is the answer it waits for)', () => {
  it('carries no number and no link, keeps their words as its name, and is not in the total', async () => {
    const { d } = deps({
      reply: [
        item({ said: 'milk', pick: 'c1', measure: '1 cup (244g)', count: 1, question: 'Whole milk or 2%?' }),
        item({ said: 'a banana', pick: 'c2', measure: '1 medium (118g)', count: 1 }),
      ],
    });
    const p = await previewDescribedMeal(USER, 'milk and a banana', 'breakfast', d);
    expect(p.items).toHaveLength(2);
    // No number, no link, no `said`: nothing for the confirm to price from or the memory to learn.
    // `asked_about` is what the answer is re-read with (food-described-answer.ts), not `said`.
    expect(p.items[0]).toEqual({ name: 'milk', basis: 'none', question: 'Whole milk or 2%?', asked_about: 'milk' });
    expect(p.items[1]).toMatchObject({
      name: 'Banana, raw',
      food_id: 'f-banana',
      basis: 'record',
      qty: 1,
      unit: 'medium',
    });
    expect(p.macros?.kcal).toBeCloseTo(105, 0);
    expect(p.coach).toMatchObject({ reached: true, calls: 1 });
  });

  it('near-miss: the same pick without a question is priced, linked and counted', async () => {
    const { d } = deps({ reply: [item({ said: 'milk', pick: 'c1', measure: '1 cup (244g)', count: 1 })] });
    const p = await previewDescribedMeal(USER, 'milk', 'breakfast', d);
    expect(p.items[0]).toMatchObject({ name: 'Milk, 2%', food_id: 'f-milk', basis: 'record', qty: 1, unit: 'cup' });
    expect(p.items[0]?.est?.kcal).toBeCloseTo(122, 0);
    expect(p.macros?.kcal).toBeCloseTo(122, 0);
  });

  it('an estimate with a question is a question row too: the number is dropped, not shown', async () => {
    const { d } = deps({
      reply: [
        item({
          said: 'a parfait',
          name: 'yogurt parfait',
          question: 'The small or the large?',
          estimate: { kcal: 300, protein_g: 10 },
        }),
      ],
    });
    const p = await previewDescribedMeal(USER, 'a parfait', 'snack', d);
    expect(p.items[0]).toEqual({
      name: 'yogurt parfait',
      basis: 'none',
      question: 'The small or the large?',
      asked_about: 'a parfait',
    });
    expect(p.macros).toBeNull();
  });

  it('the answers she offered ride on the row as buttons, with their words for the part to re-read with', async () => {
    const { d } = deps({
      reply: [
        item({
          said: '2 cups milk',
          pick: 'c1',
          measure: '1 cup (244g)',
          count: 2,
          question: 'Whole milk, 2% or skim?',
          choices: ['Whole milk', '2%', 'Skim'],
        }),
      ],
    });
    const p = await previewDescribedMeal(USER, '2 cups milk', 'breakfast', d);
    // Still no number, no link, no `said`; the amount is kept in `asked_about`, not on the row.
    expect(p.items[0]).toEqual({
      name: 'milk',
      basis: 'none',
      question: 'Whole milk, 2% or skim?',
      choices: ['Whole milk', '2%', 'Skim'],
      asked_about: '2 cups milk',
    });
    expect(p.macros).toBeNull();
  });

  it("asked_about is the person's own words from the split, even when the model's echo dropped the amount", async () => {
    const { d } = deps({
      reply: [item({ said: 'milk', pick: 'c1', question: 'Whole milk or skim?', choices: ['Whole milk', 'Skim'] })],
    });
    const p = await previewDescribedMeal(USER, '2 cups milk', 'breakfast', d);
    // The echo said "milk"; the person said "2 cups milk", and that is what the answer is re-read with.
    expect(p.items[0]).toMatchObject({ question: 'Whole milk or skim?', asked_about: '2 cups milk' });
    expect(p.items[0]).not.toHaveProperty('said');
  });

  it('near-miss: when the model answers more items than there were parts, the echo is all there is to pair with', async () => {
    const { d } = deps({
      reply: [
        item({ said: 'milk', pick: 'c1', question: 'Whole milk or skim?', choices: ['Whole milk', 'Skim'] }),
        item({ said: 'sugar', name: 'sugar', estimate: { kcal: 16, protein_g: 0 } }),
      ],
    });
    const p = await previewDescribedMeal(USER, '2 cups milk', 'breakfast', d);
    expect(p.items[0]).toMatchObject({ asked_about: 'milk' });
  });

  it('near-miss: a question with no choices carries none, and a model that echoed no words leaves the name to re-read with', async () => {
    const { d } = deps({ reply: [item({ said: '', name: 'milk', question: 'How much?' })] });
    const p = await previewDescribedMeal(USER, 'milk', 'breakfast', d);
    expect(p.items[0]).toEqual({ name: 'milk', basis: 'none', question: 'How much?', asked_about: 'milk' });
    expect(p.items[0]).not.toHaveProperty('choices');
  });
});

describe("the photo reader's notes reach the call (owner 2026-11-01)", () => {
  it('ride as the notes variable when given, and are empty for words alone', async () => {
    const sent: string[] = [];
    const reply = JSON.stringify({
      items: [item({ said: 'milk', pick: 'c1', measure: '1 cup (244g)', count: 1 })],
      lookups: [],
    });
    const d: DescribedMealDeps = {
      ...deps().d,
      call: async (vars) => {
        sent.push(vars.notes);
        return reply;
      },
    };
    await previewDescribedMeal(USER, 'milk', 'breakfast', d, {
      notes: 'I cannot tell whether the milk is whole or skim.',
    });
    await previewDescribedMeal(USER, 'milk', 'breakfast', d);
    expect(sent).toEqual(['I cannot tell whether the milk is whole or skim.', '']);
  });
});

describe('a remembered part is settled once', () => {
  const lattePhrase = phraseKey('Starbucks venti latte');
  const memory = { [lattePhrase]: { phrase: lattePhrase, food_id: 'f-latte', qty: 1, unit: 'venti', uses: 3 } };

  it('the model is asked only about the pending words, and its row for the remembered part is dropped', async () => {
    const { d, calls } = deps({
      memory,
      // The model answers for the latte anyway (it was told only "a banana", but models do).
      reply: [
        item({ said: 'Starbucks venti latte', name: 'latte', estimate: { kcal: 190, protein_g: 12 } }),
        item({ said: 'a banana', pick: 'c1', measure: '1 medium (118g)', count: 1 }),
      ],
    });
    const p = await previewDescribedMeal(USER, 'Starbucks venti latte and a banana', 'breakfast', d);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.said).toBe('a banana');
    expect(calls[0]?.book).not.toContain('Latte');
    expect(p.items.map((i) => i.name)).toEqual(['Caffè Latte (Venti)', 'Banana, raw']);
    expect(p.items[0]).toMatchObject({ basis: 'remembered', food_id: 'f-latte', qty: 1, unit: 'venti' });
    expect(p.items[0]?.est?.kcal).toBeCloseTo(250, 0);
    expect(p.coach.checked[0]).toBe('Starbucks venti latte: picked before, no lookup needed');
  });

  it('with every part remembered there is no lookup and no call', async () => {
    const { d, calls } = deps({ memory });
    const p = await previewDescribedMeal(USER, 'Starbucks venti latte', 'drink', d);
    expect(calls).toHaveLength(0);
    expect(p.items).toHaveLength(1);
    expect(p.coach).toMatchObject({ reached: true, calls: 0 });
  });
});

describe('rememberedRows — the memory never skips a part it holds', () => {
  const row = (phrase: string, food_id: string, qty: number, unit: string | null): FoodPhraseRow => ({
    phrase,
    food_id,
    qty,
    unit,
    uses: 1,
  });
  const memoryOf = (...rows: FoodPhraseRow[]) => Object.fromEntries(rows.map((r) => [r.phrase, r]));

  it.each([
    // said → remembered as → the row's amount and calories
    ['2 eggs', row(phraseKey('2 eggs'), 'f-eggs', 1, 'large'), { qty: 2, unit: 'large', kcal: 144 }],
    [
      'a handful of almonds',
      row(phraseKey('a handful of almonds'), 'f-almonds', 28, 'g'),
      { qty: 28, unit: 'g', kcal: 162.1 },
    ],
    ['150 g chicken', row(phraseKey('150 g chicken'), 'f-chicken', 100, 'g'), { qty: 150, unit: 'g', kcal: 247.5 }],
    ['chicken', row(phraseKey('chicken'), 'f-chicken', 100, 'g'), { qty: 100, unit: 'g', kcal: 165 }],
  ])('%j → %j', async (said, remembered, want) => {
    const { d } = deps({ memory: memoryOf(remembered) });
    const rows = await rememberedRows(partsToLookups(said), USER, d);
    expect(rows.size).toBe(1);
    expect(rows.get(0)).toMatchObject({ qty: want.qty, unit: want.unit, basis: 'remembered', said });
    expect(rows.get(0)?.est?.kcal).toBeCloseTo(want.kcal, 0);
  });

  it('near-miss: a remembered row with no unit and a bare said count is not priced — the part goes to the model', async () => {
    // The store refuses a bare count above one of an unnamed default (the "3 shallots → 300 g"
    // rule in food-pricing-portion.ts). A row confirmed without a unit was priced by the parse,
    // not the store, so the memory cannot price it now either; both tries fail and the part is
    // looked up and asked like any other. Pinned so the skip is a known rule, not a surprise.
    const { d } = deps({ memory: memoryOf(row(phraseKey('2 almonds'), 'f-almonds', 2, null)) });
    expect((await rememberedRows(partsToLookups('2 almonds'), USER, d)).size).toBe(0);
  });

  it('near-miss: words the memory does not hold are not rows', async () => {
    const { d } = deps({ memory: memoryOf(row(phraseKey('chicken'), 'f-chicken', 100, 'g')) });
    expect((await rememberedRows(partsToLookups('a banana'), USER, d)).size).toBe(0);
  });

  it('saidPortion: a weight or volume carries its unit, a noun its noun, a bare count none', () => {
    expect(saidPortion('150 g')).toEqual({ qty: 150, unit: 'g' });
    expect(saidPortion('1 cup')).toEqual({ qty: 1, unit: 'cup' });
    expect(saidPortion('a handful')).toEqual({ qty: 1, unit: 'handful' });
    expect(saidPortion('2')).toEqual({ qty: 2 });
    // The parser reads nothing as one of something: the remembered unit fills it in.
    expect(saidPortion('')).toEqual({ qty: 1 });
  });
});

describe('the slot: the hint, else the words, else other — on both paths', () => {
  const pick = item({ said: 'a banana', pick: 'c1', measure: '1 medium (118g)', count: 1 });

  it('words that name a slot file the meal there when no hint is given (reached), and the phrase is not looked up', async () => {
    const { d, calls } = deps({ reply: [pick] });
    const p = await previewDescribedMeal(USER, 'a banana for breakfast', undefined, d);
    expect(p.meal).toBe('breakfast');
    expect(p.coach.reached).toBe(true);
    expect(calls[0]?.said).toBe('a banana');
    expect(p.items[0]).toMatchObject({ name: 'Banana, raw', food_id: 'f-banana', said: 'a banana' });
    expect(p.raw_text).toBe('a banana for breakfast');
  });

  it('the fallback files it under the same slot and is told it — never its own guess', async () => {
    // The old parse-meal path would say "other" here; the words say breakfast and that wins.
    const { d } = deps({ call: async () => Promise.reject(new Error('503')) });
    const p = await previewDescribedMeal(USER, 'a banana for breakfast', undefined, d);
    // The slot phrase is not food: the fallback reads the words without it, under that slot.
    expect(d.fallback).toHaveBeenCalledWith('a banana', 'breakfast');
    expect(p.meal).toBe('breakfast');
    expect(p.coach.reached).toBe(false);
  });

  it('the hint wins over the words', async () => {
    const { d } = deps({ reply: [pick] });
    const p = await previewDescribedMeal(USER, 'a banana for breakfast', 'snack', d);
    expect(p.meal).toBe('snack');
  });

  it('near-miss: words that name no slot, and no hint, file under other on both paths', async () => {
    const { d } = deps({ reply: [pick] });
    expect((await previewDescribedMeal(USER, 'a banana', undefined, d)).meal).toBe('other');
    const { d: down } = deps({ call: async () => Promise.reject(new Error('503')) });
    expect((await previewDescribedMeal(USER, 'a breakfast bar', undefined, down)).meal).toBe('other');
    expect(down.fallback).toHaveBeenCalledWith('a breakfast bar', 'other');
  });
});

describe('parts the split did not read ride on the preview', () => {
  it('names the parts past the cap and a part said twice; nothing when all were read', async () => {
    const twelve = Array.from({ length: 12 }, (_, i) => `food${i + 1}`).join(', ');
    const { d } = deps({ reply: [], call: async () => Promise.reject(new Error('503')) });
    const p = await previewDescribedMeal(USER, twelve, 'lunch', d);
    expect(p.coach.not_read).toEqual([
      '"food11" not read — the read takes at most 10 parts',
      '"food12" not read — the read takes at most 10 parts',
    ]);
    const { d: twice } = deps({
      reply: [item({ said: 'a banana', pick: 'c1', measure: '1 medium (118g)', count: 1 })],
    });
    expect((await previewDescribedMeal(USER, 'a banana, a banana', 'snack', twice)).coach.not_read).toEqual([
      '"banana" said twice, read once',
    ]);
    expect((await previewDescribedMeal(USER, 'a banana', 'snack', twice)).coach.not_read).toEqual([]);
  });
});

describe('when she cannot be reached', () => {
  it('the fallback prices the pending words, every row labelled, and the trace does not repeat the notice', async () => {
    const { d } = deps({ call: async () => Promise.reject(new Error('503 from the provider')) });
    const p = await previewDescribedMeal(USER, 'milk and a banana', 'breakfast', d);
    expect(d.fallback).toHaveBeenCalledWith('milk, a banana', 'breakfast');
    expect(p.coach.reached).toBe(false);
    expect(p.items.every((i) => i.basis === 'fallback' && i.source_label === 'an automatic estimate')).toBe(true);
    expect(p.coach.checked.join('\n')).not.toContain('could not be reached');
    expect(p.coach.checked).toHaveLength(2);
  });

  it('a reply that is not JSON is the same outage', async () => {
    const { d } = deps({ call: async () => 'I think it was a banana.' });
    const p = await previewDescribedMeal(USER, 'a banana', 'snack', d);
    expect(p.coach.reached).toBe(false);
    expect(d.fallback).toHaveBeenCalledTimes(1);
  });

  it('a pick the book cannot honour after the last call is an open row that says why', async () => {
    const { d, calls } = deps({
      reply: [item({ said: 'a banana', pick: 'c9', measure: '1 medium (118g)', count: 1 })],
    });
    const p = await previewDescribedMeal(USER, 'a banana', 'snack', d);
    expect(calls).toHaveLength(2);
    expect(p.items[0]).toMatchObject({ basis: 'none', problem: expect.stringMatching(/not an id in the book/) });
    expect(p.coach.reached).toBe(true);
  });
});

describe('traceLines — one line per part, from what ran', () => {
  it('names each rung by its outcome; a skipped rung says skipped, never its reason', () => {
    const book = new CandidateBook();
    book.add({ q: 'banana', measure: null, brand: null }, fanOut('banana'));
    book.add({ q: 'zzq', measure: null, brand: null }, fanOut('zzq'));
    const lines = traceLines(book, partsToLookups('Starbucks venti latte'));
    expect(lines).toEqual([
      'Starbucks venti latte: picked before, no lookup needed',
      'banana: your foods: 1 rows · USDA skipped · FatSecret failed',
      'zzq: your foods: no match · USDA skipped · FatSecret failed',
    ]);
  });
});
