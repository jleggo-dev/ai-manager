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
import type { SourceCandidate } from './food-source-report.ts';
import {
  BOOK_BUDGET_CHARS,
  CandidateBook,
  MAX_PARTS,
  describedParts,
  SHOW_PER_LOOKUP,
  addLookups,
  checkPick,
  matchBookMeasure,
  partsToLookups,
  splitMealParts,
  stripAmount,
  withFatSecretRows,
} from './food-candidate-book.ts';

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
  ])('%j → q %j, measure %j', (part, q, measure) => {
    expect(stripAmount(part)).toEqual({ q, measure });
  });

  it('never strips a part down to nothing', () => {
    expect(stripAmount('2 large')).toEqual({ q: '2 large', measure: null });
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
  it('a missing or bad count reads as one', () => {
    expect(checkPick({ pick: 'c1', measure: '1 medium', count: null }, book)).toMatchObject({ ok: true, grams: 118 });
    expect(checkPick({ pick: 'c1', measure: '1 medium', count: -3 }, book)).toMatchObject({ ok: true, grams: 118 });
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
