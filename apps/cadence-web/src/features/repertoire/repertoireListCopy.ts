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
import { MONTH_ABBR, STANDING_WORDS } from './repertoireItemCopy.ts';

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
  queued: "your order — I'll suggest the first",
  known: 'in rotation — longest rest first',
  retired: 'finished — counted, never scheduled',
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
 * note · composer · catalogue · collection · practiced-relative-date — each segment present only
 * when there is a fact behind it. This is the one place all four domains (piece, book, kata,
 * verse — P8) meet: none of them gets a bespoke line, they simply carry different facts, and this
 * function only formats and orders whatever is on file (the file's own rule, stated above).
 *
 * The practice note (P8: "the practice note gets a store" — `bars 9-16`, `p. 240`, `first stanza`,
 * `for 5th kyu`) LEADS the line, ahead of the identity qualifiers — the same lead position the
 * coach's own prompt render uses for it (session-practice-facts.ts's `practiceNote`), one
 * vocabulary for both. Leading with it also means a book or a kata — which carry a note but
 * rarely a composer — still gets an informative first segment instead of an empty one, with no
 * per-domain branch anywhere in this function.
 *
 * Catalogue sits right after composer, ahead of collection: it is the qualifier that actually
 * tells two same-titled pieces apart (three Minuets in G, one collection), so it earns the second
 * slot rather than trailing where a long collection name could push it off the row.
 */
export function buildSecondLine(item: RepertoireItem, now: Date = new Date()): string {
  const q = pieceQualifiers(item.meta);
  const segments = [q.note, q.composer, q.catalogue, q.collection, rowDateFor(item, now)].filter((s): s is string =>
    Boolean(s),
  );
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

/** A kata ladder (P8: "kata — a ladder"): a shelf whose items EVERY ONE carries a rank reads as
 *  one ordered ladder instead of the standing's own rule — the belt order matters more than which
 *  of the four groups a grade currently sits in. A single ungraded item means the ladder is not
 *  complete yet, so this is deliberately all-or-nothing: one missing rank falls back to the
 *  standing's normal order rather than sorting the unranked item to an arbitrary end. Checked
 *  against exactly the items `orderGroupItems` was handed — one standing at a time, the only
 *  slice this function ever sees. */
function isFullLadder(items: RepertoireItem[]): boolean {
  return items.length > 0 && items.every((i) => pieceQualifiers(i.meta).rank !== undefined);
}

/**
 * The one place that decides which order a standing's rows render in — a router, table-tested
 * (repertoireListCopy.test.ts) the way every deterministic router in this codebase is, because a
 * swapped case is silent: the wrong order still renders a plausible list, and nothing throws.
 *
 *  - a full ladder (every item ranked, P8) — rank order, ascending, REGARDLESS of standing: no
 *    rotation, no rank-drag-order-vs-rest distinction, just the belt order. Checked first, so a
 *    kata shelf never falls through to a standing rule that would silently re-sort it.
 *  - `known` ("Keeping up") — longest rest first, via the SAME `byRest` the coach's own rotation
 *    reads (`pickDueNext`), so the screen and the coach can never disagree about what is due.
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

/**
 * Books — a record, not a repertoire (P8): `kind: 'book'` exactly (case-insensitive, trimmed),
 * the one canonical spelling, not a fuzzy match against the coach's free-text `kind` field. A
 * looser match risks a false positive on some other domain's kind that happens to contain the
 * word; an exact one is a router CLAUDE.md's own rule asks for a table test on, which
 * `repertoireListCopy.test.ts` carries.
 */
function isBookKind(kind: string | null | undefined): boolean {
  return (kind ?? '').trim().toLowerCase() === 'book';
}

/** The standing word for one item's own status. Identical to `STANDING_WORDS` for every standing
 *  and every domain except one: a book's Learned standing reads "Finished" — "Learned" reads oddly
 *  for a record that was simply read to the end (the design's own word swap, P8). Used for the
 *  ROW's own right-side label and its move-menu, which are per-item and so stay domain-accurate
 *  even in a shelf that mixes books with something else. */
export function standingWordFor(kind: string | null | undefined, status: RepertoireStatus): string {
  if (status === 'retired' && isBookKind(kind)) return 'Finished';
  return STANDING_WORDS[status];
}

/** The GROUP HEADER's own standing word — "Finished" only when EVERY item in the group is a book:
 *  a header is one word for the whole section, so a shelf mixing a book into a pile of pieces
 *  keeps "Learned" rather than mislabeling the pieces. (The per-item row word above has no such
 *  problem — it reads that row's own kind.) */
export function groupStandingWord(status: RepertoireStatus, items: RepertoireItem[]): string {
  if (status === 'retired' && items.length > 0 && items.every((i) => isBookKind(i.kind))) return 'Finished';
  return STANDING_WORDS[status];
}

/** Nouns for material held in memory rather than played, read, or performed — "by heart" reads
 *  better than "learned" for a verse. Mirrors `cardHeader.ts`'s own `BY_HEART_NOUNS` (the progress
 *  card's header tag, P5) exactly in spirit — same idiom, same trigger — so a verses shelf reads
 *  the same verb on the card and on this list screen, never two words for one domain. */
const BY_HEART_NOUNS = new Set(['verse', 'verses']);

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
