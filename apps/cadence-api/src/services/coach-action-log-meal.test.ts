import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Food, NutritionLog } from '@cadence/shared';

/**
 * `log_meal` through the described-meal seam (`DescribedMealDeps`): the SAME read `preview_meal`
 * runs, every source faked and nothing on the network, with the write (`logMeal({ parsed })`)
 * faked at the service boundary — so what the action HANDS the card's confirm path is what is
 * asserted. FOOD-LOGGING-COACH-LED.md, build step 3:
 *
 *   - a picked row logs and is learned: its food and their words reach the confirm, and
 *     `confirmedPickRows` (what the confirm teaches from) keeps it;
 *   - words the memory holds price with no model call (the memory pre-seeded here: the log→learn→
 *     log sequence is the confirm's, pinned in food-phrases.test.ts);
 *   - an estimate row logs labelled as the coach's own and carries no food, so it teaches nothing;
 *   - a question row logs nothing and hands the question back with the words — never the pick it
 *     leaned towards; a settled row beside it IS logged, and the question comes back as unchanged;
 *   - a part she could not count is handed back with why; an estimate that also carries a problem
 *     is logged (the open-row near-miss);
 *   - the slot: the argument, else the slot the words name, else other — reached and fallback alike;
 *   - parts the split did not read are said as unchanged lines;
 *   - a row the confirm linked by name is told as priced from that food, not as her estimate;
 *   - the rows pass the card's own caps: words cut at 200, an amount over 10,000 is a fault;
 *   - when she cannot be reached the fallback's rows log as automatic estimates and the answer says so;
 *   - a thrown write, or a read that fails past its fallback, is a fault — never "nothing";
 *   - a bad call never reaches the read.
 */
vi.mock('../ai/aim.ts', () => ({ runJobBySlug: vi.fn() }));
vi.mock('../repos/foods.ts', () => ({ getFoodsByIds: vi.fn(async () => []) }));
vi.mock('../repos/food-phrases.ts', () => ({ recallFoodPhrases: vi.fn(), rememberFoodPhrase: vi.fn() }));
vi.mock('./ai-log.ts', () => ({ logAi: vi.fn() }));
vi.mock('./food-candidate-sources.ts', () => ({ wideLookup: () => async () => ({}) }));
vi.mock('./nutrition.ts', () => ({ logMeal: vi.fn() }));

/**
 * The action cannot be handed deps, so the seam is threaded in here: the real `logDescribedMeal`
 * with this file's fakes in place of the production sources. Nothing else about the module changes.
 */
const seam = vi.hoisted(() => ({ deps: null as unknown }));
vi.mock('./food-log-described.ts', async (orig) => {
  const actual = await orig<typeof import('./food-log-described.ts')>();
  return {
    ...actual,
    logDescribedMeal: (userId: string, input: Parameters<typeof actual.logDescribedMeal>[1]) =>
      actual.logDescribedMeal(userId, input, seam.deps as DescribedMealDeps),
  };
});

import type { FoodPhraseRow } from '../repos/food-phrases.ts';
import type { FanOutResult } from './food-source-fanout.ts';
import type { SourceCandidate } from './food-source-report.ts';
import type { DescribedMealDeps } from './food-described-rows.ts';
import { confirmedPickRows, phraseKey } from './food-phrases.ts';
import { logMeal } from './nutrition.ts';
import { toolOutputShape } from './tool-response.ts';
import { LOG_MEAL } from './coach-action-log-meal.ts';

const USER = '00000000-0000-4000-a000-00000000d001';

/** Real uuids: the rows pass the card's own validator, which refuses any other food id. */
const BANANA_ID = '00000000-0000-4000-a000-0000000000a1';
const MILK_ID = '00000000-0000-4000-a000-0000000000a2';
const LATTE_ID = '00000000-0000-4000-a000-0000000000a3';
const PARFAIT_ID = '00000000-0000-4000-a000-0000000000a4';

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
  food_id: BANANA_ID,
  name: 'Banana, raw',
  macros_per_base: { kcal: 89, protein_g: 1.1 },
  servings: [{ label: '1 medium (118g)', unit: 'medium', amount_g: 118 }],
});
const milk = food({
  food_id: MILK_ID,
  name: 'Milk, 2%',
  macros_per_base: { kcal: 50, protein_g: 3.3 },
  servings: [{ label: '1 cup (244g)', unit: 'cup', amount_g: 244 }],
});
const latte = food({
  food_id: LATTE_ID,
  owner_user_id: USER,
  name: 'Caffè Latte (Venti)',
  brand: 'Starbucks',
  source: 'fatsecret',
  macros_per_base: { kcal: 42.3, protein_g: 2.7 },
  servings: [{ label: '1 venti', unit: 'venti', amount_g: 591 }],
});
/** A food the person pinned earlier — what the confirm's name match can find for an estimate row. */
const parfait = food({ food_id: PARFAIT_ID, owner_user_id: USER, name: 'Yogurt parfait', source: 'llm' });
const FOODS = [banana, milk, latte, parfait];

function asCandidate(f: Food): SourceCandidate {
  const s = f.servings[0]!;
  const factor = s.amount_g / 100;
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

const BY_Q: Record<string, Food[]> = { banana: [banana], milk: [milk], 'Starbucks venti latte': [latte] };

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
const bananaPick = (id = 'c1') => item({ said: 'a banana', pick: id, measure: '1 medium (118g)', count: 1 });
const parfaitEstimate = (over: Record<string, unknown> = {}) =>
  item({ said: 'a parfait', name: 'yogurt parfait', estimate: { kcal: 380, protein_g: 10 }, ...over });

/** This file's fakes behind the seam; `calls` records what the model was asked. */
function fakes(over: Partial<DescribedMealDeps> & { reply?: Reply; memory?: Record<string, FoodPhraseRow> } = {}) {
  const calls: Array<{ said: string }> = [];
  const d: DescribedMealDeps = {
    lookup: async (l) => fanOut(l.q),
    call: async (vars) => {
      calls.push({ said: vars.said });
      return JSON.stringify({ items: over.reply ?? [], lookups: [] });
    },
    foods: async (ids) => FOODS.filter((f) => ids.includes(f.food_id)),
    recall: async (keys) => new Map(keys.flatMap((k) => (over.memory?.[k] ? [[k, over.memory[k]!] as const] : []))),
    fallback: vi.fn(async (text: string, meal?: string) => ({
      meal: (meal ?? 'other') as 'other',
      items: text.split(', ').map((name) => ({ name, qty: 1, unit: 'serving', est: { kcal: 10 } })),
      macros: { kcal: 10 },
      confidence: 0.5,
      flags: {},
      raw_text: text,
    })),
    log: vi.fn(),
    ...over,
  };
  seam.deps = d;
  return { d, calls };
}

/** The confirm path, faked: the meal as written is the rows it was handed, their words dropped. */
function confirmWrites(over: Partial<NutritionLog> = {}): void {
  vi.mocked(logMeal).mockImplementation(async (_userId, input) => {
    const p = input.parsed!;
    return {
      log_id: 'log-1',
      date: p.date ?? '2026-11-01',
      meal: p.meal,
      items: p.items.map(({ said: _said, ...row }) => row),
      macros: p.macros,
      provisional: false,
      ...over,
    } as unknown as NutritionLog;
  });
}

/** What the action handed the confirm path. */
const sent = () => vi.mocked(logMeal).mock.calls[0]?.[1].parsed;
const written = async () => (await vi.mocked(logMeal).mock.results[0]!.value) as NutritionLog;

const lattePhrase = phraseKey('Starbucks venti latte');
const LATTE_MEMORY = { [lattePhrase]: { phrase: lattePhrase, food_id: LATTE_ID, qty: 1, unit: 'venti', uses: 3 } };

beforeEach(() => {
  vi.mocked(logMeal).mockReset();
  confirmWrites();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('log_meal — a picked row logs and learns', () => {
  it('logs the record the coach picked, priced by the store, and hands the confirm its food and their words', async () => {
    fakes({ reply: [bananaPick()] });
    const out = await LOG_MEAL.run(USER, { text: 'a banana', meal: 'snack' });

    expect(toolOutputShape(out)).toBe('changed');
    expect(out).toMatch(/^changed: Logged for 2026-11-01 \(snack\): 1 medium Banana, raw: 105 kcal/);
    expect(out).toContain('a record the coach picked, priced from USDA');
    expect(out).not.toContain('unchanged:');

    const p = sent()!;
    expect(p.meal).toBe('snack');
    expect(p.raw_text).toBe('a banana');
    expect(p.macros).toMatchObject({ source: 'ledger' });
    expect(p.macros?.kcal).toBeCloseTo(105, 0);
    expect(p.items).toHaveLength(1);
    expect(p.items[0]).toMatchObject({
      name: 'Banana, raw',
      qty: 1,
      unit: 'medium',
      food_id: BANANA_ID,
      said: 'a banana',
    });
    // The card's wire shape, nothing the read noted for the card.
    expect(p.items[0]).not.toHaveProperty('basis');
    expect(p.items[0]).not.toHaveProperty('source_label');
    // What the confirm teaches the memory from: this row, with the words it was said in.
    expect(confirmedPickRows((await written()).items, p.items)).toEqual([
      expect.objectContaining({ food_id: BANANA_ID, said: 'a banana' }),
    ]);
  });

  it('with the memory pre-seeded, the words price from it and the model is not called', async () => {
    const { calls } = fakes({ memory: LATTE_MEMORY });
    const out = await LOG_MEAL.run(USER, { text: 'Starbucks venti latte', meal: 'drink' });

    expect(calls).toHaveLength(0);
    expect(out).toMatch(/^changed: Logged for 2026-11-01 \(drink\): 1 venti Starbucks Caffè Latte \(Venti\): 250 kcal/);
    expect(out).toContain('what they picked before, priced from that food');
    expect(sent()!.items[0]).toMatchObject({
      food_id: LATTE_ID,
      said: 'Starbucks venti latte',
      qty: 1,
      unit: 'venti',
    });
  });

  it('a remembered row beside a model row: one call, order kept, the model’s duplicate dropped by phrase key', async () => {
    const { calls } = fakes({
      memory: LATTE_MEMORY,
      // The model answers for the latte anyway, though it was asked only about the banana.
      reply: [item({ said: 'Starbucks venti latte', name: 'latte', estimate: { kcal: 190 } }), bananaPick()],
    });
    const out = await LOG_MEAL.run(USER, { text: 'Starbucks venti latte and a banana', meal: 'breakfast' });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.said).toBe('a banana');
    const p = sent()!;
    expect(p.items.map((i) => i.name)).toEqual(['Caffè Latte (Venti)', 'Banana, raw']);
    expect(p.items[0]).toMatchObject({ food_id: LATTE_ID });
    const lines = out.split('\n');
    expect(lines[0]).toContain('Caffè Latte (Venti): 250 kcal');
    expect(lines[1]).toContain('Banana, raw: 105 kcal');
    expect(lines[2]).toMatch(/^changed: The meal's total is 355 kcal/);
  });

  it('two settled rows log as two lines and the total', async () => {
    fakes({ reply: [bananaPick(), parfaitEstimate()] });
    const out = await LOG_MEAL.run(USER, { text: 'a banana and a parfait', meal: 'breakfast' });
    const lines = out.split('\n');
    expect(lines[0]).toMatch(/^changed: Logged for 2026-11-01 \(breakfast\): 1 medium Banana, raw: 105 kcal/);
    expect(lines[1]).toMatch(/^changed: Logged for 2026-11-01 \(breakfast\): 1 serving yogurt parfait: 380 kcal/);
    expect(lines[2]).toBe("changed: The meal's total is 485 kcal · 11g protein.");
    expect(sent()!.items).toHaveLength(2);
  });

  it('when the confirm echoes a different row count, the answer falls back to the rows as read', async () => {
    fakes({ reply: [bananaPick()] });
    confirmWrites({ items: [] });
    const out = await LOG_MEAL.run(USER, { text: 'a banana', meal: 'snack' });
    expect(out).toMatch(
      /^changed: Logged for 2026-11-01 \(snack\): 1 medium Banana, raw: 105 kcal · 1g protein \(a record the coach picked/,
    );
  });
});

describe('log_meal — an estimate row logs labelled, and teaches nothing', () => {
  it("says the number is the coach's own estimate and states her assumption; the row carries no food", async () => {
    fakes({ reply: [parfaitEstimate({ assumption: 'the small one' })] });
    const out = await LOG_MEAL.run(USER, { text: 'a parfait', meal: 'snack' });

    expect(out).toMatch(/^changed: Logged for 2026-11-01 \(snack\): 1 serving yogurt parfait: 380 kcal · 10g protein/);
    expect(out).toContain("(the coach's own estimate; assumed: the small one)");
    const p = sent()!;
    expect(p.items[0]).toMatchObject({ name: 'yogurt parfait', qty: 1, unit: 'serving', said: 'a parfait' });
    expect(p.items[0]!.est).toMatchObject({ kcal: 380, protein_g: 10, source: 'ai' });
    expect(p.items[0]).not.toHaveProperty('food_id');
    expect(p.macros).toMatchObject({ source: 'ai' });
    expect(confirmedPickRows((await written()).items, p.items)).toEqual([]);
  });

  it('an estimate the confirm priced from a food it matched by name is told as that, with the food named', async () => {
    fakes({ reply: [parfaitEstimate()] });
    // The confirm's name match found the parfait they pinned before: its number replaces the estimate.
    vi.mocked(logMeal).mockImplementation(async (_u, input) => {
      const p = input.parsed!;
      return {
        date: '2026-11-01',
        meal: p.meal,
        items: [{ name: 'yogurt parfait', qty: 1, unit: 'serving', est: { kcal: 300 }, food_id: PARFAIT_ID }],
        macros: { kcal: 300 },
        provisional: false,
      } as unknown as NutritionLog;
    });
    const out = await LOG_MEAL.run(USER, { text: 'a parfait', meal: 'snack' });

    expect(out).toContain(
      "1 serving yogurt parfait: 300 kcal (priced from a food the store matched by name (Yogurt parfait), not the coach's estimate)",
    );
    expect(out).not.toContain("the coach's own estimate");
    expect(out).not.toContain('380');
  });

  it('near-miss: a row the read linked itself is never called matched by name', async () => {
    fakes({ reply: [bananaPick()] });
    const out = await LOG_MEAL.run(USER, { text: 'a banana', meal: 'snack' });
    expect(out).not.toContain('matched by name');
  });

  it('an estimate that also carries a problem is logged, labelled, with the problem beside it', async () => {
    // c9 is not in the book: the guard round sends it back once; the second reply still names it
    // but gives an estimate, so the row is her estimate with the problem on it — not an open row.
    const { calls } = fakes({ reply: [parfaitEstimate({ pick: 'c9', measure: '1 medium (118g)', count: 1 })] });
    const out = await LOG_MEAL.run(USER, { text: 'a parfait', meal: 'snack' });
    expect(calls).toHaveLength(2);
    expect(toolOutputShape(out)).toBe('changed');
    expect(out).toMatch(/^changed: Logged for 2026-11-01 \(snack\): 1 serving yogurt parfait: 380 kcal/);
    expect(out).toContain("the coach's own estimate; why: ");
    expect(sent()!.items).toHaveLength(1);
  });
});

describe('log_meal — a question row logs nothing and hands the question back', () => {
  const asked = item({ said: 'milk', pick: 'c1', measure: '1 cup (244g)', count: 1, question: 'Whole milk or 2%?' });

  it('on its own: nothing changed, the question and the words, never the pick it leaned towards', async () => {
    fakes({ reply: [asked] });
    const out = await LOG_MEAL.run(USER, { text: 'milk', meal: 'breakfast' });

    expect(toolOutputShape(out)).toBe('nothing-changed');
    expect(out.split('\n')[0]).toBe(
      'nothing changed: nothing was logged — "milk" waits on their answer: Whole milk or 2%?',
    );
    expect(out).not.toContain('?.');
    expect(out).toContain('call log_meal again with that part alone');
    expect(out).not.toContain('Milk, 2%');
    expect(out).not.toContain('already on their file');
    expect(logMeal).not.toHaveBeenCalled();
  });

  it('the answers she offered come back beside the question, as a fact she can repeat', async () => {
    fakes({ reply: [item({ ...asked, choices: ['Whole milk', '2%', 'Skim'] })] });
    const out = await LOG_MEAL.run(USER, { text: 'milk', meal: 'breakfast' });
    expect(out.split('\n')[0]).toBe(
      'nothing changed: nothing was logged — "milk" waits on their answer: Whole milk or 2%? (choices: Whole milk / 2% / Skim).',
    );
    expect(logMeal).not.toHaveBeenCalled();
  });

  it('beside a settled row: the settled row is logged, the question comes back as unchanged', async () => {
    fakes({ reply: [asked, bananaPick('c2')] });
    const out = await LOG_MEAL.run(USER, { text: 'milk and a banana', meal: 'breakfast' });

    expect(toolOutputShape(out)).toBe('changed');
    expect(out).toMatch(/^changed: Logged for 2026-11-01 \(breakfast\): 1 medium Banana, raw: 105 kcal/);
    expect(out).toContain('unchanged: "milk" waits on their answer: Whole milk or 2%? — not logged.');
    expect(out).toContain('the rest of the meal is already on their file');
    expect(out).not.toContain('Milk, 2%');
    const p = sent()!;
    expect(p.items).toHaveLength(1);
    expect(p.items[0]).toMatchObject({ food_id: BANANA_ID });
    // The total handed over is of what is logged, not of the card.
    expect(p.macros?.kcal).toBeCloseTo(105, 0);
  });

  it('near-miss: the same pick without a question is logged', async () => {
    fakes({ reply: [item({ said: 'milk', pick: 'c1', measure: '1 cup (244g)', count: 1 })] });
    const out = await LOG_MEAL.run(USER, { text: 'milk', meal: 'breakfast' });
    expect(out).toMatch(/^changed: Logged for 2026-11-01 \(breakfast\): 1 cup Milk, 2%: 122 kcal/);
    expect(sent()!.items[0]).toMatchObject({ food_id: MILK_ID, said: 'milk' });
  });

  it('a part she could not count is handed back with why, and nothing is logged for it', async () => {
    // c9 is not in the book and no estimate is given: after the guard round the row is open and says why.
    const { calls } = fakes({ reply: [bananaPick('c9')] });
    const out = await LOG_MEAL.run(USER, { text: 'a banana', meal: 'snack' });

    expect(calls).toHaveLength(2);
    expect(toolOutputShape(out)).toBe('nothing-changed');
    expect(out).toMatch(
      /^nothing changed: nothing was logged — "a banana" could not be counted: .*not an id in the book/,
    );
    expect(out).toContain('ask for more detail');
    expect(logMeal).not.toHaveBeenCalled();
  });
});

describe('log_meal — the slot: the argument, else the slot the words name, else other', () => {
  it('words that name a slot file the meal there when no meal is passed (reached)', async () => {
    fakes({ reply: [bananaPick()] });
    const out = await LOG_MEAL.run(USER, { text: 'a banana for breakfast' });
    expect(sent()!.meal).toBe('breakfast');
    expect(out).toContain('(breakfast)');
    // The slot phrase is not food: the row's words, and what the memory will learn, are "a banana".
    expect(sent()!.items[0]).toMatchObject({ food_id: BANANA_ID, said: 'a banana' });
    expect(sent()!.raw_text).toBe('a banana for breakfast');
  });

  it('the fallback files it under the same slot — never parse-meal’s own guess', async () => {
    const { d } = fakes({ call: async () => Promise.reject(new Error('503')) });
    await LOG_MEAL.run(USER, { text: 'a banana for breakfast' });
    expect(d.fallback).toHaveBeenCalledWith('a banana', 'breakfast');
    expect(sent()!.meal).toBe('breakfast');
  });

  it('the argument wins over the words', async () => {
    fakes({ reply: [bananaPick()] });
    await LOG_MEAL.run(USER, { text: 'a banana for breakfast', meal: 'snack' });
    expect(sent()!.meal).toBe('snack');
  });

  it('near-miss: neither names a slot → other; a food that merely contains a slot word does not count', async () => {
    fakes({ reply: [item({ said: 'a breakfast bar', name: 'breakfast bar', estimate: { kcal: 190 } })] });
    await LOG_MEAL.run(USER, { text: 'a breakfast bar' });
    expect(sent()!.meal).toBe('other');
  });
});

describe('log_meal — parts the split did not read are said, never dropped in silence', () => {
  it('an eleventh part is named as not read, with the rule, after the ten that were logged', async () => {
    const parts = Array.from({ length: 11 }, (_, i) => `food${i + 1}`);
    fakes({ reply: parts.slice(0, 10).map((p) => item({ said: p, name: p, estimate: { kcal: 10 } })) });
    const out = await LOG_MEAL.run(USER, { text: parts.join(', '), meal: 'dinner' });

    expect(toolOutputShape(out)).toBe('changed');
    expect(sent()!.items).toHaveLength(10);
    expect(out).toContain('unchanged: "food11" not read — the read takes at most 10 parts.');
    expect(out.match(/^changed: Logged for/gm)).toHaveLength(10);
  });

  it('a part said twice is read once, and the answer says so', async () => {
    fakes({ reply: [item({ said: 'a latte', name: 'latte', estimate: { kcal: 190 } })] });
    const out = await LOG_MEAL.run(USER, { text: 'a latte, a latte', meal: 'drink' });
    expect(sent()!.items).toHaveLength(1);
    expect(out).toContain('unchanged: "latte" said twice, read once.');
  });

  it('when nothing is logged the dropped part is still said', async () => {
    fakes({ reply: [item({ said: 'milk', pick: 'c1', measure: '1 cup (244g)', count: 1, question: 'Whole or 2%?' })] });
    const out = await LOG_MEAL.run(USER, { text: 'milk, milk', meal: 'breakfast' });
    expect(toolOutputShape(out)).toBe('nothing-changed');
    expect(out).toContain('"milk" said twice, read once.');
  });
});

describe("log_meal — the rows pass the card's own caps (one validator for both doors)", () => {
  it('their words for a row are cut at 200 characters, as the card cuts them', async () => {
    const long = `a ${'very '.repeat(60)}long dish`;
    fakes({ reply: [item({ said: long, name: 'long dish', estimate: { kcal: 400 } })] });
    const out = await LOG_MEAL.run(USER, { text: long, meal: 'dinner' });
    expect(toolOutputShape(out)).toBe('changed');
    expect(sent()!.items[0]!.said).toHaveLength(200);
    expect(sent()!.items[0]!.said).toBe(long.slice(0, 200));
  });

  it('an amount over the cap is a fault that names the rule, not a write', async () => {
    fakes({ reply: [item({ said: 'Starbucks venti latte', pick: 'c1', measure: '1 venti', count: 20_000 })] });
    const out = await LOG_MEAL.run(USER, { text: 'Starbucks venti latte', meal: 'drink' });
    expect(toolOutputShape(out)).toBe('fault');
    expect(out).toMatch(/could not be logged \(items\.0\.qty: .*10000/);
    expect(logMeal).not.toHaveBeenCalled();
  });

  it('near-miss: an amount inside the cap is written', async () => {
    fakes({ reply: [item({ said: 'Starbucks venti latte', pick: 'c1', measure: '1 venti', count: 2 })] });
    const out = await LOG_MEAL.run(USER, { text: 'Starbucks venti latte', meal: 'drink' });
    expect(toolOutputShape(out)).toBe('changed');
    expect(sent()!.items[0]).toMatchObject({ qty: 2, unit: 'venti' });
  });
});

describe('log_meal — when she cannot be reached', () => {
  it("the fallback's rows log as automatic estimates, and the answer says she was not reached", async () => {
    const { d } = fakes({ call: async () => Promise.reject(new Error('503 from the provider')) });
    const out = await LOG_MEAL.run(USER, { text: 'milk and a banana', meal: 'breakfast' });

    expect(d.fallback).toHaveBeenCalledWith('milk, a banana', 'breakfast');
    expect(toolOutputShape(out)).toBe('changed');
    expect(out).toContain('(an automatic estimate, the coach not reached)');
    expect(out).toContain('could not be reached');
    const p = sent()!;
    expect(p.items).toHaveLength(2);
    expect(p.items.every((i) => !i.food_id)).toBe(true);
    expect(p.confidence).toBe(0.5);
  });

  it('a fallback with no numbers on any row is told as PROVISIONAL, not as counted', async () => {
    fakes({
      call: async () => Promise.reject(new Error('503')),
      fallback: vi.fn(async (text: string, meal?: string) => ({
        meal: (meal ?? 'other') as 'other',
        items: [{ name: 'mystery leftovers' }],
        macros: null,
        confidence: 0.2,
        flags: {},
        raw_text: text,
      })),
    });
    // Nothing priced: the confirm marks it provisional and its total carries no number at all.
    confirmWrites({ provisional: true, macros: {} });
    const out = await LOG_MEAL.run(USER, { text: 'some mystery leftovers', meal: 'dinner' });

    expect(toolOutputShape(out)).toBe('changed');
    expect(out).toContain('PROVISIONAL');
    expect(out).toContain('mystery leftovers');
    expect(out).toContain('nothing priced yet');
    expect(out).toMatch(/not count toward.*totals/i);
    expect(out).toContain('could not be reached');
    expect(out).not.toMatch(/^changed: Logged for/m);
  });
});

describe('log_meal — a fault never reads as nothing, and a bad call never reaches the read', () => {
  it('a thrown write is a fault', async () => {
    fakes({ reply: [bananaPick()] });
    vi.mocked(logMeal).mockRejectedValue(new Error('db unavailable'));
    const out = await LOG_MEAL.run(USER, { text: 'a banana' });
    expect(toolOutputShape(out)).toBe('fault');
    expect(out).toContain('could not be logged');
  });

  it('a read that fails past its fallback is a fault too', async () => {
    fakes({
      call: async () => Promise.reject(new Error('503')),
      fallback: vi.fn(async () => Promise.reject(new Error('parse-meal down too'))),
    });
    const out = await LOG_MEAL.run(USER, { text: 'a banana' });
    expect(toolOutputShape(out)).toBe('fault');
    expect(logMeal).not.toHaveBeenCalled();
  });

  it('words with nothing readable as food change nothing', async () => {
    // A reply with no items is an outage by design (food-check.ts), so the fallback reads the
    // words — and finds nothing in them either.
    fakes({
      reply: [],
      fallback: vi.fn(async (text: string) => ({
        meal: 'other' as const,
        items: [],
        macros: null,
        confidence: null,
        flags: {},
        raw_text: text,
      })),
    });
    const out = await LOG_MEAL.run(USER, { text: 'blah blah' });
    expect(toolOutputShape(out)).toBe('nothing-changed');
    expect(out).toMatch(/^nothing changed: nothing readable as food in "blah blah"/);
    expect(logMeal).not.toHaveBeenCalled();
  });

  it('refuses blank text before any read', async () => {
    const { calls } = fakes();
    const out = await LOG_MEAL.run(USER, { text: '   ' });
    expect(out).toMatch(/^nothing changed: no food was named/);
    expect(calls).toHaveLength(0);
    expect(logMeal).not.toHaveBeenCalled();
  });

  it('an unrecognised meal value is dropped — the words name no slot, so the meal is filed under other', async () => {
    fakes({ reply: [item({ said: 'toast', name: 'toast', estimate: { kcal: 120 } })] });
    await LOG_MEAL.run(USER, { text: 'toast', meal: 'brunch' });
    expect(sent()!.meal).toBe('other');
  });

  it.each(['yesterday', '2026-02-30'])('a malformed date (%s) is dropped rather than passed through', async (date) => {
    fakes({ reply: [item({ said: 'toast', name: 'toast', estimate: { kcal: 120 } })] });
    await LOG_MEAL.run(USER, { text: 'toast', date });
    expect(sent()).not.toHaveProperty('date');
  });

  it('a valid date rides to the confirm and into the answer', async () => {
    fakes({ reply: [item({ said: 'toast', name: 'toast', estimate: { kcal: 120 } })] });
    const out = await LOG_MEAL.run(USER, { text: 'toast', meal: 'breakfast', date: '2026-08-20' });
    expect(sent()!.date).toBe('2026-08-20');
    expect(out).toContain('Logged for 2026-08-20 (breakfast)');
  });
});
