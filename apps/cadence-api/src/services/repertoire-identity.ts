import { foldAccents, normTitle } from './goal-identity.ts';
import { ambiguousNeedles, needles } from './repertoire-match.ts';

/**
 * Could this label ever be found again once it is on the shelf?
 *
 * Writing "Minuet in G Major" beside two pieces that already answer to it produces a row nothing
 * can ever resolve: its only needle is the one shared needles rule now blocks, so it can never be
 * practised, stamped or given a tempo. A row like that is worse than no row — it looks like a
 * record and behaves like a hole.
 *
 * A re-mention of an existing piece is an update, not a new row, so that row is excluded from the
 * comparison. And a qualified addition is always fine: "Minuet in G Major (Petzold)" keeps a full
 * needle of its own even though its core collides.
 */
export function isResolvable(existing: Array<{ label: string }>, label: string): boolean {
  const prospective = [...existing.filter((i) => !samePiece(i.label, label)), { label }];
  const ambiguous = ambiguousNeedles(prospective);
  return needles(label).some((n) => !ambiguous.has(n));
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
 */
export function canonicalLabel(existing: Array<{ label: string }>, incoming: string): string {
  const match = existing.find((i) => samePiece(i.label, incoming));
  if (!match) return incoming;
  return hasDiacritics(incoming) && !hasDiacritics(match.label) ? incoming : match.label;
}
