import type { OccurrenceLog } from '@cadence/shared';
import { getActivePlan } from '../repos/plans.ts';
import { getOrCreateAdhocActivity, getUserActivity } from '../repos/activities.ts';
import { getOrInsertOccurrenceId } from '../repos/occurrences.ts';
import { logOccurrence } from './session-log.ts';

/** How far back an off-plan entry may be dated. Matches the consistency window's spirit — recent
 *  reality, not open-ended backfill. NB: a date before the streak's `last_evaluated` still updates
 *  rollingConsistency (recomputed each read) but won't rewrite an already-finalized streak day. */
const MAX_BACKDATE_DAYS = 14;
const DAY = 86_400_000;

/**
 * Resolve + bound the target date for an off-plan log. Pure. Returns the YYYY-MM-DD to use, or
 * null if the requested date is malformed, in the future, or older than the backdate window.
 * Defaults to today (UTC) when no date is given.
 */
export function resolveAdhocDate(date: string | undefined, nowMs: number): string | null {
  const now = new Date(nowMs);
  const todayMs = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  if (!date) return new Date(todayMs).toISOString().slice(0, 10);
  const dMs = Date.parse(`${date}T00:00:00Z`);
  if (!Number.isFinite(dMs) || dMs > todayMs || dMs < todayMs - MAX_BACKDATE_DAYS * DAY) return null;
  return date;
}

/**
 * Log an OFF-PLAN activity the user just did ("did a hotel yoga class", "walked 5k") — the
 * honest-logging half of Req 4. It lands as a `done` occurrence on the day (default today), so it
 * counts toward consistency + the streak exactly like a scheduled session. Attaches to the
 * per-plan "Off-plan" bucket activity and reuses the normal parse-session-log path (logOccurrence),
 * so "ran 2km, felt easy" is parsed into items/metrics the same way a scheduled log is.
 *
 * Returns null when there's no committed plan to hang it on, or the date is out of range (route →
 * 409). v1: one off-plan entry per day (the unique (activity_id, date) index) — a second same-day
 * call REPLACES that day's off-plan log rather than appending; richer narrative belongs in coach chat.
 */
export async function logAdhocActivity(
  userId: string,
  text: string,
  date?: string,
): Promise<{ log: OccurrenceLog; summary: string } | null> {
  const dateIso = resolveAdhocDate(date, Date.now());
  if (!dateIso) return null;

  const plan = await getActivePlan(userId);
  if (!plan) return null;

  const activity = await getOrCreateAdhocActivity(userId, plan.plan_id);
  const occurrenceId = await getOrInsertOccurrenceId(activity.activity_id, userId, dateIso);
  return logOccurrence(userId, occurrenceId, text);
}

/**
 * The goal-aware half of the "＋": log a PLANNED activity the user actually did. Unlike
 * logAdhocActivity (generic Off-plan bucket), this credits the real activity — upserting a `done`
 * occurrence for the day (default today) via the (activity_id, date) unique key — so it counts
 * toward that goal's progression (history is keyed by title) AND consistency/the streak. This is
 * the "did my Thursday workout on Wednesday" case: a done strength occurrence lands today; the
 * still-scheduled future one is untouched. Text is optional (defaults to "Did {title}").
 *
 * Returns null when the activity isn't this user's, or the date is out of range (route → 404).
 */
export async function logPlannedActivity(
  userId: string,
  activityId: string,
  text?: string,
  date?: string,
): Promise<{ log: OccurrenceLog; summary: string } | null> {
  const dateIso = resolveAdhocDate(date, Date.now());
  if (!dateIso) return null;

  const activity = await getUserActivity(userId, activityId);
  if (!activity) return null;

  const occurrenceId = await getOrInsertOccurrenceId(activity.activity_id, userId, dateIso);
  return logOccurrence(userId, occurrenceId, text?.trim() || `Did ${activity.title}`);
}
