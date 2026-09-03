import { normTitle } from './goal-identity.ts';
import { describedItems } from './repertoire-describe.ts';

/**
 * The practice write-back — the deterministic rung that makes the rotation rotate.
 *
 * Matching is precision-first, because the two costs are asymmetric (the repo comment's own
 * rule): a miss leaves one stale date and the next log gets another chance; a false hit pushes a
 * piece to the back of the rotation where nothing ever corrects it. Hence:
 *
 *  - **Scoped by goal.** Only items linked to the session's goal (or linked to no goal at all)
 *    can match — "had a melody stuck in my head" on a run log must not stamp the piano piece
 *    "Melody", and it can't: Melody rides the piano goal, the run doesn't.
 *  - **Whole words on normalized text.** Both sides go through `normTitle` (the same normalizer
 *    goal matching trusts, which lowercases, folds accents to their base letter, and reduces
 *    punctuation to spaces), and needles match only at word boundaries — an item called "Rain"
 *    does not match "training". Because normTitle folds, a stored "Écossaise" matches a typed
 *    "Ecossaise", and NFC/NFD spellings of either reduce identically.
 *  - **The label's CORE matches too.** Stored labels carry qualifiers the user's own words never
 *    will — "A Short Story (Lichner)", "Écossaise by J.N. Hummel", "Minuet in G Major, BWV 822"
 *    — so a second needle strips parentheticals, a trailing "by …", and anything after a comma.
 *  - **Every standing can stamp.** The scope is the goal, never the standing: someone who plays a
 *    piece they have retired, or reads through one they have not started, did that — see
 *    `matchableItems`.
 */
export const needles = (label: string): string[] => {
  const full = normTitle(label.normalize('NFC'));
  const core = normTitle(
    label
      .normalize('NFC')
      .replace(/\s*\([^)]*\)/g, '')
      .replace(/\s+by\s+.+$/i, '')
      .replace(/,.*$/, ''),
  );
  return [...new Set([full, core])].filter((n) => n.length >= 4);
};

const containsWord = (hay: string, needle: string): boolean => ` ${hay} `.includes(` ${needle} `);

/* ── The matcher, exposed ────────────────────────────────────────────────────────────────────
   The three rules above (goal scope, whole words on normalized text, the label's core) are the
   repo's one answer to "did they mean THIS item". Two other callers now need that answer — the
   settled-tempo write and the prescribe-time tempo fill — so it is exported rather than copied.
   A second, subtly different spelling of this matching is exactly the drift CLAUDE.md warns
   about: it would not throw, it would just stamp the wrong piece. */

/* ── Titles that name more than one piece ────────────────────────────────────────────────────
   Classical repertoire collides BY DESIGN. Suzuki Book 2 alone carries "Minuet in G Major, BWV
   822", "Minuet in G Major (from Notebook for Anna Magdalena Bach)" and "Minuet in G Minor, BWV
   822" — and the core needle, which exists so a casual "a short story" finds "A Short Story
   (Lichner)", strips exactly the qualifier that tells those minuets apart. All three reduced to
   "minuet in g major", so a log saying that stamped TWO pieces and a step titled that wrote its
   tempo onto whichever label happened to be longest.

   So a needle carried by more than one item on the shelf is evidence of nothing: it names a
   family, not a piece. It is dropped from every item that has it, and the mention matches nothing
   rather than guessing. That is this module's asymmetry applied honestly — a miss leaves one
   stale date and self-corrects next log; a false hit writes the wrong piece's history and never
   does. The fully-qualified spelling still matches on its own, unique needle. */

/** Needles shared by two or more items — they cannot distinguish, so they must not decide. */
export function ambiguousNeedles(items: Array<{ label: string }>): ReadonlySet<string> {
  const seen = new Map<string, number>();
  for (const i of items) for (const n of needles(i.label)) seen.set(n, (seen.get(n) ?? 0) + 1);
  return new Set([...seen].filter(([, count]) => count > 1).map(([n]) => n));
}

/** The colliding groups, for telling the coach which of her titles cannot be resolved alone. */
export function collidingTitles(items: Array<{ label: string }>): Array<{ shared: string; labels: string[] }> {
  const ambiguous = ambiguousNeedles(items);
  const groups = new Map<string, string[]>();
  for (const i of items) {
    for (const n of needles(i.label)) {
      if (!ambiguous.has(n)) continue;
      groups.set(n, [...(groups.get(n) ?? []), i.label]);
    }
  }
  return [...groups].map(([shared, labels]) => ({ shared, labels }));
}

/**
 * Items this session's goal is allowed to touch at all.
 *
 * Scoped by GOAL and by nothing else. It used to drop the parked ones as "out of the rotation by
 * definition", and under the four standings that reasoning no longer holds anywhere: playing
 * something you have retired, or reading through one you have not started yet, is a real thing
 * that happened, and `last_practiced_at` is a record of what happened. A mention is a mention.
 * Only the ROTATION is standing-scoped — `pickDueNext` runs over `known` and nothing else.
 */
export function matchableItems<T extends { status: string; goal_id: string | null }>(
  items: T[],
  goalId?: string | null,
): T[] {
  return items.filter((i) => i.goal_id == null || i.goal_id === (goalId ?? null));
}

/** Normalize a body of text into the haystack the needles are tested against. '' when empty. */
export function matchHay(texts: Array<string | null | undefined>): string {
  const body = texts.filter((t): t is string => !!t?.trim()).join('\n');
  return body ? normTitle(body.normalize('NFC')) : '';
}

/**
 * Is this item named in an already-normalized haystack? Pass `ambiguous` (from
 * `ambiguousNeedles` over the SAME scoped set) so a needle that names several pieces cannot
 * decide for any of them — without it this answers per-label and will happily match all three
 * minuets on the word they share.
 */
export function itemNamedIn(label: string, hay: string, ambiguous?: ReadonlySet<string>): boolean {
  return needles(label).some((n) => !ambiguous?.has(n) && containsWord(hay, n));
}

/**
 * The single item a lone title names, or null. Where several match, the LONGEST label wins — with
 * "Study" and "Study in C major" both on file, a step called "Study in C major" means the second,
 * and picking by row order would be a coin flip.
 *
 * A title that names nothing outright falls through to description (`describedItems`), and only
 * when that leaves exactly ONE candidate: this function's answer is acted on directly — a tempo is
 * written to whatever it returns — so a second-guess it cannot make alone must return null.
 */
export function findItemForTitle<T extends { label: string; status: string; goal_id: string | null }>(
  items: T[],
  title: string,
  goalId?: string | null,
): T | null {
  const hay = matchHay([title]);
  if (!hay) return null;
  const scoped = matchableItems(items, goalId);
  const ambiguous = ambiguousNeedles(scoped);
  const hits = scoped.filter((i) => itemNamedIn(i.label, hay, ambiguous));
  if (hits.length > 0) return hits.sort((a, b) => b.label.length - a.label.length)[0] ?? null;
  const described = describedItems(scoped, [title]);
  return described.length === 1 ? (described[0] as T) : null;
}
