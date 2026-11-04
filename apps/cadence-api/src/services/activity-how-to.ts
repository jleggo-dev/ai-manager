/**
 * "Every time" at the Recap (walkthrough v3 Phase 6c, R5 — owner 2026-11-03): a structure the
 * person changed and confirmed is kept as one plain sentence on the activity's standing
 * instruction, `activity.how_to`, the free text the coach reads when she writes every future
 * session (session-generate.ts). No schema: the same field the coach's own `rework` writes.
 *
 * The sentence comes from the structure diff's fixed copy (@cadence/shared played-diff.ts), never
 * from a model. It is appended, never rewritten over what is there, de-duplicated, and bounded
 * (HOW_TO_MAX). The row written is the ACTIVE plan's row for the commitment the session belongs
 * to — what the next session is prescribed from — and the sessions already written ahead for it
 * are cleared so the next open asks her again with the new instruction, the same consequence a
 * changed how_to has at a plan commit (plan-commit-diff.ts fingerprints it).
 *
 * Nothing here runs without a tap: Finish never calls it.
 */
import { HOW_TO_MAX, appendHowTo } from '@cadence/shared';
import { getActiveActivityForCommitment, getUserActivity, updateActivityHowTo } from '../repos/activities.ts';
import { clearFuturePendingSessions, getOccurrenceWithActivity } from '../repos/occurrences.ts';

/** A sentence longer than this is not one of the fixed ones. */
export const HOW_TO_SENTENCE_MAX = 160;

export type KeepHowToResult =
  | { status: 'written'; how_to: string; activity: string }
  /** Already there — the same sentence twice is one. Nothing was written. */
  | { status: 'present'; how_to: string; activity: string }
  /** The instruction is at its bound; nothing was written and nothing there was dropped. */
  | { status: 'full'; how_to: string; activity: string }
  | { status: 'not_found' };

export async function keepHowTo(userId: string, occurrenceId: string, sentence: string): Promise<KeepHowToResult> {
  const occ = await getOccurrenceWithActivity(userId, occurrenceId);
  if (!occ) return { status: 'not_found' };
  const own = await getUserActivity(userId, occ.activity_id);
  if (!own) return { status: 'not_found' };
  // The active plan's row for this commitment is what future sessions read; the occurrence's own
  // row is the fallback when the plan moved on under a session still being played.
  const target = (await getActiveActivityForCommitment(userId, own.commitment_id)) ?? own;
  const r = appendHowTo(target.how_to, sentence, HOW_TO_MAX);
  if (r.status !== 'written') return { status: r.status, how_to: r.how_to, activity: target.title };
  const wrote = await updateActivityHowTo(userId, target.activity_id, r.how_to);
  if (!wrote) return { status: 'not_found' };
  await clearFuturePendingSessions(userId, target.activity_id, occ.date);
  return { status: 'written', how_to: r.how_to, activity: target.title };
}
