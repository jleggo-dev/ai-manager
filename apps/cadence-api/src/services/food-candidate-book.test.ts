/**
 * The candidate book, table-tested (owner 2026-09-01: every router ships with positives AND
 * near-misses). The split decides what gets looked up; the book decides what the model may pick
 * from; checkPick decides what counts. Each fails silently when wrong — a wrong lookup finds the
 * wrong food and nothing throws — so each has its rows here.
 *
 * The Starbucks Venti latte (#426) is the pinned failure: FatSecret returns six Venti lattes and
 * the old matcher's tie went to whichever was listed first (Matcha). The book must hold all six,
 * accents intact, so the model can choose the plain one.
 */
import { describe, expect, it } from 'vitest';
import type { FanOutResult } from './food-source-fanout.ts';
import type { FoodSourceName, SourceCandidate } from './food-source-report.ts';
import {
  BOOK_BUDGET_CHARS,
  CandidateBook,
  MAX_PARTS,
  describedParts,
  SHOW_PER_LOOKUP,
  addLookups,
  checkPick,
  cutAtWord,
  dealBySource,
  distinctRecords,
  matchBookMeasure,
  partsToLookups,
  splitMealParts,
  stripAmount,
  withFatSecretRows,
} from './food-candidate-book.ts';
import { withWebRows } from './food-check.ts';

function candidate(over: Partial<SourceCandidate> & { name: string }): SourceCandidate {
  return {
    source: 'ledger',
    food_id: `id-${over.name.toLowerCase().replace(/\W+/g, '-')}`,
    brand: null,
    per: { measure: '100 g', grams: 100, nutrients: { kcal: 42, protein_g: 2.7, carbs_g: 4, fat_g: 1.5 } },
    measures: [{ label: '100 g', grams: 100 }],
    micros: 'none',
    completeness: 'full',
    notes: [],
    ...over,
  };
}

function found(candidates: SourceCandidate[], disagreements: string[] = []): FanOutResult {
  return {
    query: 'x',
    brand: null,
    requested_measure: null,
    candidates,
    sources_checked: [{ source: 'ledger', status: candidates.length ? 'hit' : 'miss', ms: 3, detail: '' }],
    disagreements,
  };
}

describe('splitMealParts — separators a person actually types', () => {
  it.each([
    ['150ml 2% mulk', ['150ml 2% mulk']],
    ['1.5 c milk\n2 shots espresso', ['1.5 c milk', '2 shots espresso']],
    ['coffee with cream', ['coffee', 'cream']],
    ['eggs, toast and butter', ['eggs', 'toast', 'butter']],
    ['1 cup coconut milk beverage, unsweetened', ['1 cup coconut milk beverage', 'unsweetened']],
    ['Starbucks venti latte', ['Starbucks venti latte']],
    ['a sandwich', ['a sandwich']],
    ['peanut butter & jam on toast', ['peanut butter', 'jam on toast']],
    // Sentences are parts: dictation writes "…inch. Eggplant pickles. Some mayo." (2026-11-02, the
    // read took "sliced on it. Pickled eggplant" as one food and "mayo. I also had one pint" as another).
    [
      'roast beef maybe a 1/2 inch. Eggplant pickles. Some mayo. Red pepper.',
      ['roast beef maybe a 1/2 inch', 'Eggplant pickles', 'Some mayo', 'Red pepper'],
    ],
    ['150ml milk. 1 shot espresso', ['150ml milk', '1 shot espresso']],
    // "I had" says they ate it, not what it was; the dash hanging off "sandwich-" is not food either.
    [
      'I had a sandwich on focaccia, sliced on it. Pickled eggplant. I also had one pint of Rickards red.',
      ['a sandwich on focaccia', 'sliced on it', 'Pickled eggplant', 'one pint of Rickards red'],
    ],
    ['Square foccacia sandwich- with roast beef', ['Square foccacia sandwich', 'roast beef']],
    ['then I ate an apple', ['an apple']],
    // Near-misses: a decimal, an abbreviation, a lowercase continuation and a word that merely
    // starts with a verb are not sentence ends and not "I had".
    ['one 0.0 guinness', ['one 0.0 guinness']],
    ['1.5 c milk', ['1.5 c milk']],
    ['2 oz. Cheddar', ['2 oz. Cheddar']],
    ['a Dr. Pepper', ['a Dr. Pepper']],
    ['some mayo. red pepper', ['some mayo. red pepper']],
    ["hadji's hummus", ["hadji's hummus"]],
    ['I had', ['I had']],
  ])('%j → %j', (text, parts) => {
    expect(splitMealParts(text)).toEqual(parts);
  });

  it('dictated prose with no separators stays one part (the second call catches it)', () => {
    expect(splitMealParts('Quarter cup of frozen blueberries quarter cup of frozen strawberries')).toHaveLength(1);
  });

  it('never splits a word that merely contains a separator word', () => {
    // "sandwich" holds "and"; "withers" holds "with". Word boundaries keep them whole.
    expect(splitMealParts('a sandwich')).toEqual(['a sandwich']);
    expect(splitMealParts('bitter withers tea')).toEqual(['bitter withers tea']);
  });

  it('caps the parts, and blank text yields nothing', () => {
    expect(splitMealParts(Array.from({ length: 14 }, (_, i) => `food${i}`).join(', '))).toHaveLength(10);
    expect(splitMealParts('   ')).toEqual([]);
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
    // The pinned case: a menu size is part of the food's name, never an amount.
    ['Starbucks venti latte', 'Starbucks venti latte', null],
    ['a venti latte from Starbucks', 'venti latte from Starbucks', null],
    ['2 Starbucks venti lattes', 'Starbucks venti lattes', '2'],
    ["siggi's creamy skyr plain", "siggi's creamy skyr plain", null],
    ['2 Roma tomatoes', 'Roma tomatoes', '2'],
    // Near-misses: a word that starts like a unit is not one.
    ['large eggs', 'eggs', 'large'],
    ['cereal', 'cereal', null],
    ['granola', 'granola', null],
    // Near-misses: a food that starts like a number word keeps its first letter (2026-11-01:
    // "avocado toast" was looked up as "vocado toast", "an apple" as "n apple").
    ['avocado toast', 'avocado toast', null],
    ['apple', 'apple', null],
    ['almonds', 'almonds', null],
    ['acai bowl', 'acai bowl', null],
    ['onion rings', 'onion rings', null],
    ['halfmoon cookie', 'halfmoon cookie', null],
    ['an apple', 'apple', null],
    ['an egg', 'egg', null],
    // A longer number phrase is taken whole, not as "a" + the rest.
    ['a few eggs', 'eggs', null],
    ['a splash of milk', 'milk', null],
    // Zero is never an amount: "0.0 guinness" names the non-alcoholic one (2026-11-02, looked up
    // as "guinness at 0.0" and logged as 0.0 servings of a Red Robin row). A non-zero decimal still is.
    ['0.0 guinness', '0.0 guinness', null],
    ['0 guinness', '0 guinness', null],
    ['one 0.0 guinness', '0.0 guinness', null],
    ['0.5 cup oats', 'oats', '0.5 cup'],
  ])('%j → q %j, measure %j', (part, q, measure) => {
    expect(stripAmount(part)).toEqual({ q, measure });
  });

  it('never strips a part down to nothing', () => {
    expect(stripAmount('2 large')).toEqual({ q: '2 large', measure: null });
  });
});

describe('cutAtWord — a long part is cut at a word, never through one', () => {
  it('cuts at the last space inside the limit ("roast bee" was looked up as a typo, 2026-11-02)', () => {
    const prose = 'I had a sandwich on a square not rectangle focaccia having an inch of sliced roast beef';
    expect(cutAtWord(prose, 80)).toBe('I had a sandwich on a square not rectangle focaccia having an inch of sliced');
    expect(cutAtWord('a banana', 80)).toBe('a banana');
    expect(cutAtWord('a'.repeat(90), 80)).toBe('a'.repeat(80));
  });
  it('the lookup for a long part is cut the same way', () => {
    const [l] = partsToLookups(
      'a sandwich on a square not rectangle focaccia having an inch of thinly sliced roast beef',
    );
    expect(l?.q).toBe('sandwich on a square not rectangle focaccia having an inch of thinly sliced');
  });
});

describe('describedParts — what the split left out is said, never dropped in silence', () => {
  it('reads at most MAX_PARTS and names each part past the cap, with the rule', () => {
    const words = Array.from({ length: 12 }, (_, i) => `food${i + 1}`).join(', ');
    const { lookups, not_read } = describedParts(words);
    expect(lookups).toHaveLength(MAX_PARTS);
    expect(lookups.map((l) => l.q)).toEqual(Array.from({ length: MAX_PARTS }, (_, i) => `food${i + 1}`));
    expect(not_read).toEqual([
      '"food11" not read — the read takes at most 10 parts',
      '"food12" not read — the read takes at most 10 parts',
    ]);
  });

  it('a part said twice is looked up once, and the line says so', () => {
    const { lookups, not_read } = describedParts('a latte, a latte');
    expect(lookups).toHaveLength(1);
    expect(not_read).toEqual(['"latte" said twice, read once']);
  });

  it('the same food under two amounts is one lookup too — the amount is not the part', () => {
    const { lookups, not_read } = describedParts('2 eggs, 3 eggs, 2 eggs');
    expect(lookups).toHaveLength(1);
    expect(lookups[0]).toMatchObject({ said: '2 eggs', q: 'eggs', measure: '2' });
    expect(not_read).toEqual(['"eggs" said 3 times, read once']);
  });

  it('near-miss: distinct parts within the cap leave nothing out', () => {
    expect(describedParts('milk and a banana').not_read).toEqual([]);
    expect(describedParts('a sandwich').not_read).toEqual([]);
  });
});

describe('partsToLookups', () => {
  it('one lookup per distinct part, amount as the measure, their words kept as said', () => {
    expect(partsToLookups('1.5 c milk\n2 shots espresso')).toEqual([
      { said: '1.5 c milk', q: 'milk', measure: '1.5 c', brand: null },
      { said: '2 shots espresso', q: 'espresso', measure: '2 shots', brand: null },
    ]);
  });
  it('the same food twice is looked up once', () => {
    expect(partsToLookups('milk, milk')).toHaveLength(1);
  });
});

describe('CandidateBook — every record found, none dropped, ids stable', () => {
  const ventiRows = [
    'Caffè Latte (Venti)',
    'Matcha Tea Latte (Venti)',
    'Chai Tea Latte (Venti)',
    'Lavender Latte (Venti)',
    'Pistachio Latte (Venti)',
    'Cinnamon Dolce Latte (Venti)',
  ].map((name) =>
    candidate({ name, brand: 'Starbucks', source: 'fatsecret', measures: [{ label: '1 venti', grams: 591 }] }),
  );

  it('holds all six Venti lattes, in order, accents intact (#426)', () => {
    const book = new CandidateBook();
    book.add({ q: 'Starbucks venti latte', measure: null, brand: null }, found(ventiRows));
    expect([...book.entries.values()].map((e) => e.name)).toEqual(ventiRows.map((r) => r.name));
    expect(book.entries.get('c1')?.name).toBe('Caffè Latte (Venti)');
    expect(book.text()).toContain('c1 · fatsecret · Caffè Latte (Venti) (Starbucks)');
    expect(book.text()).toContain('c2 · fatsecret · Matcha Tea Latte (Venti)');
  });

  it('the same record seen under two lookups keeps its first id', () => {
    const book = new CandidateBook();
    const milk = candidate({ name: 'Milk, 2%' });
    book.add({ q: 'milk', measure: null, brand: null }, found([milk]));
    book.add({ q: '2% milk', measure: null, brand: null }, found([milk, candidate({ name: 'Milk, whole' })]));
    expect(book.entries.size).toBe(2);
    expect(book.sections[1]?.entryIds).toEqual(['c1', 'c2']);
  });

  it('marks a record with no usable calories incomplete, and keeps it', () => {
    const book = new CandidateBook();
    book.add(
      { q: 'latte', measure: null, brand: null },
      found([candidate({ name: 'Cafe Latte', per: { measure: '1 drink', grams: 300, nutrients: { kcal: 0 } } })]),
    );
    expect(book.entries.get('c1')?.incomplete).toBe(true);
    expect(book.text()).toContain('incomplete: no usable calories');
  });

  it('a lookup that found nothing says so, and disagreements are carried', () => {
    const book = new CandidateBook();
    book.add({ q: 'zzq-nothing', measure: null, brand: null }, found([]));
    book.add(
      { q: 'rice', measure: '1 cup', brand: null },
      found([candidate({ name: 'Rice, cooked' })], ['Calories differ by more than a quarter']),
    );
    expect(book.text()).toContain('Lookup "zzq-nothing":\n  no records on file');
    expect(book.text()).toContain('Lookup "rice" at 1 cup:');
    expect(book.text()).toContain('where they disagree: Calories differ');
  });

  it('addLookups asks every part at once and adds answers in the parts order', async () => {
    const book = new CandidateBook();
    const order: string[] = [];
    await addLookups(
      book,
      [
        { q: 'b', measure: null, brand: null },
        { q: 'a', measure: null, brand: null },
      ],
      async (l) => {
        order.push(l.q);
        return found([candidate({ name: `Food ${l.q}` })]);
      },
    );
    expect(order).toEqual(['b', 'a']);
    expect(book.sections.map((s) => s.lookup.q)).toEqual(['b', 'a']);
  });

  it('withFatSecretRows appends the rows the fan-out did not already hold', () => {
    const base = found([candidate({ name: 'Caffè Latte (Venti)', source: 'fatsecret', food_id: 'fs-1' })]);
    const rows = [
      candidate({ name: 'Caffè Latte (Venti)', source: 'fatsecret', food_id: 'fs-1' }),
      candidate({ name: 'Matcha', source: 'fatsecret', food_id: 'fs-2' }),
    ];
    expect(withFatSecretRows(base, rows).candidates.map((c) => c.food_id)).toEqual(['fs-1', 'fs-2']);
  });
});

/**
 * A lookup's rows are dealt round-robin by source before the first SHOW_PER_LOOKUP are shown.
 * Until 2026-11-03 the book took the first eight in source order — ledger, then USDA, then
 * FatSecret — so whenever the ledger answered with eight rows (as it did for "one pint of
 * Rickards red": one real row and seven pinto-bean rows) no USDA or FatSecret row was ever shown.
 * The deal ranks nothing: the sources keep the order they first appear in, each source keeps its
 * own order, and the first eight of the deal hold every source's first rows.
 */
describe("CandidateBook — the shown rows are dealt round-robin by source, never one source's first eight", () => {
  const rows = (source: FoodSourceName, prefix: string, n: number): SourceCandidate[] =>
    Array.from({ length: n }, (_, i) =>
      candidate({ name: `${prefix}${i}`, source, food_id: `${source}-${prefix}-${i}` }),
    );
  const names = (cs: SourceCandidate[]): string[] => cs.map((c) => c.name);
  const ledger8 = rows('ledger', 'L', 8);
  const usda2 = rows('usda', 'U', 2);
  const fatsecret2 = rows('fatsecret', 'F', 2);
  const lookup = { q: 'pint of Rickards red', measure: null, brand: null };

  describe('dealBySource', () => {
    it.each<[string, SourceCandidate[], string[]]>([
      ['nothing stays nothing', [], []],
      ['one source is unchanged', rows('ledger', 'L', 3), ['L0', 'L1', 'L2']],
      [
        'the first row of every source, then the second, then the rest of the longest',
        [...ledger8, ...usda2, ...fatsecret2],
        ['L0', 'U0', 'F0', 'L1', 'U1', 'F1', 'L2', 'L3', 'L4', 'L5', 'L6', 'L7'],
      ],
      [
        'a source with more rows fills the tail, in its own order',
        [...rows('usda', 'U', 1), ...rows('fatsecret', 'F', 3)],
        ['U0', 'F0', 'F1', 'F2'],
      ],
      // The sources keep the order they first appear in: a row put in front (the web's) is dealt first.
      [
        'the source in front is dealt first',
        [...rows('research', 'R', 1), ...rows('ledger', 'L', 2)],
        ['R0', 'L0', 'L1'],
      ],
      // Near-miss: a result that is already interleaved is left as it is — nothing is reordered within a source.
      [
        'an interleaved result is unchanged',
        [ledger8[0]!, usda2[0]!, ledger8[1]!, usda2[1]!],
        ['L0', 'U0', 'L1', 'U1'],
      ],
    ])('%s', (_label, input, expected) => {
      expect(names(dealBySource(input))).toEqual(expected);
    });

    it("keeps each source's own order: the ledger's phrase rows stay ahead of its by-word rows", () => {
      // searchLedger (food-source-fanout.ts) puts the phrase's own rows first, then the by-word rows.
      const phrase = rows('ledger', 'phrase ', 2);
      const byWord = rows('ledger', 'by-word ', 2);
      const dealt = names(dealBySource([...phrase, ...byWord, ...usda2]));
      expect(dealt).toEqual(['phrase 0', 'U0', 'phrase 1', 'U1', 'by-word 0', 'by-word 1']);
      expect(dealt.indexOf('by-word 0')).toBeGreaterThan(dealt.indexOf('phrase 1'));
    });
  });

  it("eight ledger rows plus two USDA and two FatSecret rows: the shown eight hold each source's first rows", () => {
    const book = new CandidateBook();
    const section = book.add(lookup, found([...ledger8, ...usda2, ...fatsecret2]));
    expect(section.entryIds).toHaveLength(SHOW_PER_LOOKUP);
    expect(section.entryIds.map((id) => book.entries.get(id)!.name)).toEqual([
      'L0',
      'U0',
      'F0',
      'L1',
      'U1',
      'F1',
      'L2',
      'L3',
    ]);
    const text = book.text();
    for (const shown of ['U0', 'U1', 'F0', 'F1', 'L0', 'L3']) expect(text).toContain(` · ${shown} · `);
    // What the old slice would have shown instead — the ledger's fifth to eighth rows — is held back.
    for (const hidden of ['L4', 'L5', 'L6', 'L7']) expect(text).not.toContain(` · ${hidden} · `);
    expect(book.shown().size).toBe(SHOW_PER_LOOKUP);
    // The ids follow the deal, so the model's c1…c8 are the lines in the order it reads them.
    expect(section.entryIds).toEqual(['c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7', 'c8']);
  });

  it('a single-source result is unchanged: the first eight, in order', () => {
    const book = new CandidateBook();
    const section = book.add(lookup, found(rows('ledger', 'L', 10)));
    expect(section.entryIds.map((id) => book.entries.get(id)!.name)).toEqual([
      'L0',
      'L1',
      'L2',
      'L3',
      'L4',
      'L5',
      'L6',
      'L7',
    ]);
    expect(book.entries.size).toBe(SHOW_PER_LOOKUP);
  });

  it('a record seen twice still keeps its first id, wherever the deal puts it the second time', () => {
    const book = new CandidateBook();
    const milk = candidate({ name: 'Milk, 2%' });
    book.add({ q: 'milk', measure: null, brand: null }, found([milk]));
    // The second lookup's result has a USDA row in front, so the deal puts the USDA row first and the milk second.
    book.add(
      { q: '2% milk', measure: null, brand: null },
      found([candidate({ name: 'Milk, reduced fat', source: 'usda' }), milk, candidate({ name: 'Milk, whole' })]),
    );
    expect(book.entries.size).toBe(3);
    expect(book.sections[1]?.entryIds).toEqual(['c2', 'c1', 'c3']);
    expect(book.entries.get('c1')?.name).toBe('Milk, 2%');
  });

  it("the web's row (withWebRows, food-check.ts) is still the first line of its section after the deal", () => {
    const web = candidate({ name: "Rickard's Red Beer", brand: 'Molson Coors', source: 'research', food_id: 'r-1' });
    const base = found([...ledger8, ...usda2, ...fatsecret2]);
    const merged = withWebRows(base, { rows: [web], check: { source: 'research', status: 'hit', ms: 0, detail: '' } });
    const book = new CandidateBook();
    const section = book.add({ q: 'Red', measure: '1 pint', brand: "Rickard's" }, merged);
    expect(section.entryIds[0]).toBe('c1');
    expect(book.entries.get('c1')?.name).toBe("Rickard's Red Beer");
    expect(section.lines[0]).toContain("c1 · research · Rickard's Red Beer (Molson Coors)");
    expect(section.entryIds.map((id) => book.entries.get(id)!.name)).toEqual([
      "Rickard's Red Beer",
      'L0',
      'U0',
      'F0',
      'L1',
      'U1',
      'F1',
      'L2',
    ]);
  });

  it("near-miss: the deal does not favour the web's source — a research row at the end of a result is dealt in its turn", () => {
    const late = candidate({ name: 'Late web row', source: 'research', food_id: 'r-2' });
    expect(names(dealBySource([...ledger8, ...usda2, ...fatsecret2, late]))).toEqual([
      'L0',
      'U0',
      'F0',
      'Late web row',
      'L1',
      'U1',
      'F1',
      'L2',
      'L3',
      'L4',
      'L5',
      'L6',
      'L7',
    ]);
  });

  describe('distinctRecords — a stored record two sources both returned is shown once', () => {
    const stored = (source: FoodSourceName, name: string, food_id: string): SourceCandidate =>
      candidate({ name, source, food_id });
    it.each<[string, SourceCandidate[], Array<[string, string]>]>([
      ['nothing stays nothing', [], []],
      [
        "FatSecret's fresh copy of a ledger row is the same food_id: the ledger's row stays, with its label",
        [stored('ledger', 'Banana', 'f-1'), stored('fatsecret', 'Banana', 'f-1')],
        [['ledger', 'Banana']],
      ],
      [
        'the first occurrence keeps its place, whichever source it came from',
        [
          stored('fatsecret', 'Espresso (Solo)', 'f-2'),
          stored('ledger', 'Espresso (Solo)', 'f-2'),
          stored('ledger', 'Espresso', 'f-3'),
        ],
        [
          ['fatsecret', 'Espresso (Solo)'],
          ['ledger', 'Espresso'],
        ],
      ],
      // Near-misses: the same name under two food_ids is two records; the same food_id under two names is one.
      [
        'two records that share a name are both kept',
        [stored('ledger', 'Banana', 'f-1'), stored('fatsecret', 'Banana', 'f-9')],
        [
          ['ledger', 'Banana'],
          ['fatsecret', 'Banana'],
        ],
      ],
      [
        'one record under two names is one',
        [stored('ledger', 'Bananas', 'f-1'), stored('usda', 'Banana, raw', 'f-1')],
        [['ledger', 'Bananas']],
      ],
      [
        'a transient record (no food_id) is kept once per source, name and brand',
        [
          candidate({ name: 'Red Ale', source: 'research', food_id: null }),
          candidate({ name: 'Red Ale', source: 'research', food_id: null }),
          candidate({ name: 'Red Ale', source: 'research', food_id: null, brand: "Rickard's" }),
          stored('ledger', 'Red Ale', 'f-4'),
        ],
        [
          ['research', 'Red Ale'],
          ['research', 'Red Ale'],
          ['ledger', 'Red Ale'],
        ],
      ],
    ])('%s', (_label, input, expected) => {
      expect(distinctRecords(input).map((c) => [c.source, c.name])).toEqual(expected);
    });

    it('"one 0.0 guinness" (2026-11-03): with the copies gone, the ledger\'s by-word row is in the eight again', () => {
      // The ledger: five chain rows the phrase found, then what the word "guinness" found (searchLedger).
      const chains = ['Malta Guinness', 'Guinness (Can)', 'Guinness (Bottled)', 'Guinness - 14 oz', 'Guinness Draught'];
      const ledger = [
        ...chains.map((n, i) => stored('ledger', n, `chain-${i}`)),
        stored('ledger', 'Guinness 0, Non-Alcoholic Draught', 'own-1'),
        stored('ledger', 'Guinness Extra Stout', 'cnf-1'),
        stored('ledger', 'Guinness Blonde', 'cnf-2'),
      ];
      // FatSecret's five: four are the chain rows the ledger already holds, one is new.
      const fatsecret = [
        ...chains.slice(0, 4).map((n, i) => stored('fatsecret', n, `chain-${i}`)),
        stored('fatsecret', 'Guinness Draught - Pitcher', 'chain-9'),
      ];
      const book = new CandidateBook();
      const section = book.add({ q: '0.0 guinness', measure: null, brand: null }, found([...ledger, ...fatsecret]));
      const names = section.entryIds.map((id) => book.entries.get(id)!.name);
      expect(names).toHaveLength(SHOW_PER_LOOKUP);
      expect(names).toContain('Guinness 0, Non-Alcoholic Draught');
      expect(names).toContain('Guinness Draught - Pitcher');
      expect(new Set(section.entryIds.map((id) => book.entries.get(id)!.food_id)).size).toBe(SHOW_PER_LOOKUP);
      // Without the dedup the deal gave FatSecret's four copies four slots and the Non-Alcoholic row none.
      const dealtWithCopies = dealBySource([...ledger, ...fatsecret])
        .slice(0, SHOW_PER_LOOKUP)
        .map((c) => c.name);
      expect(dealtWithCopies).not.toContain('Guinness 0, Non-Alcoholic Draught');
    });
  });

  it("text()'s budget cut now keeps each source's first rows too, not one source's first three", () => {
    const book = new CandidateBook();
    const section = book.add(lookup, found([...ledger8, ...usda2, ...fatsecret2]));
    // Room for the head, the cut note and about three record lines.
    const budget = 110 + section.head.length + 3 * (section.lines[0]!.length + 1) + 20;
    const [head, ...lines] = book.text(budget).split('\n');
    expect(head).toContain('more records not shown for room');
    expect(lines.length).toBeGreaterThanOrEqual(2);
    expect(lines.length).toBeLessThan(SHOW_PER_LOOKUP);
    const dealt = ['L0', 'U0', 'F0', 'L1', 'U1', 'F1', 'L2', 'L3'];
    expect(lines.map((l) => l.split(' · ')[2])).toEqual(dealt.slice(0, lines.length));
  });
});

/**
 * The book has a budget of its own (from the token bar, BOOK_BUDGET_CHARS) and fits itself to
 * it: a long meal loses every part's last rows before any part loses its first, and says so.
 */
describe('CandidateBook — fits its budget, round-robin by part, the cut announced', () => {
  const notes = [
    'Micronutrients come from a printed label, so an absent one is unknown, not zero.',
    'Estimated (llm), not measured — prefer a lab-analysed source if one agrees.',
  ];
  const bigBook = (): CandidateBook => {
    const book = new CandidateBook();
    for (let p = 0; p < MAX_PARTS; p += 1) {
      book.add(
        { q: `part ${p}`, measure: '1 cup', brand: null },
        found(
          Array.from({ length: SHOW_PER_LOOKUP }, (_, r) =>
            candidate({
              name: `Part ${p} record ${r}, a long descriptive name as the sources write them`,
              brand: 'Some Brand Name',
              source: r % 2 ? 'fatsecret' : 'usda',
              food_id: `id-${p}-${r}`,
              measures: [
                { label: '1 cup (240g)', grams: 240 },
                { label: '1 tbsp (15g)', grams: 15 },
                { label: '100 g', grams: 100 },
              ],
              notes,
            }),
          ),
          ['Calories differ by more than a quarter per 100 g: usda says ~40, fatsecret says ~90.'],
        ),
      );
    }
    return book;
  };

  it('a ten-part, eight-record book stays within the budget; every part keeps its first rows', () => {
    const book = bigBook();
    const text = book.text();
    expect(book.entries.size).toBe(MAX_PARTS * SHOW_PER_LOOKUP);
    expect(text.length).toBeLessThanOrEqual(BOOK_BUDGET_CHARS);
    // Well inside the engine's own cap on a job variable (40,000 since #454), so nothing is cut there.
    expect(text.length).toBeLessThan(40_000);
    const rows = book.sections.map((s) => s.lines.length - s.omitted);
    // Every part shows at least its first row, and no part shows two rows more than another.
    expect(Math.min(...rows)).toBeGreaterThanOrEqual(1);
    expect(Math.max(...rows) - Math.min(...rows)).toBeLessThanOrEqual(1);
    expect(rows.reduce((a, b) => a + b, 0)).toBeLessThan(book.entries.size);
  });

  it('a part that had rows held back says so in its head, in words the model can act on', () => {
    const book = bigBook();
    const text = book.text();
    expect(text).toMatch(
      /^Lookup "part 0" at 1 cup: \(\d+ more records not shown for room; if none here fits, ask for a lookup with narrower words\)$/m,
    );
    expect(text).toMatch(/^Lookup "part 9" at 1 cup: \(\d+ more records? not shown for room/m);
    expect(book.sections[0]?.omitted).toBeGreaterThan(0);
  });

  it('what the model could pick from is what was rendered: a held-back record is refused as not shown', () => {
    const book = bigBook();
    book.text();
    const shown = book.shown();
    expect(shown.size).toBe(book.sections.reduce((n, s) => n + s.lines.length - s.omitted, 0));
    const hidden = [...book.entries.keys()].find((id) => !shown.has(id))!;
    const r = checkPick({ pick: hidden, measure: '100 g', count: 1 }, book);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.problem).toBe(`pick "${hidden}" was not shown in the book`);
    const first = book.sections[0]!.entryIds[0]!;
    expect(checkPick({ pick: first, measure: '100 g', count: 1 }, book)).toMatchObject({ ok: true, grams: 100 });
  });

  it('a small book is not cut, announces nothing, and shows every record', () => {
    const book = new CandidateBook();
    book.add({ q: 'banana', measure: null, brand: null }, found([candidate({ name: 'Banana, raw' })]));
    book.add({ q: 'zzq-nothing', measure: null, brand: null }, found([]));
    const text = book.text();
    expect(text).not.toContain('not shown for room');
    expect(text).toContain('Lookup "zzq-nothing":\n  no records on file');
    expect(book.sections.every((s) => s.omitted === 0)).toBe(true);
    expect(book.shown().size).toBe(book.entries.size);
  });

  it("disagreement notes come after every part's rows, and go before any row when room runs out", () => {
    const book = new CandidateBook();
    book.add(
      { q: 'rice', measure: null, brand: null },
      found([candidate({ name: 'Rice A' }), candidate({ name: 'Rice B' })], ['rice differs']),
    );
    book.add(
      { q: 'beans', measure: null, brand: null },
      found([candidate({ name: 'Beans A' }), candidate({ name: 'Beans B' })], ['beans differ']),
    );
    const full = book.text(100_000);
    const at = (s: string) => full.indexOf(s);
    expect(at('Rice A')).toBeLessThan(at('Rice B'));
    expect(at('Rice B')).toBeLessThan(at('where they disagree: rice differs'));
    expect(at('where they disagree: rice differs')).toBeLessThan(at('Lookup "beans"'));
    expect(at('Beans B')).toBeLessThan(at('where they disagree: beans differ'));

    // Room for every row but not for the notes: the rows stay, the notes go.
    const notes = '  where they disagree: rice differs\n'.length + '  where they disagree: beans differ\n'.length;
    const tight = book.text(full.length + 2 * 110 - notes + 1);
    expect(tight).toContain('Rice B');
    expect(tight).toContain('Beans B');
    expect(tight).not.toContain('where they disagree');
    expect(book.sections.every((s) => s.omitted === 0)).toBe(true);
  });

  it('a smaller budget renders fewer rows and the entries stay; re-rendering with room shows them again', () => {
    const book = bigBook();
    const small = book.text(2_000);
    expect(small.length).toBeLessThanOrEqual(2_000);
    expect(book.shown().size).toBeLessThan(book.entries.size);
    const full = book.text(1_000_000);
    expect(full).not.toContain('not shown for room');
    expect(book.shown().size).toBe(book.entries.size);
  });
});

/**
 * A food kept per item — every food the old parse-meal path pinned ("1 serving = 1") — has no
 * per-100 g numbers. Printed that way it read 25,000 kcal and raised a false disagreement.
 */
describe('CandidateBook — a food kept per item is printed per its own measure', () => {
  const pinned = candidate({
    name: 'Yogurt parfait',
    source: 'ledger',
    base_unit: 'item',
    per: { measure: '1 serving', grams: 1, nutrients: { kcal: 250, protein_g: 12, carbs_g: 30, fat_g: 9 } },
    measures: [{ label: '1 serving', grams: 1 }],
  });
  const usda = candidate({ name: 'Yogurt, Greek, plain', source: 'usda' });

  it('says "per 1 serving", lists its measures without grams, and never multiplies a count by 100', () => {
    const book = new CandidateBook();
    book.add({ q: 'yogurt parfait', measure: null, brand: null }, found([pinned, usda]));
    const text = book.text();
    expect(text).toContain(
      'c1 · ledger · Yogurt parfait · per 1 serving: 250.0 kcal, 12.0 g protein, 30.0 g carbs, 9.0 g fat',
    );
    expect(text).toContain('measures: 1 serving · kept per item, not by weight');
    expect(text).not.toContain('25000');
    expect(text).toContain('c2 · usda · Yogurt, Greek, plain · per 100 g: 42.0 kcal');
  });

  it('a pick of it prices by count of the measure', () => {
    const book = new CandidateBook();
    book.add({ q: 'yogurt parfait', measure: null, brand: null }, found([pinned]));
    expect(checkPick({ pick: 'c1', measure: '1 serving', count: 2 }, book)).toMatchObject({ ok: true, grams: 2 });
    expect(book.entries.get('c1')?.per_g.kcal).toBe(250);
  });
});

describe('matchBookMeasure — exact, then without brackets, then one unambiguous prefix', () => {
  const ms = [
    { label: '1 medium (118g)', grams: 118 },
    { label: '1 cup, sliced', grams: 150 },
    { label: '1 coffee cup (6 fl oz)', grams: 177 },
    { label: '1 mug (8 fl oz)', grams: 237 },
  ];
  it.each([
    ['1 medium (118g)', '1 medium (118g)'],
    ['1 medium', '1 medium (118g)'],
    ['1 medium = 118.0 g', '1 medium (118g)'],
    ['1 cup, sliced', '1 cup, sliced'],
    ['1 coffee cup', '1 coffee cup (6 fl oz)'],
    // One label starts with it: taken. Two do: refused, never a guess.
    ['1 cup', '1 cup, sliced'],
    ['1 c', null],
    ['1 m', null],
    ['1 tbsp', null],
    ['', null],
  ])('%j → %j', (wanted, label) => {
    expect(matchBookMeasure(ms, wanted)?.label ?? null).toBe(label);
  });
});

describe('checkPick — only what was shown, only measures the record offers', () => {
  const book = new CandidateBook();
  book.add(
    { q: 'banana', measure: null, brand: null },
    found([
      candidate({ name: 'Banana, raw', measures: [{ label: '1 medium (118g)', grams: 118 }] }),
      candidate({ name: 'Banana chips', food_id: null, source: 'research' }),
    ]),
  );

  it('a shown id with an offered measure prices by that measure times the count', () => {
    const r = checkPick({ pick: 'c1', measure: '1 medium', count: 2 }, book);
    expect(r).toMatchObject({ ok: true, grams: 236, count: 2 });
  });
  it('grams are always offered', () => {
    expect(checkPick({ pick: 'c1', measure: 'g', count: 80 }, book)).toMatchObject({ ok: true, grams: 80 });
  });
  it('a missing count reads as one; zero or less is refused with the reason (2026-11-02: "0.0 servings" shown as 1)', () => {
    expect(checkPick({ pick: 'c1', measure: '1 medium', count: null }, book)).toMatchObject({ ok: true, grams: 118 });
    for (const count of [0, -3]) {
      const r = checkPick({ pick: 'c1', measure: '1 medium', count }, book);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.problem).toMatch(/count -?\d+ is not an amount/);
    }
  });
  it.each([
    [{ pick: 'c9', measure: '1 medium', count: 1 }, /not an id in the book/],
    [{ pick: 'c1', measure: '1 cup', count: 1 }, /not one c1 offers; it offers: 1 medium \(118g\); 100 g/],
    [{ pick: 'c2', measure: '100 g', count: 1 }, /not a stored record/],
  ])('%j is refused with the reason as evidence', (pick, reason) => {
    const r = checkPick(pick, book);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.problem).toMatch(reason);
  });
});
