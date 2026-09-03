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
  applyHere,
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
