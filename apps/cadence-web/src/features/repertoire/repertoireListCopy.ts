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
import { MONTH_ABBR } from './repertoireItemCopy.ts';

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

/** composer · catalogue · collection · practiced-relative-date — each segment present only when
 *  there is a fact behind it (no "practice note" segment yet: that meta key does not exist on file
 *  today). Catalogue sits right after composer, ahead of collection: it is the qualifier that
 *  actually tells two same-titled pieces apart (three Minuets in G, one collection), so it earns
 *  the second slot rather than trailing where a long collection name could push it off the row. */
export function buildSecondLine(item: RepertoireItem, now: Date = new Date()): string {
  const q = pieceQualifiers(item.meta);
  const segments = [q.composer, q.catalogue, q.collection, rowDateFor(item, now)].filter((s): s is string =>
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

/**
 * The one place that decides which order a standing's rows render in — a router, table-tested
 * (repertoireListCopy.test.ts) the way every deterministic router in this codebase is, because a
 * swapped case is silent: the wrong order still renders a plausible list, and nothing throws.
 *
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

/** "14 PIECES · 6 LEARNED THIS YEAR" — both numbers and the noun come from the payload; this only
 *  formats them, never counts anything itself. */
export function headerCountLine(totalCount: number, learnedInYear: number, noun: string): string {
  return `${totalCount} ${noun.toUpperCase()} · ${learnedInYear} LEARNED THIS YEAR`;
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
