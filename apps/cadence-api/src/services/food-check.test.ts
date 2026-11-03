/**
 * The food-check rounds: the shape holds whatever the model does. Two calls at most, lookups
 * only on the first, a bad pick back once as evidence, and a reply that is not JSON reads as an
 * error — never as an empty meal.
 */
import { describe, expect, it, vi } from 'vitest';
import { QUESTION_CHOICES_MAX, QUESTION_CHOICE_MAX_CHARS } from '@cadence/shared';
import type { FanOutResult } from './food-source-fanout.ts';
import type { SourceCandidate } from './food-source-report.ts';
import { CandidateBook, MAX_PARTS, type BookLookup, type BookLookupFn } from './food-candidate-book.ts';
import {
  FOOD_CHECK_MAX_CALLS,
  ROUND_RULE_LAST,
  ROUND_RULE_OPEN,
  WEB_LOOKUPS_PER_MEAL,
  checkItems,
  foodCheckRounds,
  guardNotes,
  parseFoodCheckReply,
  readChoices,
  withWebRows,
  type FoodCheckVars,
  type WebRows,
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
  choices: null,
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
  it('choices ride with a question: trimmed, no repeats (case apart), at most QUESTION_CHOICES_MAX, in the order given', () => {
    const r = parseFoodCheckReply(
      JSON.stringify({
        items: [
          item({
            question: 'Whole milk, 2% or skim?',
            choices: [' Whole milk ', '2%', 'whole milk', '', 'Skim', 'Oat milk', 'Almond milk'],
          }),
        ],
        lookups: [],
      }),
    );
    expect(QUESTION_CHOICES_MAX).toBe(4);
    expect(r?.items[0]?.choices).toEqual(['Whole milk', '2%', 'Skim', 'Oat milk']);
  });
  it.each([
    ['no choices given', item({ question: 'Whole milk or 2%?' })],
    ['an empty list', item({ question: 'Whole milk or 2%?', choices: [] })],
    ['a list of blanks', item({ question: 'Whole milk or 2%?', choices: ['', '  '] })],
    ['not a list', item({ question: 'Whole milk or 2%?', choices: 'Whole milk' })],
    ['near-miss: choices with no question answer nothing', item({ choices: ['Whole milk', 'Skim'] })],
  ])('%s → choices null', (_label, it) => {
    expect(parseFoodCheckReply(JSON.stringify({ items: [it], lookups: [] }))?.items[0]?.choices).toBeNull();
  });
  it("readChoices cuts each answer to a button's worth and keeps a lone answer", () => {
    expect(readChoices(['x'.repeat(60)])).toEqual(['x'.repeat(QUESTION_CHOICE_MAX_CHARS)]);
    expect(readChoices(['Oat milk'])).toEqual(['Oat milk']);
    expect(readChoices([1, null, { a: 1 }])).toBeNull();
  });
  it('caps the items at MAX_PARTS, the parts a meal can have (the confirm takes up to twelve rows, so this is the tighter bound)', () => {
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
  it('a question item is not checked: its pick is tentative and never used', () => {
    const book = bookWith(banana);
    expect(checkItems([item({ pick: 'c7', question: 'Which banana?' })], book).size).toBe(0);
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

  it('a question item with a bad id costs no retry', async () => {
    const book = bookWith(banana);
    const call = vi.fn(async () =>
      JSON.stringify({ items: [item({ pick: 'c9', question: 'Which banana — big or small?' })], lookups: [] }),
    );
    const out = await foodCheckRounds({ meal: 'snack', said: 'a banana', book }, { call, lookup: noLookup });
    expect(call).toHaveBeenCalledTimes(1);
    expect(out.problems.size).toBe(0);
    expect(out.items[0]?.question).toBe('Which banana — big or small?');
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

describe('the web in the second round (owner 2026-11-03): a lookup with a maker named goes to the web too', () => {
  const perkins: SourceCandidate = {
    ...banana,
    source: 'fatsecret',
    food_id: 'f-perkins',
    name: "Perkins Restaurant Rickard's Red Beer",
    per: { measure: '1 serving', grams: 473, nutrients: { kcal: 230, protein_g: 0 } },
    measures: [{ label: '1 serving', grams: 473 }],
  };
  const rickards: SourceCandidate = {
    source: 'research',
    food_id: 'f-rickards',
    name: "Rickard's Red Beer",
    brand: "Molson's",
    per: { measure: '1 pint (473 ml)', grams: 473, nutrients: { kcal: 221, protein_g: 0 } },
    measures: [{ label: '1 pint (473 ml)', grams: 473 }],
    micros: 'none',
    completeness: 'macros',
    notes: [],
  };
  const hit: WebRows = {
    rows: [rickards],
    check: {
      source: 'research',
      status: 'hit',
      ms: 9000,
      detail: 'found "Rickard\'s Red Beer (Molson\'s)", kept as your private food',
    },
  };
  const withMaker: BookLookup = { q: 'red beer', measure: '1 pint', brand: "Rickard's" };
  const plain: BookLookup = { q: 'banana', measure: null, brand: null };
  /** Call 1 asks for the lookups; call 2 picks the given id. */
  const twoCalls = (lookups: BookLookup[], pick: string, measure = '1 pint (473 ml)') => {
    let n = 0;
    return vi.fn(async () => {
      n += 1;
      if (n === 1) return JSON.stringify({ items: [], lookups });
      return JSON.stringify({
        items: [item({ said: 'a pint of rickards red', pick, measure, count: 1 })],
        lookups: [],
      });
    });
  };
  const sourcesOnly = (): BookLookupFn => vi.fn(async () => found([perkins]));

  it('with a maker named: the web is asked beside the sources, its row is shown first, and it can be picked', async () => {
    const book = bookWith(perkins);
    const web = vi.fn(async () => hit);
    const out = await foodCheckRounds(
      { meal: 'other', said: 'a pint of rickards red', book },
      { call: twoCalls([withMaker], 'c2'), lookup: sourcesOnly(), web },
    );
    expect(web).toHaveBeenCalledTimes(1);
    expect(web).toHaveBeenCalledWith(withMaker);
    expect(out.web).toEqual([withMaker]);
    // Perkins was c1 from the first fill; the web's row is new, c2, and first in its section.
    const section = book.sections[1]!;
    expect(section.entryIds).toEqual(['c2', 'c1']);
    expect(section.checked.at(-1)).toMatchObject({ source: 'research', status: 'hit' });
    expect(out.problems.size).toBe(0);
    expect(out.items[0]?.pick).toBe('c2');
  });

  it('near-miss: without a maker the web is not asked, and the trace has no web line', async () => {
    const book = bookWith(perkins);
    const web = vi.fn(async () => hit);
    const out = await foodCheckRounds(
      { meal: 'other', said: 'a banana', book },
      { call: twoCalls([plain], 'c1', '1 serving'), lookup: sourcesOnly(), web },
    );
    expect(web).not.toHaveBeenCalled();
    expect(out.web).toEqual([]);
    expect(book.sections[1]!.checked.some((c) => c.source === 'research')).toBe(false);
  });

  it('near-miss: with no web given (the eval without --web), a maker-named lookup is just the lookup', async () => {
    const book = bookWith(perkins);
    const out = await foodCheckRounds(
      { meal: 'other', said: 'a pint of rickards red', book },
      { call: twoCalls([withMaker], 'c1', '1 serving'), lookup: sourcesOnly() },
    );
    expect(out.web).toEqual([]);
    expect(book.sections[1]!.checked.some((c) => c.source === 'research')).toBe(false);
  });

  it('at most WEB_LOOKUPS_PER_MEAL a meal: the ones past it say the web was skipped, and why', async () => {
    const book = bookWith(perkins);
    const web = vi.fn(async () => hit);
    const three = [withMaker, { ...withMaker, q: 'red ale' }, { ...withMaker, q: 'amber ale' }];
    const out = await foodCheckRounds(
      { meal: 'other', said: 'a pint of rickards red', book },
      { call: twoCalls(three, 'c2'), lookup: sourcesOnly(), web },
    );
    expect(WEB_LOOKUPS_PER_MEAL).toBe(2);
    expect(web).toHaveBeenCalledTimes(2);
    expect(out.web).toEqual(three.slice(0, 2));
    expect(book.sections[3]!.checked.at(-1)).toEqual({
      source: 'research',
      status: 'skipped',
      ms: 0,
      detail: 'at most 2 web lookups a meal',
    });
  });

  it("the web failing is said in the lookup's line, and the sources' own rows still land", async () => {
    const book = bookWith();
    const web = vi.fn(async () => {
      throw new Error('boom');
    });
    const out = await foodCheckRounds(
      { meal: 'other', said: 'a pint of rickards red', book },
      { call: twoCalls([withMaker], 'c1', '1 serving'), lookup: sourcesOnly(), web },
    );
    const section = book.sections[1]!;
    expect(section.checked.at(-1)).toMatchObject({ source: 'research', status: 'error', detail: 'boom' });
    expect(section.entryIds).toEqual(['c1']);
    expect(out.items[0]?.pick).toBe('c1');
    expect(out.problems.size).toBe(0);
  });

  it('the open round rule tells her when to name the maker, and that it sends the lookup to the web', () => {
    expect(ROUND_RULE_OPEN).toContain('every record naming it has a restaurant or chain in brackets');
    expect(ROUND_RULE_OPEN).toContain("not the maker's own, which is not on file yet");
    expect(ROUND_RULE_OPEN).toContain('ask with the food in q and that maker in brand');
    expect(ROUND_RULE_OPEN).toContain('a lookup with a brand is also made on the web, which takes longer');
    expect(ROUND_RULE_LAST).not.toContain('web');
  });

  it("withWebRows: the web's rows go first, a row the sources had too is not doubled, and its check is last", () => {
    const base = {
      ...found([perkins, rickards]),
      sources_checked: [{ source: 'ledger' as const, status: 'hit' as const, ms: 3, detail: '2 rows' }],
    };
    const merged = withWebRows(base, hit);
    expect(merged.candidates.map((c) => c.name)).toEqual([
      "Rickard's Red Beer",
      "Perkins Restaurant Rickard's Red Beer",
    ]);
    expect(merged.sources_checked.map((c) => c.source)).toEqual(['ledger', 'research']);
  });
});
