/**
 * `resolveHereRank` — the coach's heard words ("I'm on the Hungarian folk song") turned into the
 * one row the seed review pre-marks, or into nothing.
 *
 * It lives here, server-side, for the reason CLAUDE.md gives: a matcher that decides behaviour
 * lives once. It first shipped in the browser, and that was a second spelling of "does this phrase
 * name this piece" beside `normTitle`/`compactTitle` and `repertoire-match.ts` — which is the drift
 * that never throws and simply files the wrong thing. "It only PRE-marks" is not a defence: people
 * confirm what they are shown, so the pre-mark is what gets written.
 *
 * The rule the table below is really about is the LAST one. Suzuki Book 2 prints four minuets in
 * G, and "minuet in g" names a family rather than a piece. The coach may not invent a distinction
 * between two titles, so an ambiguous phrase resolves to null and becomes the person's own tap.
 * Erring that way costs one tap; erring the other way silently files sixty standings off a phrase
 * nobody confirmed.
 */
import { describe, it, expect } from 'vitest';
import { resolveHereRank } from './repertoire-seed.ts';

/** The book the design frame is written about, with the twins that make the rule necessary. */
const BOOK = [
  'Écossaise',
  'Long, Long Ago',
  'The Happy Farmer',
  'Minuet in G Major, BWV Anh. 114',
  'Minuet in G Minor, BWV Anh. 115',
  'Minuet in G Major, BWV Anh. 116',
  'Hungarian Folk Song',
  'Chanson',
].map((label, i) => ({ label, rank: i + 1 }));

describe('resolveHereRank — her heard split, or none at all', () => {
  const table: Array<[string, string | null | undefined, number | null]> = [
    // Their own words, exactly and loosely — the ordinary case the door exists for.
    ['the title as printed', 'Hungarian Folk Song', 7],
    ['lower case, as typed in chat', 'hungarian folk song', 7],
    ['their shorthand for it', 'the hungarian folk song', 7],
    ['a fragment that names one row', 'hungarian', 7],
    // Accents fold both ways — the scar `foldAccents` was written around: an unfolded "Écossaise"
    // reduced to "cossaise", so a typed "Ecossaise" matched nothing and the piece went unstamped.
    ['an accent she dropped', 'ecossaise', 1],
    ['an accent she kept', 'Écossaise', 1],
    // Punctuation is not identity — "Long, Long Ago" and "long long ago" are one piece.
    ['punctuation she left out', 'long long ago', 2],
    // Word boundaries are not identity either: compactTitle is why a run-together spelling lands.
    ['a boundary she lost', 'longlongago', 2],
    // A phrase that fits several rows names none of them. This is the ruling, as a row.
    ['a phrase three pieces answer to', 'minuet in g', null],
    ['a phrase two pieces answer to', 'minuet in g major, bwv anh. 11', null],
    // …and the qualifier that separates them still works.
    ['the same phrase, qualified', 'minuet in g minor', 5],
    ['the whole title of one twin', 'Minuet in G Major, BWV Anh. 116', 6],
    // Nothing said, nothing marked. She may leave it out and the screen must not guess.
    ['nothing said at all', null, null],
    ['nothing said at all, undefined', undefined, null],
    ['blank space', '   ', null],
    // A needle too short to be evidence: "a" sits inside half the book.
    ['one letter', 'a', null],
    ['three letters', 'the', null],
    // A piece the book does not hold — she misheard, or they own two books.
    ['a piece the book does not hold', 'Für Elise', null],
    ['a sentence about nothing in the book', 'the one with the fast bit', null],
  ];

  for (const [what, heard, expected] of table) {
    it(`${what} → ${expected === null ? 'no prefill' : `rank ${expected}`}`, () => {
      expect(resolveHereRank(BOOK, heard)).toBe(expected);
    });
  }

  it('decides nothing on an empty book — a fault must not read as a match', () => {
    expect(resolveHereRank([], 'hungarian folk song')).toBeNull();
  });

  it('decides nothing when two rows carry one title — the screen already marks that row', () => {
    const twins = [
      { label: 'Minuet in G Major', rank: 1 },
      { label: 'Minuet in G Major', rank: 2 },
    ];
    expect(resolveHereRank(twins, 'minuet in g major')).toBeNull();
  });

  it('returns the row’s own rank, never its position in the list', () => {
    // A book cut at the cap, or a hand-added row, can carry ranks that are not 1..n in order.
    const sparse = [
      { label: 'Chanson', rank: 40 },
      { label: 'Hungarian Folk Song', rank: 41 },
    ];
    expect(resolveHereRank(sparse, 'hungarian folk song')).toBe(41);
  });
});
