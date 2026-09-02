import { renderRepertoire, type OccurrenceSession, type RepertoireItem } from '@cadence/shared';
import { clearPendingSessionsForGoal, listRepertoire, stampPracticed } from '../repos/repertoire.ts';
import { ambiguousNeedles, collidingTitles, itemNamedIn, matchableItems, matchHay } from './repertoire-match.ts';
import { describedItems } from './repertoire-describe.ts';

// This file used to hold the whole repertoire-matching stack; it split three ways (match /
// describe / identity) so three parallel changes wouldn't collide on one file. Re-exporting
// everything keeps every existing importer working unchanged — this module's public surface is
// unchanged except that `needles` is now exported too (see repertoire-match.ts).
export * from './repertoire-match.ts';
export * from './repertoire-describe.ts';
export * from './repertoire-identity.ts';

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
  const named = scoped.filter((i) => itemNamedIn(i.label, hay, ambiguous));
  // Description runs ALONGSIDE naming here, not as a fallback: this path is usually handed the
  // prescription too, so the named set is rarely empty, and a fallback would never fire for the
  // case it exists to serve — someone writing up in their own words what the plan named formally.
  // `describedItems` scores each text on its own, so the extra texts cannot inflate each other.
  const touched = [...new Set([...named, ...describedItems(scoped, texts)])];
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
