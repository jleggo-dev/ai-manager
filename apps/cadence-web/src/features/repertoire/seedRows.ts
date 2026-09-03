/**
 * The seed review's row logic — the pure half of the screen, so it can be tabled.
 *
 * One question decides everything on this screen: where in the book are you now? Everything before
 * that piece is already theirs (`known`, "Keeping up"), that piece is the work (`working`,
 * "Learning"), everything after is not started. A row after the split is written only if they tick
 * it, and then it is `queued` ("Up next") — design's call: not-started is not a standing unless
 * they say so.
 *
 * A seed writes those three standings and no others. `retired` would file a book as finished, and
 * the `learned` verb would date sixty crossings to today — see SEED_STATUSES in @cadence/shared.
 */
import { type SeedStatus } from '@cadence/shared';
// Type-only, so this module stays pure at runtime: the wire shapes are owned by the API client
// (lib/api/repertoire-seed.ts) and derived here rather than restated.
import type { SeedCandidate, SeedWriteRow } from '../../lib/api/repertoire-seed.ts';

/** One row on the review screen — a candidate plus what the person has done to it. */
export interface SeedRowState extends SeedCandidate {
  /** Ticked: this row will be written. */
  selected: boolean;
  /** True for a row the person typed in themselves, so the screen lets them edit it. */
  added?: boolean;
}

/** What the screen calls each standing. The schema word and the spoken word differ on purpose. */
export const STANDING_WORD: Record<SeedStatus, string> = {
  known: 'Keeping up',
  working: 'Learning',
  queued: 'Up next',
};

/** A usable "where you are": a real 1-based position, not a nothing-tapped-yet and not a fraction. */
const isRank = (v: number | null): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 1;

/**
 * The standing a row at `rank` earns, given the piece they said they are on. Null before they have
 * said — the screen must not guess a standing for a whole book off an untapped list.
 */
export function standingFor(rank: number, hereRank: number | null): SeedStatus | null {
  if (!isRank(hereRank)) return null;
  if (rank < hereRank) return 'known';
  if (rank === hereRank) return 'working';
  return 'queued';
}

/** The standing this row will actually be written with — nothing at all when it is unticked. */
export function rowStanding(row: SeedRowState, hereRank: number | null): SeedStatus | null {
  return row.selected ? standingFor(row.rank, hereRank) : null;
}

/** The tap on a title: tick that piece and everything before it, untick everything after. */
export function applyHere(rows: SeedRowState[], hereRank: number): SeedRowState[] {
  return rows.map((r) => ({ ...r, selected: r.rank <= hereRank }));
}

/** One tick, one row. Every other row keeps its identity so React re-renders only this one. */
export function toggleRow(rows: SeedRowState[], index: number): SeedRowState[] {
  if (index < 0 || index >= rows.length) return rows;
  return rows.map((r, i) => (i === index ? { ...r, selected: !r.selected } : r));
}

/** Exactly what confirm will send: the ticked rows that have a name and a standing. */
export function writableRows(rows: SeedRowState[], hereRank: number | null): SeedWriteRow[] {
  const out: SeedWriteRow[] = [];
  for (const row of rows) {
    const status = rowStanding(row, hereRank);
    const label = row.label.trim();
    if (!status || !label) continue;
    out.push({
      label,
      composer: row.composer,
      collection: row.collection,
      catalogue: row.catalogue,
      rank: row.rank,
      status,
    });
  }
  return out;
}

/** The confirm button's own words — the count IS the promise, so it comes from the same list. */
export function saveLabel(count: number): string {
  return `Save ${count} ${count === 1 ? 'piece' : 'pieces'}`;
}
