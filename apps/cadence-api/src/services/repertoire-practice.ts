import type { OccurrenceSession, RepertoireItem } from '@cadence/shared';
import { clearPendingSessionsForGoal, listRepertoire, stampPracticed } from '../repos/repertoire.ts';
import { normTitle } from './goal-identity.ts';

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
 *  - **Whole words on normalized text.** Both sides go through NFC + `normTitle` (the same
 *    normalizer goal matching trusts), and needles match only at word boundaries — an item
 *    called "Rain" does not match "training".
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

/** Is this item named in an already-normalized haystack? */
export function itemNamedIn(label: string, hay: string): boolean {
  return needles(label).some((n) => containsWord(hay, n));
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
  const hits = matchableItems(items, goalId).filter((i) => itemNamedIn(i.label, hay));
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
  const touched = scoped.filter((i) => itemNamedIn(i.label, hay));
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
