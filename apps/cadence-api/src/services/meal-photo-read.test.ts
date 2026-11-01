/**
 * The photo door's read through the described-meal seam (`DescribedMealDeps`): every source
 * faked, nothing on the network. What these pin (FOOD-LOGGING-COACH-LED.md, build step 4):
 *
 *   - a reading's last block is its list, and a two-line list is two parts: two rows, two trace
 *     lines, the same numbers typing those words would give;
 *   - the notes above the list are for the person — shown, logged, never looked up;
 *   - a question row carries no number and no link, exactly as on the typed door;
 *   - when she cannot be reached the fallback prices the list, labelled, and the card is told;
 *   - an empty reading reads the caption; nothing at all is a loud error, not an empty card;
 *   - the markdown a model leaves ("***", "**bold**", bullets) comes off and the words stay.
 */
import { describe, expect, it, vi } from 'vitest';
import type { Food } from '@cadence/shared';

vi.mock('../ai/aim.ts', () => ({ runJobBySlug: vi.fn() }));
vi.mock('../repos/foods.ts', () => ({ getFoodsByIds: vi.fn(async () => []) }));
vi.mock('../repos/food-phrases.ts', () => ({ recallFoodPhrases: vi.fn(), rememberFoodPhrase: vi.fn() }));
vi.mock('../repos/nutrition.ts', () => ({ insertNutritionLog: vi.fn() }));
vi.mock('./ai-log.ts', () => ({ logAi: vi.fn() }));
vi.mock('./meal-photos.ts', () => ({ putMealPhoto: vi.fn(), signMealPhotoUrl: vi.fn() }));
vi.mock('./nutrition.ts', () => ({ tickFoodLogOccurrence: vi.fn() }));
vi.mock('./food-candidate-sources.ts', () => ({ wideLookup: () => async () => ({}) }));
vi.mock('./food-pricing.ts', async (orig) => {
  const actual = await orig<typeof import('./food-pricing.ts')>();
  return { ...actual, priceParsedMeal: vi.fn() };
});

import type { FanOutResult } from './food-source-fanout.ts';
import type { SourceCandidate } from './food-source-report.ts';
import { partsToLookups } from './food-candidate-book.ts';
import { previewDescribedMeal, type DescribedMealDeps } from './food-described-meal.ts';
import { PHOTO_WORDS_MAX, plainReading, previewMealFromReading, readingWords } from './meal-photo-read.ts';

const USER = '00000000-0000-4000-a000-00000000d004';

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
const latte = food({
  food_id: 'f-latte',
  owner_user_id: USER,
  name: 'Caffè Latte (Venti)',
  brand: 'Starbucks',
  source: 'fatsecret',
  macros_per_base: { kcal: 42.3, protein_g: 2.7 },
  servings: [{ label: '1 venti', unit: 'venti', amount_g: 591 }],
});
const FOODS = [banana, latte];

function asCandidate(f: Food): SourceCandidate {
  const s = f.servings[0]!;
  return {
    source: f.source === 'usda' ? 'usda' : 'fatsecret',
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
  banana: [banana],
  'venti Starbucks latte': [latte],
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

function deps(over: Partial<DescribedMealDeps> & { reply?: Reply } = {}) {
  const calls: Array<{ said: string; book: string }> = [];
  const logs: Array<{ input: unknown; output: unknown; meta: unknown }> = [];
  const d: DescribedMealDeps = {
    lookup: async (l) => fanOut(l.q),
    call: async (vars) => {
      calls.push({ said: vars.said, book: vars.book });
      return JSON.stringify({ items: over.reply ?? [], lookups: [] });
    },
    foods: async (ids) => FOODS.filter((f) => ids.includes(f.food_id)),
    recall: async () => new Map(),
    fallback: vi.fn(async (text: string) => ({
      meal: 'other' as const,
      items: text.split(', ').map((name) => ({ name, qty: 1, unit: 'serving', est: { kcal: 10 } })),
      macros: { kcal: 10 },
      confidence: 0.5,
      flags: {},
      raw_text: text,
    })),
    log: (e) => void logs.push(e),
    ...over,
  };
  return { d, calls, logs };
}

/** The reading as the job is asked to write it: sentences for the person, a blank line, the list. */
const READING = [
  'A tall paper cup with a Starbucks sleeve, a venti by its height against the hand, and a banana beside it.',
  'I cannot tell whether the milk is whole or skim.',
  '',
  '1 venti Starbucks latte',
  '1 medium banana',
].join('\n');

const TWO_PICKS: Reply = [
  item({ said: '1 venti Starbucks latte', pick: 'c1', measure: '1 venti', count: 1 }),
  item({ said: '1 medium banana', pick: 'c2', measure: '1 medium (118g)', count: 1 }),
];

describe('a photographed latte and banana read like a typed one', () => {
  it('two list lines → two rows with the same numbers, a trace line per part, the coach reached', async () => {
    const { d, calls, logs } = deps({ reply: TWO_PICKS });
    const p = await previewMealFromReading(USER, { reading: READING, meal: 'breakfast' }, d);

    expect(p.items).toHaveLength(2);
    expect(p.items[0]).toMatchObject({
      name: 'Caffè Latte (Venti)',
      food_id: 'f-latte',
      basis: 'record',
      qty: 1,
      unit: 'venti',
      said: '1 venti Starbucks latte',
    });
    expect(p.items[1]).toMatchObject({
      name: 'Banana, raw',
      food_id: 'f-banana',
      basis: 'record',
      qty: 1,
      unit: 'medium',
      said: '1 medium banana',
    });
    expect(p.items[0]?.est?.kcal).toBeCloseTo(250, 0);
    expect(p.items[1]?.est?.kcal).toBeCloseTo(105, 0);
    expect(p.macros?.kcal).toBeCloseTo(355, 0);
    expect(p.coach).toMatchObject({ reached: true, calls: 1 });
    expect(p.coach.checked).toEqual([
      'venti Starbucks latte: your foods: 1 rows · USDA skipped',
      'banana: your foods: 1 rows · USDA skipped',
    ]);
    // The model is asked the list's words only, and the notes above the list never reach a lookup.
    expect(calls).toHaveLength(1);
    expect(calls[0]?.said).toBe('1 venti Starbucks latte, 1 medium banana');
    expect(calls[0]?.book).not.toContain('paper cup');
    // What was read is what the card calls their words, so a chip answer scales from it.
    expect(p.raw_text).toBe('1 venti Starbucks latte\n1 medium banana');
    // The log row is the typed path's, marked as the photo door's, with the notes for later.
    expect(logs).toHaveLength(1);
    expect(logs[0]?.meta).toMatchObject({ photo: true, reached: true, parts: 2 });
    expect((logs[0]?.meta as { notes: string }).notes).toContain('whole or skim');
  });

  it('is the same read as typing the list: rows, trace and numbers match previewDescribedMeal', async () => {
    const photo = await previewMealFromReading(
      USER,
      { reading: READING, meal: 'breakfast' },
      deps({ reply: TWO_PICKS }).d,
    );
    const typed = await previewDescribedMeal(
      USER,
      '1 venti Starbucks latte\n1 medium banana',
      'breakfast',
      deps({ reply: TWO_PICKS }).d,
    );
    expect(photo.items).toEqual(typed.items);
    expect(photo.coach).toEqual(typed.coach);
    expect(photo.macros).toEqual(typed.macros);
  });

  it('a question row carries no number, no link and no words, as on the typed door', async () => {
    const { d } = deps({
      reply: [
        item({
          said: '1 venti Starbucks latte',
          pick: 'c1',
          measure: '1 venti',
          count: 1,
          question: 'Whole milk or skim?',
        }),
        item({ said: '1 medium banana', pick: 'c2', measure: '1 medium (118g)', count: 1 }),
      ],
    });
    const p = await previewMealFromReading(USER, { reading: READING, meal: 'breakfast' }, d);
    expect(p.items[0]).toEqual({ name: 'venti Starbucks latte', basis: 'none', question: 'Whole milk or skim?' });
    expect(p.macros?.kcal).toBeCloseTo(105, 0);
  });

  it('when she cannot be reached, the fallback prices the list, labelled, and the card is told', async () => {
    const { d } = deps({ call: async () => Promise.reject(new Error('503 from the provider')) });
    const p = await previewMealFromReading(USER, { reading: READING, meal: 'breakfast' }, d);
    expect(d.fallback).toHaveBeenCalledWith('1 venti Starbucks latte, 1 medium banana', 'breakfast');
    expect(p.coach.reached).toBe(false);
    expect(p.items).toHaveLength(2);
    expect(p.items.every((i) => i.basis === 'fallback' && i.source_label === 'an automatic estimate')).toBe(true);
  });

  it('an empty reading reads the caption (the read failed, they went on from their words)', async () => {
    const { d, calls } = deps({
      reply: [item({ said: 'a banana', pick: 'c1', measure: '1 medium (118g)', count: 1 })],
    });
    const p = await previewMealFromReading(USER, { reading: '', caption: 'a banana', meal: 'snack' }, d);
    expect(calls[0]?.said).toBe('a banana');
    expect(p.items[0]).toMatchObject({ name: 'Banana, raw', basis: 'record' });
    expect(p.raw_text).toBe('a banana');
  });

  it('nothing at all is a loud error, never an empty card', async () => {
    await expect(previewMealFromReading(USER, { reading: '  ', caption: ' ' }, deps().d)).rejects.toThrow(
      /a meal needs/,
    );
  });

  it("the list is read past the typed path's 500 characters, up to its own cap", async () => {
    const lines = Array.from({ length: 10 }, (_, i) => `1 medium banana ${'x'.repeat(50)} ${i}`);
    const { words } = readingWords(lines.join('\n'));
    expect(words.length).toBeGreaterThan(500);
    expect(words.length).toBeLessThan(PHOTO_WORDS_MAX);
    expect(partsToLookups(words)).toHaveLength(10);
  });
});

describe('readingWords — the last block is the list, the rest is for the person', () => {
  it.each([
    ['sentences, a blank line, the list', READING, '1 venti Starbucks latte\n1 medium banana', /paper cup/],
    [
      'a list alone (no blank line) is all list',
      '1 venti Starbucks latte\n1 medium banana',
      '1 venti Starbucks latte\n1 medium banana',
      /^$/,
    ],
    ['one line is one part', 'a banana', 'a banana', /^$/],
    [
      'several note paragraphs keep their order',
      'What I see.\n\nWhat I cannot tell.\n\n2 fried eggs',
      '2 fried eggs',
      /^What I see\.\n\nWhat I cannot tell\.$/,
    ],
    ['blank lines with spaces still separate blocks', 'Notes.\n   \n1 banana', '1 banana', /^Notes\.$/],
    ['Windows line ends read the same', 'Notes.\r\n\r\n1 banana\r\n2 eggs', '1 banana\n2 eggs', /^Notes\.$/],
  ])('%s', (_, reading, words, notes) => {
    const out = readingWords(reading);
    expect(out.words).toBe(words);
    expect(out.notes).toMatch(notes);
  });

  it("caps the list at the split's own MAX_PARTS, never more", () => {
    const lines = Array.from({ length: 14 }, (_, i) => `${i + 1} g food${i}`);
    expect(readingWords(lines.join('\n')).words.split('\n')).toHaveLength(10);
  });

  it('with no reading the caption is the words; with neither there are none', () => {
    expect(readingWords('', ' a small latte ')).toEqual({ words: 'a small latte', notes: '' });
    expect(readingWords('', '')).toEqual({ words: '', notes: '' });
    expect(readingWords('   \n\n  ')).toEqual({ words: '', notes: '' });
  });
});

describe('plainReading — the marks come off, the words stay', () => {
  it.each([
    ['bold heading', '**Compact Summary for Data Entry:**', 'Compact Summary for Data Entry:'],
    ['a rule line goes', 'Notes.\n***\n1 banana', 'Notes.\n1 banana'],
    ['a dashed rule goes', 'Notes.\n---\n1 banana', 'Notes.\n1 banana'],
    [
      'bullets',
      '* Mozzarella cheese, full-fat (~40 g)\n- 2 eggs\n• 1 slice bread',
      'Mozzarella cheese, full-fat (~40 g)\n2 eggs\n1 slice bread',
    ],
    ['numbering', '1. 2 fried eggs\n2) 1 slice toast', '2 fried eggs\n1 slice toast'],
    ['a decimal amount is not numbering', '1.5 cups rice', '1.5 cups rice'],
    ['heading marks', '## What I see\nA plate.', 'What I see\nA plate.'],
    ['italics', 'the milk is *probably* whole, _assume_ 2%', 'the milk is probably whole, assume 2%'],
    ['bold inside a line', 'a **venti** latte', 'a venti latte'],
    ['code marks', 'about `250 ml`', 'about 250 ml'],
    ['an asterisk in words stays', '1 cup 2% milk (approx*)', '1 cup 2% milk (approx*)'],
    ['plain text is untouched', READING, READING],
  ])('%s', (_, raw, plain) => {
    expect(plainReading(raw)).toBe(plain);
  });
});
