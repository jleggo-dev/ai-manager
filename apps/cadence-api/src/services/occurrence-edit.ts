import type { OccurrenceStatus } from '@cadence/shared';
import { getActivePlan } from '../repos/plans.ts';
import { getUser } from '../repos/users.ts';
import {
  deleteOccurrence,
  duplicateOccurrenceTo,
  findOccurrenceOnDate,
  getOccurrenceForEdit,
  moveOccurrenceDate,
  type OccurrenceEditRow,
} from '../repos/occurrence-edit.ts';
import { DEFAULT_HORIZON_DAYS } from './plan-horizon.ts';
import { localDayIso, localDayIsoPlus } from './plan-day.ts';

/**
 * Rearranging one's own week by hand (the trail's hold menu, 2026-09-07): move a task to another
 * day, put a copy of it on one, take it off the plan. The coach is not consulted — these are the
 * person's own small edits, the kind that never earned a conversation — and nothing here
 * re-synthesizes anything.
 *
 * One rule shapes the two dated edits: **the target day is in the current week** — today through
 * the plan's own horizon, in the user's zone (the same "today" the plan view stands in). The
 * client only offers those days, and the server holds the line so a stale week on a phone cannot
 * move a task onto a day that is already gone.
 */
export type OccurrenceEditResult =
  | { status: 'ok'; occurrence_id: string }
  | { status: 'not_found' }
  /** The target is outside this week — `from`/`to` say what the week is, so the client can say so. */
  | { status: 'out_of_range'; from: string; to: string }
  /** The same activity already sits on that day. The client decides what that means: for a
   *  "do it now" it is the row to open instead; for a move it is a day that already has this. */
  | { status: 'conflict'; existing_occurrence_id: string; existing_status: OccurrenceStatus };

export interface EditWindow {
  from: string;
  to: string;
}

/** Pure: is `date` within [from, to]? Bare YYYY-MM-DD strings compare lexically. */
export function dateInWindow(date: string, w: EditWindow): boolean {
  return date >= w.from && date <= w.to;
}

/** This week, as the plan view draws it: today (user's zone) through the plan's horizon. Null
 *  with no committed plan — there is no week to move anything within. */
export async function editWindow(userId: string, tzHint?: string | null): Promise<EditWindow | null> {
  const [plan, user] = await Promise.all([getActivePlan(userId), getUser(userId).catch(() => null)]);
  if (!plan) return null;
  const now = new Date();
  const tz = user?.timezone ?? null;
  const days = plan.horizon_days ?? DEFAULT_HORIZON_DAYS;
  return { from: localDayIso(now, tz, tzHint), to: localDayIsoPlus(now, days - 1, tz, tzHint) };
}

type Gate = { ok: true; row: OccurrenceEditRow } | { ok: false; result: OccurrenceEditResult };

async function gate(userId: string, occurrenceId: string, date: string, tzHint?: string | null): Promise<Gate> {
  const row = await getOccurrenceForEdit(userId, occurrenceId);
  if (!row) return { ok: false, result: { status: 'not_found' } };
  const window = await editWindow(userId, tzHint);
  if (!window) return { ok: false, result: { status: 'not_found' } };
  if (!dateInWindow(date, window)) return { ok: false, result: { status: 'out_of_range', ...window } };
  return { ok: true, row };
}

function conflict(there: { occurrence_id: string; status: OccurrenceStatus }): OccurrenceEditResult {
  return { status: 'conflict', existing_occurrence_id: there.occurrence_id, existing_status: there.status };
}

/** Move the occurrence onto `date`. Moving a row onto its own day is a no-op that answers ok. */
export async function moveOccurrence(
  userId: string,
  occurrenceId: string,
  date: string,
  tzHint?: string | null,
): Promise<OccurrenceEditResult> {
  const g = await gate(userId, occurrenceId, date, tzHint);
  if (!g.ok) return g.result;
  if (g.row.date === date) return { status: 'ok', occurrence_id: occurrenceId };
  const there = await findOccurrenceOnDate(userId, g.row.activity_id, date);
  if (there) return conflict(there);
  const moved = await moveOccurrenceDate(userId, occurrenceId, date);
  return moved ? { status: 'ok', occurrence_id: occurrenceId } : { status: 'not_found' };
}

/** A fresh pending copy of the occurrence on `date` — the id returned is the COPY's. */
export async function duplicateOccurrence(
  userId: string,
  occurrenceId: string,
  date: string,
  tzHint?: string | null,
): Promise<OccurrenceEditResult> {
  const g = await gate(userId, occurrenceId, date, tzHint);
  if (!g.ok) return g.result;
  const there = await findOccurrenceOnDate(userId, g.row.activity_id, date);
  if (there) return conflict(there);
  const id = await duplicateOccurrenceTo(userId, occurrenceId, date);
  if (id) return { status: 'ok', occurrence_id: id };
  // The insert met a same-day row the pre-check just missed (a race) — report the conflict it is.
  const raced = await findOccurrenceOnDate(userId, g.row.activity_id, date);
  return raced ? conflict(raced) : { status: 'not_found' };
}

/** Take the occurrence off the plan. Any day, any status — the person's call, confirmed client-side. */
export async function removeOccurrence(userId: string, occurrenceId: string): Promise<'ok' | 'not_found'> {
  return (await deleteOccurrence(userId, occurrenceId)) ? 'ok' : 'not_found';
}
