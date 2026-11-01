/**
 * The food-check rounds: the shape holds whatever the model does. Two calls at most, lookups
 * only on the first, a bad pick back once as evidence, and a reply that is not JSON reads as an
 * error — never as an empty meal.
 */
import { describe, expect, it, vi } from 'vitest';
import type { FanOutResult } from './food-source-fanout.ts';
import type { SourceCandidate } from './food-source-report.ts';
import { CandidateBook, MAX_PARTS } from './food-candidate-book.ts';
import {
  FOOD_CHECK_MAX_CALLS,
  ROUND_RULE_LAST,
  ROUND_RULE_OPEN,
  checkItems,
  foodCheckRounds,
  guardNotes,
  parseFoodCheckReply,
  type FoodCheckVars,
} from './food-check.ts';

const banana: SourceCandidate = {
  source: 'usda',
  food_id: 'f-banana',
  name: 'Banana, raw',
  brand: null,
  per: { measure: '1 medium (118g)', grams: 118, nutrients: { kcal: 105, protein_g: 1.3 } },
  measures: [{ label: '1 medium (118g)', grams: 118 }],
  micros: 'measured',
  completeness: 'full',
  notes: [],
};
const found = (candidates: SourceCandidate[]): FanOutResult => ({
  query: 'x',
  brand: null,
  requested_measure: null,
  candidates,
  sources_checked: [],
  disagreements: [],
});
const bookWith = (...cs: SourceCandidate[]): CandidateBook => {
  const b = new CandidateBook();
  b.add({ q: 'banana', measure: null, brand: null }, found(cs));
  return b;
};
const item = (over: Partial<Record<string, unknown>> = {}) => ({
  said: 'a banana',
  name: null,
  brand: null,
  pick: 'c1',
  measure: '1 medium (118g)',
  count: 1,
  assumption: null,
  question: null,
  estimate: null,
  ...over,
});

describe('parseFoodCheckReply', () => {
  it('reads a strict reply, and tolerates prose around it', () => {
    const r = parseFoodCheckReply(`Here you go:\n{"items":[${JSON.stringify(item())}],"lookups":[]}\nThanks`);
    expect(r?.items).toHaveLength(1);
    expect(r?.items[0]).toMatchObject({ said: 'a banana', pick: 'c1', count: 1 });
    expect(r?.lookups).toEqual([]);
  });
  it('blank strings become null, numbers are checked, an empty estimate is null', () => {
    const r = parseFoodCheckReply(
      JSON.stringify({
        items: [item({ assumption: '  ', question: 'whole or 2%?', count: 'two', estimate: {} })],
        lookups: [],
      }),
    );
    expect(r?.items[0]).toMatchObject({ assumption: null, question: 'whole or 2%?', count: null, estimate: null });
  });
  it('an estimate with numbers is kept, with its plain name and the brand they named', () => {
    const r = parseFoodCheckReply(
      JSON.stringify({
        items: [
          item({ pick: null, name: 'yogurt parfait', brand: 'Materia Prima', estimate: { kcal: 120, protein_g: 24 } }),
        ],
        lookups: [],
      }),
    );
    expect(r?.items[0]).toMatchObject({
      name: 'yogurt parfait',
      brand: 'Materia Prima',
      estimate: { kcal: 120, protein_g: 24 },
    });
  });
  it('lookups keep q, measure and brand, capped at eight', () => {
    const lookups = Array.from({ length: 10 }, (_, i) => ({
      q: `food ${i}`,
      measure: null,
      brand: i ? null : 'Yupik',
    }));
    const r = parseFoodCheckReply(JSON.stringify({ items: [], lookups }));
    expect(r?.lookups).toHaveLength(8);
    expect(r?.lookups[0]).toEqual({ q: 'food 0', measure: null, brand: 'Yupik' });
  });
  it.each(['', 'no json here', '{"meal":"x"}', '[1,2]'])('%j is not a reply', (raw) => {
    expect(parseFoodCheckReply(raw)).toBeNull();
  });
  it('caps the items at the parts a meal can have — the confirm takes at most twelve rows', () => {
    const items = Array.from({ length: 14 }, (_, i) => item({ said: `part ${i}` }));
    expect(parseFoodCheckReply(JSON.stringify({ items, lookups: [] }))?.items).toHaveLength(MAX_PARTS);
  });
});

describe('checkItems and guardNotes', () => {
  it('names each bad pick by item number with the reason', () => {
    const book = bookWith(banana);
    const items = [item(), item({ pick: 'c7' }), item({ measure: '1 cup' }), item({ pick: null })];
    const problems = checkItems(items, book);
    expect([...problems.keys()]).toEqual([1, 2]);
    const notes = guardNotes(items, problems);
    expect(notes).toContain('item 2 ("a banana"): pick "c7" is not an id in the book');
    expect(notes).toContain('item 3 ("a banana"): measure "1 cup" is not one c1 offers');
    expect(guardNotes(items, new Map())).toBe('');
  });
});

describe('foodCheckRounds — the shape bounds the model', () => {
  const noLookup = vi.fn(async () => found([]));

  it('one call when the first reply is items that check out', async () => {
    const book = bookWith(banana);
    const call = vi.fn(async (v: FoodCheckVars) => {
      expect(v.round_rule).toBe(ROUND_RULE_OPEN);
      expect(v.guard_notes).toBe('');
      expect(v.book).toContain('c1 · usda · Banana, raw');
      return JSON.stringify({ items: [item()], lookups: [] });
    });
    const out = await foodCheckRounds({ meal: 'breakfast', said: 'a banana', book }, { call, lookup: noLookup });
    expect(out).toMatchObject({ calls: 1, error: null, lookups: [] });
    expect(out.problems.size).toBe(0);
    expect(out.items[0]?.pick).toBe('c1');
  });

  it('lookups on the first call grow the book; the second call is the last and offers none', async () => {
    const book = bookWith();
    const lookup = vi.fn(async () => found([banana]));
    const rules: string[] = [];
    const call = vi.fn(async (v: FoodCheckVars) => {
      rules.push(v.round_rule);
      if (rules.length === 1)
        return JSON.stringify({ items: [], lookups: [{ q: 'banana', measure: null, brand: null }] });
      expect(v.book).toContain('Banana, raw');
      return JSON.stringify({ items: [item()], lookups: [{ q: 'ignored', measure: null, brand: null }] });
    });
    const out = await foodCheckRounds({ meal: 'snack', said: 'bananna', book }, { call, lookup });
    expect(rules).toEqual([ROUND_RULE_OPEN, ROUND_RULE_LAST]);
    expect(lookup).toHaveBeenCalledTimes(1);
    expect(out.calls).toBe(FOOD_CHECK_MAX_CALLS);
    expect(out.lookups).toEqual([{ q: 'banana', measure: null, brand: null }]);
    expect(out.items[0]?.pick).toBe('c1');
  });

  it('a bad pick goes back once as evidence, then stands as a problem after the last call', async () => {
    const book = bookWith(banana);
    const notes: string[] = [];
    const call = vi.fn(async (v: FoodCheckVars) => {
      notes.push(v.guard_notes);
      return JSON.stringify({ items: [item({ pick: 'c9' })], lookups: [] });
    });
    const out = await foodCheckRounds({ meal: 'snack', said: 'a banana', book }, { call, lookup: noLookup });
    expect(call).toHaveBeenCalledTimes(2);
    expect(notes[0]).toBe('');
    expect(notes[1]).toContain('pick "c9" is not an id in the book');
    expect(out.problems.get(0)).toMatch(/not an id/);
    expect(out.error).toBeNull();
  });

  it('never makes a third call, even when the last reply still asks for lookups', async () => {
    const book = bookWith();
    const lookup = vi.fn(async () => found([]));
    const call = vi.fn(async () => JSON.stringify({ items: [], lookups: [{ q: 'x', measure: null, brand: null }] }));
    const out = await foodCheckRounds({ meal: 'snack', said: 'x', book }, { call, lookup });
    expect(call).toHaveBeenCalledTimes(2);
    expect(lookup).toHaveBeenCalledTimes(1);
    expect(out.error).toMatch(/no items/);
  });

  it('a reply that is not JSON is an error, not an empty meal', async () => {
    const book = bookWith(banana);
    const out = await foodCheckRounds(
      { meal: 'snack', said: 'a banana', book },
      { call: async () => 'I think it was a banana.', lookup: noLookup },
    );
    expect(out.error).toMatch(/no JSON/);
    expect(out.items).toEqual([]);
  });

  it('a transport failure throws through to the caller', async () => {
    const book = bookWith(banana);
    await expect(
      foodCheckRounds(
        { meal: 'snack', said: 'a banana', book },
        { call: async () => Promise.reject(new Error('503')), lookup: noLookup },
      ),
    ).rejects.toThrow('503');
  });
});
