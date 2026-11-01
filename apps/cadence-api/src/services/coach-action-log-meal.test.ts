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
 *   - words the memory holds price with no model call — the second `log_meal` of the same words;
 *   - an estimate row logs labelled as the coach's own and carries no food, so it teaches nothing;
 *   - a question row logs nothing and hands the question back with the words — never the pick it
 *     leaned towards; a settled row beside it IS logged, and the question comes back as unchanged;
 *   - a part she could not count is handed back with why;
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
const FOODS = [banana, milk, latte];

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

const lattePhrase = phraseKey('Starbucks venti latte');
const LATTE_MEMORY = { [lattePhrase]: { phrase: lattePhrase, food_id: 'f-latte', qty: 1, unit: 'venti', uses: 3 } };

beforeEach(() => {
  vi.mocked(logMeal).mockReset();
  confirmWrites();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('log_meal — a picked row logs and learns', () => {
  it('logs the record the coach picked, priced by the store, and hands the confirm its food and their words', async () => {
    fakes({ reply: [item({ said: 'a banana', pick: 'c1', measure: '1 medium (118g)', count: 1 })] });
    const out = await LOG_MEAL.run(USER, { text: 'a banana', meal: 'snack' });

    expect(toolOutputShape(out)).toBe('changed');
    expect(out).toMatch(/^changed: Logged for 2026-11-01 \(snack\): 1 medium Banana, raw: 105 kcal/);
    expect(out).toContain('a record the coach picked');
    expect(out).toContain('from USDA');
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
      food_id: 'f-banana',
      said: 'a banana',
    });
    // The card's wire shape, nothing the read noted for the card.
    expect(p.items[0]).not.toHaveProperty('basis');
    expect(p.items[0]).not.toHaveProperty('source_label');
    // What the confirm teaches the memory from: this row, with the words it was said in.
    const written = (await vi.mocked(logMeal).mock.results[0]!.value) as NutritionLog;
    expect(confirmedPickRows(written.items, p.items)).toEqual([
      expect.objectContaining({ food_id: 'f-banana', said: 'a banana' }),
    ]);
  });

  it('words the memory holds price from it with no model call — the second log_meal of the same words', async () => {
    const { calls } = fakes({ memory: LATTE_MEMORY });
    const out = await LOG_MEAL.run(USER, { text: 'Starbucks venti latte', meal: 'drink' });

    expect(calls).toHaveLength(0);
    expect(out).toMatch(/^changed: Logged for 2026-11-01 \(drink\): 1 venti Starbucks Caffè Latte \(Venti\): 250 kcal/);
    expect(out).toContain('what they picked last time');
    expect(sent()!.items[0]).toMatchObject({
      food_id: 'f-latte',
      said: 'Starbucks venti latte',
      qty: 1,
      unit: 'venti',
    });
  });

  it('two settled rows log as two lines and the total', async () => {
    fakes({
      reply: [
        item({ said: 'a banana', pick: 'c1', measure: '1 medium (118g)', count: 1 }),
        item({ said: 'a parfait', name: 'yogurt parfait', estimate: { kcal: 380, protein_g: 10 } }),
      ],
    });
    const out = await LOG_MEAL.run(USER, { text: 'a banana and a parfait', meal: 'breakfast' });
    const lines = out.split('\n');
    expect(lines[0]).toMatch(/^changed: Logged for 2026-11-01 \(breakfast\): 1 medium Banana, raw: 105 kcal/);
    expect(lines[1]).toMatch(/^changed: Logged for 2026-11-01 \(breakfast\): 1 serving yogurt parfait: 380 kcal/);
    expect(lines[2]).toBe("changed: The meal's total is 485 kcal · 11g protein.");
    expect(sent()!.items).toHaveLength(2);
  });
});

describe('log_meal — an estimate row logs labelled, and teaches nothing', () => {
  it("says the number is the coach's own estimate and states her assumption; the row carries no food", async () => {
    fakes({
      reply: [
        item({
          said: 'a parfait',
          name: 'yogurt parfait',
          estimate: { kcal: 380, protein_g: 10 },
          assumption: 'the small one',
        }),
      ],
    });
    const out = await LOG_MEAL.run(USER, { text: 'a parfait', meal: 'snack' });

    expect(out).toMatch(/^changed: Logged for 2026-11-01 \(snack\): 1 serving yogurt parfait: 380 kcal · 10g protein/);
    expect(out).toContain("the coach's own estimate");
    expect(out).toContain('assumed: the small one');
    const p = sent()!;
    expect(p.items[0]).toMatchObject({ name: 'yogurt parfait', qty: 1, unit: 'serving', said: 'a parfait' });
    expect(p.items[0]!.est).toMatchObject({ kcal: 380, protein_g: 10, source: 'ai' });
    expect(p.items[0]).not.toHaveProperty('food_id');
    expect(p.macros).toMatchObject({ source: 'ai' });
    const written = (await vi.mocked(logMeal).mock.results[0]!.value) as NutritionLog;
    expect(confirmedPickRows(written.items, p.items)).toEqual([]);
  });
});

describe('log_meal — a question row logs nothing and hands the question back', () => {
  const asked = item({ said: 'milk', pick: 'c1', measure: '1 cup (244g)', count: 1, question: 'Whole milk or 2%?' });

  it('on its own: nothing changed, the question and the words, never the pick it leaned towards', async () => {
    fakes({ reply: [asked] });
    const out = await LOG_MEAL.run(USER, { text: 'milk', meal: 'breakfast' });

    expect(toolOutputShape(out)).toBe('nothing-changed');
    expect(out).toMatch(/^nothing changed: nothing was logged — "milk" waits on their answer: Whole milk or 2%\?\./);
    expect(out).toContain('call log_meal again with that part alone');
    expect(out).not.toContain('Milk, 2%');
    expect(out).not.toContain('already on their file');
    expect(logMeal).not.toHaveBeenCalled();
  });

  it('beside a settled row: the settled row is logged, the question comes back as unchanged', async () => {
    fakes({ reply: [asked, item({ said: 'a banana', pick: 'c2', measure: '1 medium (118g)', count: 1 })] });
    const out = await LOG_MEAL.run(USER, { text: 'milk and a banana', meal: 'breakfast' });

    expect(toolOutputShape(out)).toBe('changed');
    expect(out).toMatch(/^changed: Logged for 2026-11-01 \(breakfast\): 1 medium Banana, raw: 105 kcal/);
    expect(out).toContain('unchanged: "milk" waits on their answer: Whole milk or 2%? — not logged.');
    expect(out).toContain('the rest of the meal is already on their file');
    expect(out).not.toContain('Milk, 2%');
    const p = sent()!;
    expect(p.items).toHaveLength(1);
    expect(p.items[0]).toMatchObject({ food_id: 'f-banana' });
    // The total handed over is of what is logged, not of the card.
    expect(p.macros?.kcal).toBeCloseTo(105, 0);
  });

  it('near-miss: the same pick without a question is logged', async () => {
    fakes({ reply: [item({ said: 'milk', pick: 'c1', measure: '1 cup (244g)', count: 1 })] });
    const out = await LOG_MEAL.run(USER, { text: 'milk', meal: 'breakfast' });
    expect(out).toMatch(/^changed: Logged for 2026-11-01 \(breakfast\): 1 cup Milk, 2%: 122 kcal/);
    expect(sent()!.items[0]).toMatchObject({ food_id: 'f-milk', said: 'milk' });
  });

  it('a part she could not count is handed back with why, and nothing is logged for it', async () => {
    // c9 is not in the book: the guard round sends it back once, then the row is open and says why.
    const { calls } = fakes({ reply: [item({ said: 'a banana', pick: 'c9', measure: '1 medium (118g)', count: 1 })] });
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

describe('log_meal — when she cannot be reached', () => {
  it("the fallback's rows log as automatic estimates, and the answer says she was not reached", async () => {
    const { d } = fakes({ call: async () => Promise.reject(new Error('503 from the provider')) });
    const out = await LOG_MEAL.run(USER, { text: 'milk and a banana', meal: 'breakfast' });

    expect(d.fallback).toHaveBeenCalledWith('milk, a banana', 'breakfast');
    expect(toolOutputShape(out)).toBe('changed');
    expect(out).toContain('an automatic estimate, the coach not reached');
    expect(out).toContain('could not be reached');
    const p = sent()!;
    expect(p.items).toHaveLength(2);
    expect(p.items.every((i) => !i.food_id)).toBe(true);
    expect(p.confidence).toBe(0.5);
  });

  it('a fallback the confirm marks provisional is told as unsettled, not as counted', async () => {
    fakes({ call: async () => Promise.reject(new Error('503')) });
    // Nothing priced: the confirm's total carries no number at all.
    confirmWrites({ provisional: true, macros: {} });
    const out = await LOG_MEAL.run(USER, { text: 'some mystery leftovers', meal: 'dinner' });

    expect(toolOutputShape(out)).toBe('changed');
    expect(out).toContain('PROVISIONAL');
    expect(out).toContain('nothing priced yet');
    expect(out).toMatch(/not count toward.*totals/i);
    expect(out).toContain('could not be reached');
  });
});

describe('log_meal — a fault never reads as nothing, and a bad call never reaches the read', () => {
  it('a thrown write is a fault', async () => {
    fakes({ reply: [item({ said: 'a banana', pick: 'c1', measure: '1 medium (118g)', count: 1 })] });
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

  it('an unrecognised meal value is dropped — the meal is filed under other', async () => {
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
