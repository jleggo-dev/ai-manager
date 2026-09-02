import { renderRepertoire, type OccurrenceSession, type RepertoireItem } from '@cadence/shared';
import { clearPendingSessionsForGoal, listRepertoire, stampPracticed } from '../repos/repertoire.ts';
import { foldAccents, normTitle } from './goal-identity.ts';

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
 *  - **Parked items never stamp** — they are out of the rotation by definition.
 */
const needles = (label: string): string[] => {
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

/** Items this session's goal is allowed to touch at all. Parked items are out by definition. */
export function matchableItems<T extends { status: string; goal_id: string | null }>(
  items: T[],
  goalId?: string | null,
): T[] {
  return items.filter((i) => i.status !== 'parked' && (i.goal_id == null || i.goal_id === (goalId ?? null)));
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

/**
 * The single item a lone title names, or null. Where several match, the LONGEST label wins — with
 * "Study" and "Study in C major" both on file, a step called "Study in C major" means the second,
 * and picking by row order would be a coin flip.
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
  return hits.sort((a, b) => b.label.length - a.label.length)[0] ?? null;
}

export interface TouchOptions {
  /** The session's goal — items linked to a DIFFERENT goal can never match. */
  goalId?: string | null;
  /** When practice HAPPENED (the occurrence's date), not when it was written up. */
  at?: string;
}

/** Stamp any scoped repertoire item named in the texts; returns the labels touched. Also drops
 *  the touched goals' cached future sessions, so tomorrow's prescription sees today's rotation. */
export async function touchPracticedFromText(
  userId: string,
  texts: Array<string | null | undefined>,
  opts: TouchOptions = {},
): Promise<string[]> {
  const hay = matchHay(texts);
  if (!hay) return [];
  const items = await listRepertoire(userId);
  const scoped = matchableItems(items, opts.goalId);
  if (!scoped.length) return [];
  const ambiguous = ambiguousNeedles(scoped);
  const touched = scoped.filter((i) => itemNamedIn(i.label, hay, ambiguous));
  if (!touched.length) return [];
  await stampPracticed(
    userId,
    touched.map((i) => i.item_id),
    opts.at,
  );
  await invalidateSessionsFor(userId, touched);
  return touched.map((i) => i.label);
}

/** The names a cached prescription carries — what "they ticked it done" tells us was played. */
export function sessionTexts(session: OccurrenceSession | null | undefined): string[] {
  if (!session) return [];
  const out: string[] = [];
  for (const block of session.blocks ?? []) {
    for (const it of block.items ?? []) {
      if (it.name) out.push(it.name);
      if (it.detail) out.push(it.detail);
    }
  }
  return out;
}

/** Best-effort, fire-and-forget-safe: stale cached sessions for the goals whose rotation just
 *  moved. Distinct goals only; unlinked items invalidate nothing (no goal to scope to). */
export async function invalidateSessionsFor(
  userId: string,
  items: Array<Pick<RepertoireItem, 'goal_id'>>,
): Promise<void> {
  const goalIds = [...new Set(items.map((i) => i.goal_id).filter((g): g is string => !!g))];
  for (const goalId of goalIds) {
    await clearPendingSessionsForGoal(userId, goalId).catch((e) =>
      console.error('[repertoire] session invalidation failed (continuing):', e),
    );
  }
}

/** Enough to make the point without turning a long shelf into a lecture. */
const MAX_COLLISION_GROUPS = 3;

/**
 * The shelf as the coach reads it — the shared render, plus a warning naming any title that
 * belongs to more than one piece here.
 *
 * She needs this because the collision is hers to avoid rather than ours to guess: once two pieces
 * share a title, nothing downstream can resolve a bare mention of it, and the fix is for her to
 * name the piece in full when she writes it down or puts it in a session. Silence would leave her
 * writing "Minuet in G Major" forever and wondering why that step's tempo never sticks.
 *
 * Costs nothing on a shelf with no collisions, which is nearly all of them.
 */
export function renderRepertoireForCoach(items: RepertoireItem[], now?: number): string {
  const body = renderRepertoire(items, now);
  if (!body) return body;
  // Parked items are out of the rotation but still on the shelf, and a title she cannot resolve is
  // a problem wherever it sits — so collisions are computed over everything rendered.
  const collisions = collidingTitles(items);
  if (collisions.length === 0) return body;

  const lines = ['', 'TITLES THAT NAME MORE THAN ONE PIECE HERE:'];
  for (const group of collisions.slice(0, MAX_COLLISION_GROUPS)) {
    lines.push(`  - ${group.labels.map((l) => `"${l}"`).join(' and ')}`);
  }
  if (collisions.length > MAX_COLLISION_GROUPS) {
    lines.push(`  ...and ${collisions.length - MAX_COLLISION_GROUPS} more such groups`);
  }
  lines.push(
    '  Name one of these in full whenever you write it down or put it in a session - the composer,',
    '  the catalogue number, or the collection it comes from. A bare shared title cannot be matched',
    '  to a row, so practice logged against it counts for nothing and its tempo is never kept.',
  );
  return `${body}\n${lines.join('\n')}`;
}
