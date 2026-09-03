/**
 * The seed's router: rank + where-you-are → the standing a row will be written with.
 *
 * It is the shape CLAUDE.md's rule names — pure, silent, and behaviour-deciding. Swap two arms
 * and nothing throws: the book just lands with every piece before tonight's filed as "up next"
 * instead of "keeping up", or the piece they are learning filed as already known. So: a positive
 * for every arm, and near-misses for the where-you-are values that are not a rank (nothing tapped
 * yet, a zero, a fraction) and must decide nothing.
 */
import { describe, it, expect } from 'vitest';
import { SEED_STATUSES } from '@cadence/shared';
import {
  STANDING_WORD,
  ambiguityNote,
  applyHere,
  blockedRanks,
  markedRanks,
  prefillHereRank,
  refusedNote,
  rowStanding,
  saveLabel,
  standingFor,
  toggleRow,
  writableRows,
  type SeedRowState,
} from './seedRows.ts';

function rows(count: number): SeedRowState[] {
  return Array.from({ length: count }, (_, i) => ({
    label: `Piece ${i + 1}`,
    composer: null,
    collection: 'Suzuki Piano Book 2',
    catalogue: null,
    rank: i + 1,
    ambiguous: false,
    selected: false,
  }));
}

/** Rows with real titles — for the rules that read the LABEL, where `Piece 1`…`Piece 5` prove
 *  nothing: the refusal gate below, and the coach's prefill. Moved up here from beside the
 *  refusal gate when the prefill became its second caller. */
const named = (labels: string[]): SeedRowState[] => labels.map((label, i) => ({ ...rows(1)[0]!, label, rank: i + 1 }));

describe('standingFor — the where-you-are split', () => {
  const table: Array<[number, number | null, string | null]> = [
    // They tapped piece 3: everything before it is already theirs, that one is the work.
    [1, 3, 'known'],
    [2, 3, 'known'],
    [3, 3, 'working'],
    [4, 3, 'queued'],
    [12, 3, 'queued'],
    // On the first piece of the book: nothing is behind them.
    [1, 1, 'working'],
    [2, 1, 'queued'],
    // Nothing tapped yet — the screen decides nothing and the button stays at zero.
    [1, null, null],
    [9, null, null],
    // Near-misses: values that are not a rank must not be read as one. Rank 0 would silently
    // file the whole book as "up next", which is a different (and wrong) claim about the person.
    [1, 0, null],
    [1, -1, null],
    [1, 2.5, null],
    [1, Number.NaN, null],
  ];

  for (const [rank, here, expected] of table) {
    it(`rank ${rank} with here=${String(here)} → ${expected ?? 'nothing'}`, () => {
      expect(standingFor(rank, here)).toBe(expected);
    });
  }

  it('never yields a standing outside the three a seed may write', () => {
    const seen = new Set<string>();
    for (let here = 1; here <= 6; here += 1) {
      for (let rank = 1; rank <= 6; rank += 1) {
        const s = standingFor(rank, here);
        if (s) seen.add(s);
      }
    }
    expect([...seen].sort()).toEqual([...SEED_STATUSES].sort());
    expect(seen.has('retired')).toBe(false);
  });

  it('names each standing the way the screen says it out loud', () => {
    expect(STANDING_WORD).toEqual({ known: 'Keeping up', working: 'Learning', queued: 'Up next' });
    expect(Object.keys(STANDING_WORD).sort()).toEqual([...SEED_STATUSES].sort());
  });
});

describe('rowStanding — a tick is what decides a row is written at all', () => {
  const row = (over: Partial<SeedRowState>): SeedRowState => ({ ...rows(1)[0]!, ...over });

  it('an unticked row gets nothing, however the split falls', () => {
    expect(rowStanding(row({ rank: 1, selected: false }), 3)).toBeNull();
    expect(rowStanding(row({ rank: 3, selected: false }), 3)).toBeNull();
  });

  it('a ticked row gets the standing its rank earns', () => {
    expect(rowStanding(row({ rank: 1, selected: true }), 3)).toBe('known');
    expect(rowStanding(row({ rank: 3, selected: true }), 3)).toBe('working');
    expect(rowStanding(row({ rank: 4, selected: true }), 3)).toBe('queued');
  });
});

describe('applyHere — the tap that sets the split', () => {
  it('ticks the piece they are on and everything before it, and nothing after', () => {
    expect(applyHere(rows(5), 3).map((r) => r.selected)).toEqual([true, true, true, false, false]);
  });

  it('on the first piece, ticks only that one', () => {
    expect(applyHere(rows(5), 1).map((r) => r.selected)).toEqual([true, false, false, false, false]);
  });

  it('re-tapping a later piece re-ticks from scratch — it never keeps a stale tail', () => {
    const after = applyHere(applyHere(rows(5), 4), 2);
    expect(after.map((r) => r.selected)).toEqual([true, true, false, false, false]);
  });
});

/**
 * The coach's half of the same tap (P7, design frame 1e). She hears "I'm on the Hungarian folk
 * song" and hands those words over; this is what turns them into the tap, or refuses to.
 *
 * It is the same silent router `standingFor` is, one step earlier and with a worse failure mode:
 * a loose match here decides sixty standings off a phrase nobody confirmed. So the near-misses
 * carry the weight — above all a phrase that fits SEVERAL rows ("minuet in g", and Suzuki Book 2
 * really does hold four of them). She may not invent a distinction between two titles, so an
 * ambiguous phrase must prefill NOTHING and become a tap the person makes.
 */
describe('prefillHereRank — her heard split, or none at all', () => {
  const BOOK = named([
    'Écossaise',
    'Long, Long Ago',
    'The Happy Farmer',
    'Minuet in G Major, BWV Anh. 114',
    'Minuet in G Minor, BWV Anh. 115',
    'Minuet in G Major, BWV Anh. 116',
    'Hungarian Folk Song',
    'Chanson',
  ]);

  const table: Array<[string, string | null | undefined, number | null]> = [
    // Their own words, exactly and loosely — the ordinary case the door exists for.
    ['the title as printed', 'Hungarian Folk Song', 7],
    ['lower case, as typed in chat', 'hungarian folk song', 7],
    ['their shorthand for it', 'the hungarian folk song', 7],
    ['a fragment that names one row', 'hungarian', 7],
    // Accents fold both ways: she will write "Ecossaise" as often as the person writes "Écossaise".
    ['an accent she dropped', 'ecossaise', 1],
    ['an accent she kept', 'Écossaise', 1],
    // Punctuation is not identity — "Long, Long Ago" and "long long ago" are one piece.
    ['punctuation she left out', 'long long ago', 2],
    // A phrase that fits three rows names none of them. This is the ruling, as a row.
    ['a phrase three pieces answer to', 'minuet in g', null],
    ['a phrase two pieces answer to', 'minuet in g major, bwv anh. 11', null],
    // …and the qualifier that separates them still works.
    ['the same phrase, qualified', 'minuet in g minor', 5],
    // Nothing said, nothing marked. She may leave it out and the screen must not guess.
    ['nothing said at all', null, null],
    ['nothing said at all, undefined', undefined, null],
    ['blank space', '   ', null],
    // A needle too short to be evidence: "a" sits inside half the book.
    ['one letter', 'a', null],
    ['three letters', 'the', null],
    // A piece that is not in this book at all — she misheard, or they own two books.
    ['a piece the book does not hold', 'Für Elise', null],
  ];

  for (const [what, heard, expected] of table) {
    it(`${what} → ${expected === null ? 'no prefill' : `rank ${expected}`}`, () => {
      expect(prefillHereRank(BOOK, heard)).toBe(expected);
    });
  }

  it('prefills exactly the tap, so both doors open the same screen', () => {
    const rank = prefillHereRank(BOOK, 'hungarian folk song')!;
    expect(applyHere(BOOK, rank).map((r) => r.selected)).toEqual(applyHere(BOOK, 7).map((r) => r.selected));
  });

  it('decides nothing on an empty book — a fault must not read as a match', () => {
    expect(prefillHereRank([], 'hungarian folk song')).toBeNull();
  });
});

describe('toggleRow — one tick, one row', () => {
  it('flips exactly the row named and leaves every other alone', () => {
    const before = applyHere(rows(5), 3);
    const after = toggleRow(before, 0);
    expect(after.map((r) => r.selected)).toEqual([false, true, true, false, false]);
    expect(after[1]).toBe(before[1]); // untouched rows are the same objects
  });

  it('ticks a row after the split back on', () => {
    expect(toggleRow(applyHere(rows(5), 3), 4).map((r) => r.selected)).toEqual([true, true, true, false, true]);
  });

  it('ignores an index off the end rather than growing the list', () => {
    const before = applyHere(rows(3), 2);
    expect(toggleRow(before, 9)).toEqual(before);
  });
});

describe('writableRows — exactly what confirm will send', () => {
  it('sends the ticked rows with their standings, and no others', () => {
    const state = toggleRow(applyHere(rows(5), 3), 4);
    expect(writableRows(state, 3)).toEqual([
      {
        label: 'Piece 1',
        composer: null,
        collection: 'Suzuki Piano Book 2',
        catalogue: null,
        rank: 1,
        status: 'known',
      },
      {
        label: 'Piece 2',
        composer: null,
        collection: 'Suzuki Piano Book 2',
        catalogue: null,
        rank: 2,
        status: 'known',
      },
      {
        label: 'Piece 3',
        composer: null,
        collection: 'Suzuki Piano Book 2',
        catalogue: null,
        rank: 3,
        status: 'working',
      },
      {
        label: 'Piece 5',
        composer: null,
        collection: 'Suzuki Piano Book 2',
        catalogue: null,
        rank: 5,
        status: 'queued',
      },
    ]);
  });

  it('sends nothing at all before they have said where they are', () => {
    expect(
      writableRows(
        rows(5).map((r) => ({ ...r, selected: true })),
        null,
      ),
    ).toEqual([]);
  });

  it('drops a hand-added row nobody typed a name into', () => {
    const state = [...applyHere(rows(2), 2), { ...rows(1)[0]!, label: '   ', rank: 3, selected: true, added: true }];
    expect(writableRows(state, 2).map((r) => r.label)).toEqual(['Piece 1', 'Piece 2']);
  });

  it('writes known, working and queued only', () => {
    const state = applyHere(rows(6), 3).map((r) => ({ ...r, selected: true }));
    const statuses = new Set(writableRows(state, 3).map((r) => r.status));
    expect([...statuses].sort()).toEqual([...SEED_STATUSES].sort());
  });
});

describe('saveLabel — the button says what it will do', () => {
  it('counts the pieces, and says "piece" for one', () => {
    expect(saveLabel(9)).toBe('Save 9 pieces');
    expect(saveLabel(1)).toBe('Save 1 piece');
    expect(saveLabel(0)).toBe('Save 0 pieces');
  });
});

/* ── The refusal gate (supervisor ruling 2026-09-02) ─────────────────────────────────────────
   The seed applies `update_repertoire`'s own rule: a title two pieces answer to is refused, never
   written. The server is the authority — it refuses and names what it refused — and these are the
   screen's half: mark the row, and hold the button while a marked row would be written. */

describe('markedRanks — the labels the screen will not let through as they are', () => {
  it('marks a row the server already judged unresolvable', () => {
    const state = named(['Écossaise', 'Chanson']).map((r, i) => (i === 0 ? { ...r, ambiguous: true } : r));
    expect([...markedRanks(state)]).toEqual([1]);
  });

  it('marks BOTH rows that carry one name — neither can be told from the other', () => {
    expect([...markedRanks(named(['Gavotte', 'Gavotte', 'Chanson']))]).toEqual([1, 2]);
  });

  it('folds case and surrounding space, because the unique index is lower(label)', () => {
    expect([...markedRanks(named(['Gavotte', '  gavotte ']))]).toEqual([1, 2]);
  });

  it('never marks a blank row — an unfilled hand-added row is not a duplicate of another one', () => {
    expect([...markedRanks(named(['', '', 'Chanson']))]).toEqual([]);
  });

  it('marks nothing when every name is its own', () => {
    expect([...markedRanks(named(['Écossaise', 'Chanson', 'Gavotte']))]).toEqual([]);
  });
});

describe('blockedRanks — the marked rows that would actually be written', () => {
  const twins = () => named(['Gavotte', 'Gavotte', 'Chanson']);

  it('blocks nothing before they have said where they are — nothing is going to be written', () => {
    expect([...blockedRanks(twins(), null)]).toEqual([]);
  });

  it('blocks a marked row that is ticked', () => {
    expect([...blockedRanks(applyHere(twins(), 3), 3)]).toEqual([1, 2]);
  });

  it('does not block a marked row nobody ticked', () => {
    expect([...blockedRanks(applyHere(twins(), 1), 1)]).toEqual([1]);
    expect([...blockedRanks(toggleRow(applyHere(twins(), 1), 0), 1)]).toEqual([]);
  });
});

describe('ambiguityNote — why the button is held, and what to do about it', () => {
  it('names the count and asks for a fuller name', () => {
    expect(ambiguityNote(1)).toBe(
      'One of these shares its name with a piece you already have. Give it a fuller name — the composer or the catalogue number — and I can save it.',
    );
    expect(ambiguityNote(2)).toBe('Two of these share a name. Give one a fuller name and I can save them both.');
    expect(ambiguityNote(5)).toBe(
      'Some of these share a name. Give each a fuller name — the composer or the catalogue number — and I can save them all.',
    );
  });
});

describe('refusedNote — what the server would not write', () => {
  it('counts what landed and names what did not', () => {
    expect(refusedNote(9, ['Minuet in G Major'])).toBe(
      'Saved 9. This one needs a fuller name before I can save it: "Minuet in G Major".',
    );
    expect(refusedNote(0, ['Gavotte', 'gavotte'])).toBe(
      'These need a fuller name before I can save them: "Gavotte", "gavotte".',
    );
  });
});
