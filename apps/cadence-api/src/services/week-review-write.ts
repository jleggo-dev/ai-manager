/**
 * The week-review's write paths — plain CRUD, no model, never reached via coach-actions.ts (that's
 * the coach's own tool surface; another agent owns wiring these to it). Every write here follows the
 * house rule `correct_log` (coach-actions.ts) already states: a correction that names one field must
 * not erase whatever else the row already carried, so re-editing anything already decided reads the
 * row first and writes back the merged whole — `correctOccurrenceLog` overwrites whichever columns
 * it's given, in full, and the caller owns the merge.
 */
import type { OccurrenceLog, OccurrenceStatus } from '@cadence/shared';
import {
  correctOccurrenceLog,
  findMealOccurrence,
  getOccurrenceWithActivity,
  setOccurrenceStatus,
} from '../repos/occurrences.ts';

/** Same summary rebuild `correct_log` uses: derived from the MERGED value, never just the field that
 *  was named, so the stored summary and the numbers it describes can't drift apart. */
function summarizeValue(value: Record<string, number>): string {
  return Object.entries(value)
    .map(([k, v]) => `${v} ${k.replace(/_/g, ' ')}`)
    .join(', ');
}

/**
 * Confirm (or correct) a movement/practice session row.
 *
 * A fresh `pending` row's `value` column is empty, so the first confirm can write the whole column
 * safely; anything already decided gets read-merge-written instead, so correcting the minutes on an
 * already-done session can't quietly erase distance, HR, or anything else logged alongside it.
 */
export async function confirmSession(
  userId: string,
  occurrenceId: string,
  input: { done: boolean; minutes?: number },
): Promise<boolean> {
  const occ = await getOccurrenceWithActivity(userId, occurrenceId);
  if (!occ) return false;
  const wasPending = occ.status === 'pending';

  if (!input.done) {
    if (wasPending) await setOccurrenceStatus(userId, occurrenceId, 'skipped');
    else await correctOccurrenceLog(userId, occurrenceId, { status: 'skipped' });
    return true;
  }

  if (wasPending) {
    await setOccurrenceStatus(
      userId,
      occurrenceId,
      'done',
      input.minutes != null ? { duration_min: input.minutes } : undefined,
    );
    return true;
  }

  // Re-editing an already-decided row's minutes — read-merge-write, never a bare value swap.
  const value = input.minutes != null ? { ...(occ.value ?? {}), duration_min: input.minutes } : occ.value;
  await correctOccurrenceLog(userId, occurrenceId, {
    status: 'done',
    ...(value ? { value } : {}),
    ...(occ.log && value ? { log: { ...occ.log, summary: summarizeValue(value) } } : {}),
  });
  return true;
}

/** Toggle a day's meal slot both directions — `findMealOccurrence` (status-agnostic, unlike
 *  `findPendingMealOccurrence`) is what makes the reverse direction possible at all. `false` when
 *  no per-meal row exists for that day (a plan predating the per-meal split, or outside the
 *  materialized horizon) — there's nothing here to toggle. */
export async function toggleMealSlot(userId: string, date: string, meal: string, logged: boolean): Promise<boolean> {
  const found = await findMealOccurrence(userId, date, meal);
  if (!found) return false;
  await setOccurrenceStatus(userId, found.occurrence_id, logged ? 'done' : 'pending');
  return true;
}

/**
 * Flip one named step of a mind/practice occurrence's checklist.
 *
 * When there's no log yet, the checklist is seeded from the cached session's item names (all
 * `done: false`) rather than the empty-`items` template `recordWeighIn` uses for its one-number
 * capture — a step checklist has names to carry from the moment it exists. A session item added
 * since the log was last written is folded in too, so the checklist never quietly drops a step.
 *
 * Status follows the checklist, not the other way around: reaching all-done sets the occurrence
 * `done`; un-flipping the step that was holding it at all-done reverts it to `pending`. Any other
 * transition leaves status alone — a step toggle on an already-`skipped` row doesn't un-skip it.
 */
export async function toggleMindStep(
  userId: string,
  occurrenceId: string,
  stepName: string,
  done: boolean,
): Promise<boolean> {
  const occ = await getOccurrenceWithActivity(userId, occurrenceId);
  if (!occ) return false;

  const names = occ.session?.blocks.flatMap((b) => b.items.map((i) => i.name)) ?? [];
  if (names.length === 0) return false; // nothing named to check off — confirmSession is the right call

  const byName = new Map((occ.log?.items ?? names.map((name) => ({ name, done: false }))).map((i) => [i.name, i]));
  for (const name of names) if (!byName.has(name)) byName.set(name, { name, done: false });
  if (!byName.has(stepName)) return false; // not a step this occurrence actually has

  const items = [...byName.values()].map((i) => (i.name === stepName ? { ...i, done } : i));
  const allDone = names.every((name) => items.find((i) => i.name === name)?.done === true);

  const doneCount = items.filter((i) => i.done).length;
  const summary = `${doneCount} of ${names.length} step${names.length === 1 ? '' : 's'} done.`;
  const log: OccurrenceLog = {
    items,
    summary,
    raw_text: occ.log?.raw_text ?? summary,
    logged_at: new Date().toISOString(),
  };
  const status: OccurrenceStatus = allDone ? 'done' : occ.status === 'done' ? 'pending' : occ.status;

  await correctOccurrenceLog(userId, occurrenceId, { log, status });
  return true;
}
