import { sql } from '../db/sql.ts';
import type { OccurrenceStatus } from '@cadence/shared';

/**
 * The hold-menu's edits to ONE occurrence — move it to another day, copy it onto one, remove it.
 * Its own file: occurrences.ts is past the size gate, and these three writes are a distinct
 * responsibility (the person rearranging their own week by hand, not the scheduler or the coach).
 *
 * Every write is dual-keyed on user_id, so a cross-user id misses rather than edits. The unique
 * (activity_id, date) index is the constraint that shapes all of it: an activity can sit on a day
 * once, so a move or a copy onto a day that already holds it is a CONFLICT the service reports,
 * never a second row.
 */
export interface OccurrenceEditRow {
  occurrence_id: string;
  activity_id: string;
  date: string;
  status: OccurrenceStatus;
  title: string;
  recurrence: string | null;
}

/** The row the edit is about, with the two activity facts the service's rules read. */
export async function getOccurrenceForEdit(userId: string, occurrenceId: string): Promise<OccurrenceEditRow | null> {
  const [row] = await sql<OccurrenceEditRow[]>`
    select o.occurrence_id, o.activity_id, to_char(o.date, 'YYYY-MM-DD') as date, o.status,
           a.title, a.schedule->>'recurrence' as recurrence
    from cadence.occurrences o
    join cadence.activities a on a.activity_id = o.activity_id
    where o.user_id = ${userId} and o.occurrence_id = ${occurrenceId}`;
  return row ?? null;
}

/** Whatever the same activity already has on `date` — the row a move or copy would collide with. */
export async function findOccurrenceOnDate(
  userId: string,
  activityId: string,
  date: string,
): Promise<{ occurrence_id: string; status: OccurrenceStatus } | null> {
  const [row] = await sql<Array<{ occurrence_id: string; status: OccurrenceStatus }>>`
    select occurrence_id, status
    from cadence.occurrences
    where user_id = ${userId} and activity_id = ${activityId} and date = ${date}
    limit 1`;
  return row ?? null;
}

/** Re-date the row in place. Its id, session, log and status all ride along — a moved task is
 *  the same task on a different day, not a fresh one. */
export async function moveOccurrenceDate(userId: string, occurrenceId: string, date: string): Promise<boolean> {
  const res = await sql`
    update cadence.occurrences set date = ${date}
    where user_id = ${userId} and occurrence_id = ${occurrenceId}`;
  return res.count > 0;
}

/**
 * A fresh PENDING row for the same activity on `date`, carrying the source's session so the copy
 * opens without a second 30-60s write. Never the log, value or status — a copy is something still
 * to do. `on conflict do nothing` makes a race with a same-day row a null, never a duplicate.
 */
export async function duplicateOccurrenceTo(
  userId: string,
  occurrenceId: string,
  date: string,
): Promise<string | null> {
  const [row] = await sql<Array<{ occurrence_id: string }>>`
    insert into cadence.occurrences (activity_id, user_id, date, status, session)
    select activity_id, user_id, ${date}, 'pending', session
    from cadence.occurrences
    where user_id = ${userId} and occurrence_id = ${occurrenceId}
    on conflict (activity_id, date) do nothing
    returning occurrence_id`;
  return row?.occurrence_id ?? null;
}

export async function deleteOccurrence(userId: string, occurrenceId: string): Promise<boolean> {
  const res = await sql`
    delete from cadence.occurrences
    where user_id = ${userId} and occurrence_id = ${occurrenceId}`;
  return res.count > 0;
}
