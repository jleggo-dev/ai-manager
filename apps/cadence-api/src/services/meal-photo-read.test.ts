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
 *   - the list is read by SHAPE from the bottom (review of #457): a closing sentence after it, a
 *     heading inside it, prose left in when the blank line is deleted, the old prompt's shape —
 *     each is reported as not read, never silently looked up or silently dropped; so are the
 *     lines the caps leave out;
 *   - the markdown a model leaves ("***", "**bold**", bullets) comes off and the words stay, and
 *     the RAW text is what the log keeps;
 *   - a photo_ref that is not this person's is refused; `said` is capped where the key is made.
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
import { runJobBySlug } from '../ai/aim.ts';
import { logAi } from './ai-log.ts';
import { partsToLookups, SAID_MAX } from './food-candidate-book.ts';
import { previewDescribedMeal, type DescribedMealDeps } from './food-described-meal.ts';
import { rememberedRows } from './food-described-rows.ts';
import { phraseKey } from './food-phrases.ts';
import {
  NOTES_MAX,
  PHOTO_WORDS_MAX,
  isFoodLine,
  logMealFromReading,
  plainReading,
  previewMealFromReading,
  readMealPhoto,
  readingWords,
} from './meal-photo-read.ts';
import { putMealPhoto, signMealPhotoUrl } from './meal-photos.ts';
import { assertOwnPhotoRef } from './photo-validate.ts';

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
  const calls: Array<{ said: string; book: string; notes: string }> = [];
  const logs: Array<{ input: unknown; output: unknown; meta: unknown }> = [];
  const d: DescribedMealDeps = {
    lookup: async (l) => fanOut(l.q),
    call: async (vars) => {
      calls.push({ said: vars.said, book: vars.book, notes: vars.notes });
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
    // The model is asked the list's words only; the notes above the list never reach a lookup, and
    // reach the call as its `notes` (owner 2026-11-01: a doubt there is her reason to ask).
    expect(calls).toHaveLength(1);
    expect(calls[0]?.said).toBe('1 venti Starbucks latte, 1 medium banana');
    expect(calls[0]?.book).not.toContain('paper cup');
    expect(calls[0]?.notes).toBe(
      'A tall paper cup with a Starbucks sleeve, a venti by its height against the hand, and a banana beside it.\nI cannot tell whether the milk is whole or skim.',
    );
    // What was read is what the card calls their words, so a chip answer scales from it.
    expect(p.raw_text).toBe('1 venti Starbucks latte\n1 medium banana');
    // The log row is the typed path's, marked as the photo door's, with the notes for later.
    expect(logs).toHaveLength(1);
    expect(logs[0]?.meta).toMatchObject({ photo: true, reached: true, parts: 2, notes_cut: false, lines_not_read: [] });
    expect((logs[0]?.meta as { notes: string }).notes).toContain('whole or skim');
    expect(p.coach.not_read).toEqual([]);
  });

  it('is the same read as typing the list: rows, trace and numbers match previewDescribedMeal', async () => {
    const photo = await previewMealFromReading(
      USER,
      { reading: READING, meal: 'breakfast' },
      deps({ reply: TWO_PICKS }).d,
    );
    // The typed path given the same notes — the one thing the photo door adds to the call.
    const typed = await previewDescribedMeal(
      USER,
      '1 venti Starbucks latte\n1 medium banana',
      'breakfast',
      deps({ reply: TWO_PICKS }).d,
      {
        notes: readingWords(READING).notes,
      },
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
    // No number, no link, no `said`; `asked_about` is the line the answer is re-read with (the buttons).
    expect(p.items[0]).toEqual({
      name: 'venti Starbucks latte',
      basis: 'none',
      question: 'Whole milk or skim?',
      asked_about: '1 venti Starbucks latte',
    });
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
    const { words, not_read } = readingWords(lines.join('\n'));
    expect(words.length).toBeGreaterThan(500);
    expect(words.length).toBeLessThan(PHOTO_WORDS_MAX);
    expect(partsToLookups(words)).toHaveLength(10);
    expect(not_read).toEqual([]);
  });

  it('lines that were not read ride on the coach block for the card, and on the log row', async () => {
    const { d, calls, logs } = deps({ reply: TWO_PICKS });
    const reading = `${READING}\n\nLet me know if you'd like any changes.`;
    const p = await previewMealFromReading(USER, { reading, meal: 'breakfast' }, d);
    expect(p.items).toHaveLength(2);
    // On the coach block, beside the split's own (none here), so the card says it all in one place.
    expect(p.coach.not_read).toEqual(["Let me know if you'd like any changes."]);
    expect(calls[0]?.said).toBe('1 venti Starbucks latte, 1 medium banana');
    expect(logs[0]?.meta).toMatchObject({ lines_not_read: ["Let me know if you'd like any changes."], not_read: 0 });
  });

  it("the split's own not-read lines and the reading's sit together on the coach block", async () => {
    const lines = Array.from({ length: 11 }, (_, i) => `${i + 1} g food${i}`);
    const p = await previewMealFromReading(USER, { reading: `Notes.\n\n${lines.join('\n')}\nThanks!` }, deps().d);
    // The reading's cap (MAX_PARTS lines) reports the eleventh; the sign-off is reported too.
    expect(p.coach.not_read).toEqual(['Thanks!', '11 g food10']);
  });

  it("the eyes' notes go to the call whole up to NOTES_MAX; a cut is said in the trace", async () => {
    const long = 'I cannot tell whether the milk is whole or skim. '.repeat(20).trim();
    expect(long.length).toBeGreaterThan(NOTES_MAX);
    const { d, calls, logs } = deps({ reply: TWO_PICKS });
    const p = await previewMealFromReading(USER, { reading: `${long}\n\n1 venti Starbucks latte\n1 medium banana` }, d);
    expect(calls[0]?.notes).toBe(long.slice(0, NOTES_MAX));
    expect(p.coach.checked.at(-1)).toBe(
      `the photo's notes: the first ${NOTES_MAX} characters went to the coach, the rest did not`,
    );
    expect(logs[0]?.meta).toMatchObject({ notes_cut: true });
    // Near-miss: short notes, no such line.
    const short = await previewMealFromReading(USER, { reading: READING }, deps({ reply: TWO_PICKS }).d);
    expect(short.coach.checked.join('\n')).not.toContain("the photo's notes");
  });

  it('prose with no line that reads as a food, and no caption, is a loud error that says the shape', async () => {
    await expect(
      previewMealFromReading(USER, { reading: 'A plate of something. I cannot tell what.' }, deps().d),
    ).rejects.toThrow(/a meal needs a line that reads as a food/);
  });
});

describe("the words ride back within the confirm's cap", () => {
  it('a part longer than SAID_MAX is read as its first 200 characters, and the memory key matches', async () => {
    // No separator word in it, so the split keeps it as one part (a sentence, not a food).
    const long = `1 medium banana ${'from the market stall near work '.repeat(8)}`.trim();
    expect(long.length).toBeGreaterThan(SAID_MAX);
    const lookups = partsToLookups(long);
    expect(lookups[0]?.said).toHaveLength(SAID_MAX);
    // The memory is asked with the key of the capped words — the same key the confirm teaches.
    const asked: string[][] = [];
    const { d } = deps({
      recall: async (keys) => {
        asked.push(keys);
        return new Map([
          [phraseKey(long.slice(0, SAID_MAX)), { phrase: 'p', food_id: 'f-banana', qty: 1, unit: 'medium', uses: 1 }],
        ]);
      },
    });
    const rows = await rememberedRows(lookups, USER, d);
    expect(asked[0]).toEqual([phraseKey(long.slice(0, SAID_MAX))]);
    expect(rows.get(0)?.said).toHaveLength(SAID_MAX);
  });
});

describe("assertOwnPhotoRef — a photo_ref is this person's own or it is refused", () => {
  it.each([
    [`${USER}/2026-11-01/p.jpg`, true],
    [`${USER}/gym/p.jpg`, true],
    ['00000000-0000-4000-a000-00000000d999/2026-11-01/p.jpg', false],
    [`coach-attachments/${USER}/p.jpg`, false],
    ['p.jpg', false],
    [`${USER}`, false],
  ])('%s → %s', (ref, ok) => {
    if (ok) expect(() => assertOwnPhotoRef(USER, ref)).not.toThrow();
    else expect(() => assertOwnPhotoRef(USER, ref)).toThrow(/invalid photo/);
  });

  it('the old one-call write refuses it before anything is parsed or written', async () => {
    vi.mocked(runJobBySlug).mockClear();
    await expect(
      logMealFromReading(USER, { photo_ref: 'someone-else/2026-11-01/p.jpg', reading: '1 banana' }),
    ).rejects.toThrow(/invalid photo/);
    expect(runJobBySlug).not.toHaveBeenCalled();
  });
});

describe('readMealPhoto — the log keeps the raw text, the box gets it plain', () => {
  it('a reading with markdown is logged as written, flagged, and returned stripped', async () => {
    vi.mocked(putMealPhoto).mockResolvedValue(`${USER}/2026-11-01/p.jpg`);
    vi.mocked(signMealPhotoUrl).mockResolvedValue('https://signed');
    const raw = 'A plate.\n\n**Compact Summary for Data Entry:**\n* 2 fried eggs\n* 1 slice toast';
    vi.mocked(runJobBySlug).mockResolvedValue({ formatted: raw } as never);
    const out = await readMealPhoto(USER, { photo: 'data:image/jpeg;base64,xxx' });
    expect(out.reading).toBe('A plate.\n\nCompact Summary for Data Entry:\n2 fried eggs\n1 slice toast');
    const entry = vi.mocked(logAi).mock.calls.at(-1)?.[1] as {
      output: { raw: string };
      meta: { markdown_stripped: boolean };
    };
    expect(entry.output.raw).toBe(raw);
    expect(entry.meta.markdown_stripped).toBe(true);
  });

  it('near-miss: plain text is logged unflagged', async () => {
    vi.mocked(putMealPhoto).mockResolvedValue(`${USER}/2026-11-01/p.jpg`);
    vi.mocked(signMealPhotoUrl).mockResolvedValue('https://signed');
    vi.mocked(runJobBySlug).mockResolvedValue({ formatted: READING } as never);
    const out = await readMealPhoto(USER, { photo: 'data:image/jpeg;base64,xxx' });
    expect(out.reading).toBe(READING);
    const entry = vi.mocked(logAi).mock.calls.at(-1)?.[1] as { meta: { markdown_stripped: boolean } };
    expect(entry.meta.markdown_stripped).toBe(false);
  });
});

describe('isFoodLine — a line of the list, or a sentence', () => {
  it.each([
    ['1 venti Starbucks latte', true],
    ['150 g chicken breast', true],
    ['half a banana', true],
    ['a banana', true],
    ['two eggs', true],
    ['some bread', true],
    ['1 medium banana.', true],
    ['a cup of yogurt', true],
    ['A cup.', false],
    ['1 cup', false],
    ['A tall cup with a Starbucks sleeve, a venti by its height, and a banana beside it.', false],
    ['I cannot tell whether the milk is whole or skim.', false],
    ['Compact Summary for Data Entry:', false],
    ["Let me know if you'd like changes.", false],
    ['What I see', false],
    ['banana', false],
    ['', false],
  ])('%j → %s', (line, want) => {
    expect(isFoodLine(line)).toBe(want);
  });
});

describe('readingWords — the list by shape, from the bottom; what is not read is said', () => {
  const LIST = '1 venti Starbucks latte\n1 medium banana';
  it.each([
    ['sentences, a blank line, the list', READING, LIST, /paper cup/, []],
    ['a list alone is all list', LIST, LIST, /^$/, []],
    ['one line is one part', 'a banana', 'a banana', /^$/, []],
    [
      'a closing sentence after the list is not read, and said so — the list stays the list',
      `${READING}\n\nLet me know if you'd like changes.`,
      LIST,
      /paper cup/,
      ["Let me know if you'd like changes."],
    ],
    [
      'the blank line deleted by hand: the prose left in is reported, the foods are still read',
      'A tall cup and a banana beside it.\n1 venti Starbucks latte\n1 medium banana',
      LIST,
      /^$/,
      ['A tall cup and a banana beside it.'],
    ],
    [
      "the old prompt's shape: prose, a heading, bullets — the heading is reported, the foods read",
      'A plate of eggs.\n\n**Compact Summary for Data Entry:**\n* 2 fried eggs\n* 1 slice toast',
      '2 fried eggs\n1 slice toast',
      /^A plate of eggs\.$/,
      ['Compact Summary for Data Entry:'],
    ],
    [
      "the old prompt's shape with a food line that carries no amount: that line is reported, not guessed",
      'A pizza.\n\n**Compact Summary for Data Entry:**\n* Mozzarella cheese, full-fat, baked (~40-50g)\n* 2 slices crust',
      '2 slices crust',
      /^A pizza\.$/,
      ['Compact Summary for Data Entry:', 'Mozzarella cheese, full-fat, baked (~40-50g)'],
    ],
    [
      'prose only: nothing reads as a food, every line is reported, no notes',
      'A plate of something.\nI cannot tell what.',
      '',
      /^$/,
      ['A plate of something.', 'I cannot tell what.'],
    ],
    [
      'several note paragraphs keep their order',
      'What I see.\n\nWhat I cannot tell.\n\n2 fried eggs',
      '2 fried eggs',
      /^What I see\.\n\nWhat I cannot tell\.$/,
      [],
    ],
    [
      'a blank line between two food lines does not end the list: both are read',
      'Notes.\n\n1 venti Starbucks latte\n\n1 medium banana',
      LIST,
      /^Notes\.$/,
      [],
    ],
    [
      'a non-food line between two food lines, in the same block, is reported and both foods are read',
      'Notes.\n\n1 venti Starbucks latte\nabout the size of a mug\n1 medium banana',
      LIST,
      /^Notes\.$/,
      ['about the size of a mug'],
    ],
    [
      'a non-food block above a food line that a blank separates is notes, not a stray',
      'A cup.\nA banana beside it.\n\n1 venti Starbucks latte\n1 medium banana',
      LIST,
      /^A cup\.\nA banana beside it\.$/,
      [],
    ],
    ['blank lines with spaces still separate blocks', 'Notes.\n   \n1 banana', '1 banana', /^Notes\.$/, []],
    ['Windows line ends read the same', 'Notes.\r\n\r\n1 banana\r\n2 eggs', '1 banana\n2 eggs', /^Notes\.$/, []],
  ])('%s', (_, reading, words, notes, notRead) => {
    const out = readingWords(reading);
    expect(out.words).toBe(words);
    expect(out.notes).toMatch(notes);
    expect(out.not_read).toEqual(notRead);
  });

  it('the caps say what they left out: lines past MAX_PARTS, then lines past the budget, from the end', () => {
    const lines = Array.from({ length: 14 }, (_, i) => `${i + 1} g food${i}`);
    const many = readingWords(lines.join('\n'));
    expect(many.words.split('\n')).toHaveLength(10);
    expect(many.not_read).toEqual(lines.slice(10));

    const wide = Array.from({ length: 8 }, (_, i) => `1 cup ${'x'.repeat(140)} ${i}`);
    const budget = readingWords(wide.join('\n'));
    expect(budget.words.length).toBeLessThanOrEqual(PHOTO_WORDS_MAX);
    expect(budget.words.split('\n')).toHaveLength(6);
    expect(budget.not_read).toEqual(wide.slice(6));
    // Never cut mid-word: every line read is a whole line.
    expect(budget.words.split('\n').every((l) => wide.includes(l))).toBe(true);
  });

  it('a lone list line longer than the budget is reported, never cut mid-word downstream', () => {
    const long = `1 cup ${'x'.repeat(PHOTO_WORDS_MAX)}`;
    expect(readingWords(long, 'a banana')).toEqual({ words: 'a banana', notes: '', not_read: [long] });
    // Near-miss: a long line beside a short one — the long one goes, the short one is read.
    const two = readingWords(`${long}\n1 medium banana`);
    expect(two.words).toBe('1 medium banana');
    expect(two.not_read).toEqual([long]);
  });

  it('with no reading the caption is the words; with neither there are none', () => {
    expect(readingWords('', ' a small latte ')).toEqual({ words: 'a small latte', notes: '', not_read: [] });
    expect(readingWords('', '')).toEqual({ words: '', notes: '', not_read: [] });
    expect(readingWords('   \n\n  ')).toEqual({ words: '', notes: '', not_read: [] });
  });
});

describe('plainReading — the marks come off, the words stay', () => {
  it.each([
    ['bold heading', '**Compact Summary for Data Entry:**', 'Compact Summary for Data Entry:'],
    ['a rule line goes', 'Notes.\n***\n1 banana', 'Notes.\n1 banana'],
    ['a dashed rule goes', 'Notes.\n---\n1 banana', 'Notes.\n1 banana'],
    ['a spaced rule goes too, and does not split the list', '1 banana\n* * *\n2 eggs', '1 banana\n2 eggs'],
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
