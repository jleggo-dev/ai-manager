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
      rank: row.rank,
      status,
    });
  }
  return out;
}

/** The confirm button's own words — the count IS the promise, so it comes from the same list. */
export function saveLabel(count: number): string {
  // No noun: one list holds pieces, kata, books and verses, so any noun is wrong for three of
  // the four (owner ruling 2026-09-03), and one reads the same as nine without it.
  return `Save ${count}`;
}

/* ── The refusal gate ────────────────────────────────────────────────────────────────────────
   A row whose title two pieces answer to exists and is permanently unfindable — it reads as a
   record and behaves as a hole. `update_repertoire` refuses such a row; the seed's confirm refuses
   it too (supervisor ruling 2026-09-02), and the SERVER is the authority: it applies the full
   needle rule against the person's whole shelf and reports back every label it would not write.

   What follows is the screen's half — hold the button before the round trip, and say why. It
   deliberately does NOT re-implement the needle rule (that lives once, server-side, in
   repertoire-match.ts; a second spelling of it here is exactly the drift CLAUDE.md bans). It knows
   two things instead: the mark the server already put on a candidate, and whether two rows in this
   list carry one name. Anything subtler — an accent-variant twin, a collision with a piece on the
   shelf the screen never saw — is caught by the server's refusal and named back to the person. */

/** What two labels must differ in to be two rows: the unique index is `lower(label)`. */
const labelKey = (label: string): string => label.trim().toLowerCase();

/**
 * The rows whose label cannot be saved as it stands, by rank. Independent of ticking, because the
 * mark is a fact about the NAME: the row shows its note and becomes editable either way.
 */
export function markedRanks(rows: SeedRowState[]): Set<number> {
  const counts = new Map<string, number>();
  for (const r of rows) {
    const key = labelKey(r.label);
    if (key) counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const marked = new Set<number>();
  for (const r of rows) {
    const key = labelKey(r.label);
    if (key && (r.ambiguous || (counts.get(key) ?? 0) > 1)) marked.add(r.rank);
  }
  return marked;
}

/** The marked rows that would actually be written — the ones that hold the confirm button. */
export function blockedRanks(rows: SeedRowState[], hereRank: number | null): Set<number> {
  const marked = markedRanks(rows);
  return new Set(rows.filter((r) => marked.has(r.rank) && rowStanding(r, hereRank) !== null).map((r) => r.rank));
}

/** Why the button is held, and the one thing that will release it. */
export function ambiguityNote(count: number): string {
  if (count === 1) {
    return 'One of these shares its name with something you already have. Give it a fuller name — whoever made it, or whatever tells them apart — and I can save it.';
  }
  if (count === 2) return 'Two of these share a name. Give one a fuller name and I can save them both.';
  return 'Some of these share a name. Give each a fuller name — whoever made it, or whatever tells them apart — and I can save them all.';
}

/** What the server refused, said plainly: what landed, and which names still need work. */
export function refusedNote(written: number, labels: string[]): string {
  const names = labels.map((l) => `"${l}"`).join(', ');
  const head = written > 0 ? `Saved ${written}. ` : '';
  const one = labels.length === 1;
  return `${head}${one ? 'This one needs' : 'These need'} a fuller name before I can save ${one ? 'it' : 'them'}: ${names}.`;
}
