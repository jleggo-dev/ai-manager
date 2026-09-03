import { foldAccents, normTitle } from './goal-identity.ts';
import { needles } from './repertoire-match.ts';
import { pieceQualifiers } from '@cadence/shared';

/** What this module compares two items on: the label, whatever `meta` says about which one it is,
 *  and the collection it is filed in (a joined NAME since migration 0056, not a `meta` key). */
export interface ComparableItem {
  label: string;
  meta?: Record<string, unknown> | null;
  collection_name?: string | null;
}

/** The two STATED facts that can tell two same-titled items apart: who made it, and which
 *  collection it is in. Read together so the disagreement rule below has one shape to compare. */
interface StatedFacts {
  composer?: string;
  collection?: string;
}

const statedFacts = (item: Pick<ComparableItem, 'meta' | 'collection_name'>): StatedFacts => ({
  composer: pieceQualifiers(item.meta).composer,
  collection: item.collection_name?.trim() || undefined,
});

/**
 * True when a STATED fact on BOTH sides disagrees — the one thing that can tell two same-titled
 * items apart without a word added to the label itself (the item screen's By field and its
 * Collection picker). Absence on either side decides nothing — an unqualified item might still be
 * either one, so only a STATED disagreement counts; this is `isResolvable`'s own asymmetry (a miss
 * self-corrects, a false "these are different" would not) applied to facts instead of needles.
 *
 * Composer and collection only. A `catalogue` qualifier counted here until 2026-09-03, when the
 * owner removed the field as music-specific; the free-text description is deliberately NOT a
 * substitute for it here, because two people's own words for one item ("the fast one", "the quick
 * one") differ constantly without naming two different items — a disagreement rule needs facts
 * that are stated the same way twice, and prose is not.
 *
 * The collection is compared by NAME rather than by id, deliberately: an incoming item that has not
 * been written yet has no collection row to point at, only the name someone said, and comparing
 * names keeps the pre-write check and the post-write one asking the same question.
 */
function factsDiffer(a: StatedFacts, b: StatedFacts): boolean {
  const disagree = (x?: string, y?: string) => !!x && !!y && x.toLowerCase() !== y.toLowerCase();
  return disagree(a.composer, b.composer) || disagree(a.collection, b.collection);
}

/**
 * Could this label ever be found again once it is on the shelf?
 *
 * Writing "Minuet in G Major" beside two pieces that already answer to it produces a row nothing
 * can ever resolve: its only needle is the one shared needles rule now blocks, so it can never be
 * practised, stamped or given a tempo. A row like that is worse than no row — it looks like a
 * record and behaves like a hole.
 *
 * A re-mention of an existing piece is an update, not a new row, so that row is excluded from the
 * comparison. A qualified addition is always fine: "Minuet in G Major (Petzold)" keeps a full
 * needle of its own even though its core collides. And the qualifier does not have to live in the
 * label text — two items titled identically-short but carrying a DIFFERENT composer (or a
 * different collection) are different pieces too, so a needle they share blocks neither: the
 * title can stay short and the stated fact does the work instead of a parenthetical.
 */
export function isResolvable(
  existing: ComparableItem[],
  label: string,
  facts: Pick<ComparableItem, 'meta' | 'collection_name'> = {},
): boolean {
  const others = existing.filter((i) => !samePiece(i.label, label));
  const mine = statedFacts(facts);
  return needles(label).some((n) => {
    const sharers = others.filter((i) => needles(i.label).includes(n));
    return sharers.every((i) => factsDiffer(mine, statedFacts(i)));
  });
}

/* ── One row per piece ───────────────────────────────────────────────────────────────────────
   Matching is accent-tolerant, but the repertoire unique index is `(user_id, lower(label))` and
   Postgres `lower()` is not: on its own, "Écossaise" and "Ecossaise" become TWO rows for one
   piece, splitting its practice history and its settled tempo. These resolve an incoming label
   onto the row that already exists.

   Sameness here is EQUALITY of the normalized form — never `sameGoalTitle`'s containment, which
   is right for goals and dangerous for pieces: "Étude in C" is contained in "Étude in C minor",
   and those are two different études. */

/** Two labels name the same piece when they normalize identically (case, accents, punctuation). */
export function samePiece(a: string, b: string): boolean {
  const na = normTitle(a);
  return na.length > 0 && na === normTitle(b);
}

/** Does this spelling carry accents, rather than being the stripped-down form of the same word? */
const hasDiacritics = (s: string): boolean => foldAccents(s) !== s.toLowerCase();

/**
 * The label a new mention should be written under, so accent-variant spellings land on one row.
 *
 * The first spelling stands, with one exception: an ACCENTED spelling beats an unaccented one.
 * "Écossaise" is the piece's actual name and "Ecossaise" is what it looks like typed in a hurry,
 * so the richer spelling is the more specific claim and wins — otherwise a hurried first mention
 * would fix the wrong name on the shelf forever, with no way to correct it by saying it properly.
 * Never the other way round: a stripped spelling must not overwrite an accented one.
 *
 * Same normalized text is not proof of the same piece once a stated fact disagrees: an incoming
 * "Etude" (composer "Chopin") meeting an on-file "Étude" (composer "Debussy") must land as its own
 * row, never overwrite one that merely sounds the same. That case falls through exactly like "no
 * match at all" — the incoming spelling stands, unchanged.
 */
export function canonicalLabel(
  existing: ComparableItem[],
  incoming: string,
  facts: Pick<ComparableItem, 'meta' | 'collection_name'> = {},
): string {
  const match = existing.find((i) => samePiece(i.label, incoming));
  if (!match) return incoming;
  if (factsDiffer(statedFacts(facts), statedFacts(match))) return incoming;
  return hasDiacritics(incoming) && !hasDiacritics(match.label) ? incoming : match.label;
}
