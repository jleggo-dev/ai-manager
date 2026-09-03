/**
 * Pure logic for the list screen (P6 "the room") — group ordering, the row's second line, its
 * date grammar, and the header's count line. Split from ListScreen.tsx so the logic (a `.ts` file,
 * function-capped at 150 lines by eslint.config.sizes.mjs) stays separate from the render tree,
 * and so each piece — especially `orderGroupItems`, a router — is table-testable on its own.
 *
 * "The view never derives counts, order, or collisions itself" (the brief's own ruling) means this
 * file never invents a fact: it only formats and orders what the payload and `@cadence/shared`'s
 * own helpers (`pieceQualifiers`, `byRest`) already hand it.
 */
import type { RepertoireItem, RepertoireStatus } from '@cadence/shared';
import { byRest, pieceQualifiers } from '@cadence/shared';
import type { RepertoireCollisionGroup } from '../../lib/api/repertoire-list.ts';
import { isBookKind, MONTH_ABBR, STANDING_WORDS } from './repertoireItemCopy.ts';
import { BY_HEART_NOUNS } from '../progress/widgets/cardHeader.ts';

// `standingWordFor` lives in repertoireItemCopy.ts (beside `STANDING_WORDS`, which the item
// screen's own caption also reads) — this file already imports FROM that one, so the reverse
// import would be a cycle. Re-exported here so RepertoireRow.tsx's existing import path keeps
// working; it needs no logic of its own in this file.
export { standingWordFor } from './repertoireItemCopy.ts';

/**
 * The group header's own warm line — the coach's voice, never the model's. `REPERTOIRE_GROUPS` in
 * `@cadence/shared` carries a header too, but that one is a PROMPT string ("Learning (status
 * \"working\") — work these in the learn part of each session..."): third person, imperative,
 * naming the schema word on purpose, because a MODEL reads it. Putting that in front of a person
 * broke the warm-UI/boring-prompt split CLAUDE.md's nomenclature rule draws (owner review,
 * 2026-09-02: an earlier version of this screen did exactly that). These four lines are the fix —
 * held once, here, so nobody retypes them at a second call site. `REPERTOIRE_GROUPS` is still the
 * source for which four standings exist and what order they render in (`ListScreen.tsx` reads its
 * order directly); this is only the words.
 */
export const GROUP_LINES: Record<RepertoireStatus, string> = {
  working: "what we're working on now",
  queued: 'not started yet, in your order',
  known: 'learned and still played',
  retired: 'finished',
};

/**
 * The row's own (coarser) date grammar — relative under 14 days, then the bare month within the
 * current calendar year, then the bare year once it crosses into a previous one. Deliberately
 * coarser than the item screen's `formatDate` (which keeps the day-of-month): a list row has four
 * other things on its one line, so the date only has to place a fact in time, not pin it exactly —
 * the full date is one tap away, on the item screen. Local-time getters, matching `formatDate`,
 * so the two screens never read the same instant as two different days.
 */
export function formatRowDate(iso: string | null | undefined, now: Date = new Date()): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const days = Math.floor((now.getTime() - d.getTime()) / 86_400_000);
  if (days < 14) {
    if (days <= 0) return 'today';
    if (days === 1) return 'yesterday';
    return `${days} days ago`;
  }
  if (d.getFullYear() === now.getFullYear()) return MONTH_ABBR[d.getMonth()] ?? '';
  return String(d.getFullYear());
}

/**
 * The date segment for one row. `last_practiced_at` first, always — a Learned piece someone still
 * plays is dated by that, same as any other standing. Only a Learned (`retired`) row with NO
 * practice date falls back to when it was finished (`learned_at`): the design calls that group
 * "dated" and a never-touched-since piece would otherwise show no date at all. No other standing
 * gets this fallback — `queued`/`working` are not finished, so inventing a date for them would be
 * exactly the kind of guess the row's "only what is on file" rule forbids.
 */
function rowDateFor(item: RepertoireItem, now: Date): string {
  const primary = formatRowDate(item.last_practiced_at, now);
  if (primary) return primary;
  return item.status === 'retired' ? formatRowDate(item.learned_at, now) : '';
}

/**
 * composer · collection · note · practiced-relative-date — each segment present only when there is
 * a fact behind it. This is the one place all four domains (piece, book, kata, verse — P8) meet:
 * none of them gets a bespoke line, they simply carry different facts, and this function only
 * formats and orders whatever is on file (the file's own rule, stated above).
 *
 * The practice note sits after the identity qualifiers, right before the date — the design's own
 * order: WHICH item this is, then how the work is going, then WHEN it was last touched. This
 * differs from session-practice-facts.ts's line, which leads with the note for the coach's prompt —
 * the two share a vocabulary, not a byte order, since a prompt reads best foregrounding what
 * matters most to a session being programmed, while this row reads best naming the item first. A
 * book or a kata, which rarely carries a composer or a collection, still gets an informative line:
 * the note is simply the first (and often only) segment present.
 *
 * The collection's NAME comes off the row's joined `collection_name` (migration 0056), not `meta`:
 * the name lives on the collection's own row now, so a rename shows up on every item at once
 * instead of on whichever ones happened to be written since.
 *
 * TWO FIELDS ARE DELIBERATELY ABSENT.
 *  - `catalogue` was here until 2026-09-03 and is not a field any more (owner: *"very
 *    music-specific and adds little"*).
 *  - `description` IS on the row and is deliberately not rendered here: it is a sentence, up to 240
 *    characters, and a list row has four other things on one line. It belongs on the item screen,
 *    which is one tap away.
 */
export function buildSecondLine(item: RepertoireItem, now: Date = new Date()): string {
  const q = pieceQualifiers(item.meta);
  const collection = item.collection_name?.trim() || undefined;
  const segments = [q.composer, collection, q.note, rowDateFor(item, now)].filter((s): s is string => Boolean(s));
  return segments.join(' · ');
}

/** A rank on file, or "last" when there is none — so an unranked row never outranks a ranked one
 *  by accident of array position. Exported: `moveQueuedRank` reads the same rule. */
export function rankOf(item: RepertoireItem): number {
  const rank = pieceQualifiers(item.meta).rank;
  return typeof rank === 'number' ? rank : Number.POSITIVE_INFINITY;
}

const time = (iso?: string | null): number => (iso ? new Date(iso).getTime() : Number.NaN);

/** Newest-finished-first for the Learned group. `learned_at` is the standing's own date — a piece
 *  with none (backfilled: they already knew it when they told us) has nothing to rank by and sorts
 *  after every dated one, never at a guessed position among them. A tie (including two rows that
 *  BOTH lack `learned_at`) falls to `last_practiced_at`, also newest first, then to the label — the
 *  same cascading-tiebreak shape `byRest` uses, so "no date beats no date" still reads consistently
 *  rather than falling back to arbitrary array order. */
function byLearnedDesc(a: RepertoireItem, b: RepertoireItem): number {
  const at = time(a.learned_at);
  const bt = time(b.learned_at);
  const aNone = Number.isNaN(at);
  const bNone = Number.isNaN(bt);
  if (aNone !== bNone) return aNone ? 1 : -1;
  if (!aNone && at !== bt) return bt - at;
  const ap = time(a.last_practiced_at);
  const bp = time(b.last_practiced_at);
  const apNone = Number.isNaN(ap);
  const bpNone = Number.isNaN(bp);
  if (apNone !== bpNone) return apNone ? 1 : -1;
  if (!apNone && ap !== bp) return bp - ap;
  return a.label < b.label ? -1 : a.label > b.label ? 1 : 0;
}

/**
 * A ladder is any ordered collection — a graded syllabus, a method book, a reading list — and
 * "every item carries a rank" is the whole test again (owner ruling 2026-09-03: *"Kata isn't a
 * special thing — it was always an example — this is meant to be a flexible tool meant for
 * learning things progressively"*).
 *
 * A `LADDER_KINDS` set gated this on `kind: 'kata'` for a day, because a ranked group of ordinary
 * pieces used to render in rank order while the COACH read the same group by rest, and the screen
 * and the coach disagreeing about the first row was the thing the list must never do. That reason
 * is gone: she no longer reads row position for anything (`pickDueNext` is deleted, and the render
 * marks nothing), so a ranked group shown in its own rank order now disagrees with nothing — it
 * simply shows the person the order they put their material in.
 *
 * Still ALL-OR-NOTHING: one unranked item means the ladder is incomplete, and the standing's normal
 * order is the honest fallback rather than a guessed position for the row with no number. Checked
 * against exactly the items `orderGroupItems` was handed — one standing at a time, the only slice
 * this function ever sees.
 */
export function isFullLadder(items: RepertoireItem[]): boolean {
  return items.length > 0 && items.every((i) => pieceQualifiers(i.meta).rank !== undefined);
}

/**
 * The one place that decides which order a standing's rows render in — a router, table-tested
 * (repertoireListCopy.test.ts) the way every deterministic router in this codebase is, because a
 * swapped case is silent: the wrong order still renders a plausible list, and nothing throws.
 *
 *  - a fully ranked group — rank order, ascending, REGARDLESS of standing: the person's own order
 *    through the collection, shown with the numbers. Checked first, so a ranked group never falls
 *    through to a standing rule that would silently re-sort it.
 *  - `known` ("Keeping up"), unranked — least recently practised first (`byRest`), with each row's
 *    own date beside it, so the order restates a fact the person can check rather than asserting a
 *    priority.
 *  - `queued` ("Up next") — the person's own drag order (`RANK_KEY`, ascending); unranked rows
 *    sort after every ranked one, in the order the server sent them.
 *  - `retired` ("Learned") — newest finished first (`byLearnedDesc`): the design calls this group
 *    "dated", and a later parcel collapses it by year, which needs a real date order rather than
 *    the alphabetical one the server happens to return.
 *  - `working` — left exactly as the server returned it (already `lower(label)` order from
 *    `listRepertoire`): no owner-specified order exists for material still being learned, so this
 *    never invents one.
 */
export function orderGroupItems(status: RepertoireStatus, items: RepertoireItem[]): RepertoireItem[] {
  if (isFullLadder(items)) return [...items].sort((a, b) => rankOf(a) - rankOf(b));
  if (status === 'known') return [...items].sort(byRest);
  if (status === 'retired') return [...items].sort(byLearnedDesc);
  if (status === 'queued') {
    return items
      .map((item, index) => ({ item, index }))
      .sort((a, b) => rankOf(a.item) - rankOf(b.item) || a.index - b.index)
      .map((entry) => entry.item);
  }
  return items;
}

/** Goal-linked rows and unattached ones, each side keeping its own relative order — the unattached
 *  side gets its own "NOT TIED TO A GOAL" hairline inside a group (RepertoireGroup.tsx). */
export function splitUnattached<T extends { goal_id: string | null }>(items: T[]): { linked: T[]; unattached: T[] } {
  const linked: T[] = [];
  const unattached: T[] = [];
  for (const item of items) (item.goal_id === null ? unattached : linked).push(item);
  return { linked, unattached };
}

/** The GROUP HEADER's own standing word — "Finished" only when EVERY item in the group is a book:
 *  a header is one word for the whole section, so a shelf mixing a book into a pile of pieces
 *  keeps "Learned" rather than mislabeling the pieces. (The per-item row word above has no such
 *  problem — it reads that row's own kind.) */
export function groupStandingWord(status: RepertoireStatus, items: RepertoireItem[]): string {
  if (status === 'retired' && items.length > 0 && items.every((i) => isBookKind(i.kind))) return 'Finished';
  return STANDING_WORDS[status];
}

/** "14 PIECES · 6 LEARNED THIS YEAR" — both numbers and the noun come from the payload; this only
 *  formats them, never counts anything itself. The verb after the year count swaps for two
 *  domains, matched off the noun itself since this function's signature is a shared contract with
 *  the screen that calls it and could not grow a new domain parameter without touching that
 *  caller: "FINISHED" for books (`groupStandingWord`'s own reasoning applies here too), "BY HEART"
 *  for verses (see `BY_HEART_NOUNS`), "LEARNED" for everything else, including a noun never seen
 *  before. */
export function headerCountLine(totalCount: number, learnedInYear: number, noun: string): string {
  const n = noun.trim().toLowerCase();
  const verb = n === 'books' ? 'FINISHED' : BY_HEART_NOUNS.has(n) ? 'BY HEART' : 'LEARNED';
  return `${totalCount} ${noun.toUpperCase()} · ${learnedInYear} ${verb} THIS YEAR`;
}

/** Once a Learned books shelf crosses this many items, individual rows give way to year buckets
 *  (P8: "books — a record, 200 long") — a 200-book reading record cannot stay a flat scroll the
 *  way a repertoire of a few dozen pieces can. Below the threshold, or for any non-book shelf,
 *  rows render exactly as they always have. */
const BOOK_COLLAPSE_THRESHOLD = 30;

/** True once a Learned group should collapse into year buckets behind a find field: every item is
 *  a book, and there are enough of them that a flat list stops being one a person can scan. */
export function shouldCollapseByYear(status: RepertoireStatus, items: RepertoireItem[]): boolean {
  return status === 'retired' && items.length > BOOK_COLLAPSE_THRESHOLD && items.every((i) => isBookKind(i.kind));
}

export interface YearBucket {
  /** null = no `learned_at` on file (backfilled: already read when they told us) — counted, never
   *  dated wrong. */
  year: number | null;
  count: number;
}

/** One bucket per calendar year an item finished in, newest year first; the undated bucket sorts
 *  last, after every real year — never a guessed position among them. Read off the ISO string
 *  directly, matching `learnedInYear`'s own server-timezone-independent rule. */
export function bucketsByYear(items: RepertoireItem[]): YearBucket[] {
  const counts = new Map<number | null, number>();
  for (const item of items) {
    const year = item.learned_at ? Number(item.learned_at.slice(0, 4)) : null;
    counts.set(year, (counts.get(year) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([year, count]) => ({ year, count }))
    .sort((a, b) => {
      if (a.year === null) return 1;
      if (b.year === null) return -1;
      return b.year - a.year;
    });
}

/** "2025 · 41 finished ›" — a year bucket's own line. "finished" rather than "learned" is safe to
 *  hardcode here (unlike the general header/group words above): `shouldCollapseByYear` only ever
 *  says yes for an all-book Learned group, so this is never rendered for any other domain. */
export function yearBucketLine(bucket: YearBucket): string {
  const label = bucket.year === null ? 'Not dated' : String(bucket.year);
  return `${label} · ${bucket.count} finished ›`;
}

/** The find field's own match rule, once a shelf has collapsed: a case-insensitive substring of
 *  the label — the same "type a few letters" behaviour the rest of the app filters by name with,
 *  never a fuzzy or tokenized search a 200-book shelf does not need. An empty query matches
 *  everything, so clearing the field returns to the full list rather than an empty one. */
export function findMatches(items: RepertoireItem[], query: string): RepertoireItem[] {
  const q = query.trim().toLowerCase();
  if (!q) return items;
  return items.filter((i) => i.label.toLowerCase().includes(q));
}

/** Every OTHER label sharing a collision group with `label` — a label can appear in more than one
 *  group (two different shared needles), so this unions and dedupes rather than returning the
 *  first match. Empty for a label with no collision at all — the common case. */
export function collisionPartnersFor(label: string, collisions: RepertoireCollisionGroup[]): string[] {
  const partners = new Set<string>();
  for (const group of collisions) {
    if (!group.labels.includes(label)) continue;
    for (const other of group.labels) if (other !== label) partners.add(other);
  }
  return [...partners];
}

/**
 * Move one row up or down within an already-ordered Up next list, and report the {item_id, rank}
 * pairs whose rank actually changes.
 *
 * Normalizes the WHOLE list to clean sequential 1-based ranks on every move rather than swapping
 * two raw rank values — a shelf with gaps or missing ranks (nothing has ever been reordered yet)
 * self-heals on the first move instead of needing a separate migration step. Only rows whose rank
 * VALUE changed are returned, so an ordinary adjacent move writes exactly the two rows it touched,
 * never the whole group (the brief's "reordering writes one PATCH per moved row").
 *
 * `index` out of range, or a move off either end, returns no changes — never an out-of-bounds
 * splice silently doing something else.
 */
export function moveQueuedRank(
  ordered: RepertoireItem[],
  index: number,
  direction: 'up' | 'down',
): Array<{ item_id: string; rank: number }> {
  if (index < 0 || index >= ordered.length) return [];
  const target = direction === 'up' ? index - 1 : index + 1;
  if (target < 0 || target >= ordered.length) return [];
  const next = [...ordered];
  const [moved] = next.splice(index, 1);
  next.splice(target, 0, moved as RepertoireItem);
  const changes: Array<{ item_id: string; rank: number }> = [];
  next.forEach((entry, i) => {
    const rank = i + 1;
    if (rankOf(entry) !== rank) changes.push({ item_id: entry.item_id, rank });
  });
  return changes;
}
