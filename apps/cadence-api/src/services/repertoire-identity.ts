import { foldAccents, normTitle } from './goal-identity.ts';
import { needles } from './repertoire-match.ts';
import { pieceQualifiers, type PieceQualifiers } from '@cadence/shared';

/**
 * True when a QUALIFIER stated on BOTH sides disagrees — the one fact that can tell two
 * same-titled pieces apart without a word added to the label itself (owner design 2026-09-02: the
 * item screen's COMPOSER/COLLECTION/CATALOGUE NO. fields). Absence on either side decides
 * nothing — an unqualified item might still be either piece, so only a STATED disagreement counts;
 * this is `isResolvable`'s own asymmetry (a miss self-corrects, a false "these are different"
 * would not) applied to qualifiers instead of needles.
 */
function qualifiersDiffer(a: PieceQualifiers, b: PieceQualifiers): boolean {
  const disagree = (x?: string, y?: string) => !!x && !!y && x.toLowerCase() !== y.toLowerCase();
  return disagree(a.composer, b.composer) || disagree(a.catalogue, b.catalogue) || disagree(a.collection, b.collection);
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
 * label text — two items titled identically-short but carrying DIFFERENT `meta.composer` (or
 * catalogue, or collection) are different pieces too, so a needle they share blocks neither: the
 * title can stay short and the qualifier field does the work instead of a parenthetical.
 */
export function isResolvable(
  existing: Array<{ label: string; meta?: Record<string, unknown> | null }>,
  label: string,
  meta?: Record<string, unknown> | null,
): boolean {
  const others = existing.filter((i) => !samePiece(i.label, label));
  const mine = pieceQualifiers(meta);
  return needles(label).some((n) => {
    const sharers = others.filter((i) => needles(i.label).includes(n));
    return sharers.every((i) => qualifiersDiffer(mine, pieceQualifiers(i.meta)));
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
 * Same normalized text is not proof of the same piece once a stated qualifier disagrees: an
 * incoming "Etude" (meta.composer "Chopin") meeting an on-file "Étude" (meta.composer "Debussy")
 * must land as its own row, never overwrite one that merely sounds the same. That case falls
 * through exactly like "no match at all" — the incoming spelling stands, unchanged.
 */
export function canonicalLabel(
  existing: Array<{ label: string; meta?: Record<string, unknown> | null }>,
  incoming: string,
  meta?: Record<string, unknown> | null,
): string {
  const match = existing.find((i) => samePiece(i.label, incoming));
  if (!match) return incoming;
  if (qualifiersDiffer(pieceQualifiers(meta), pieceQualifiers(match.meta))) return incoming;
  return hasDiacritics(incoming) && !hasDiacritics(match.label) ? incoming : match.label;
}
