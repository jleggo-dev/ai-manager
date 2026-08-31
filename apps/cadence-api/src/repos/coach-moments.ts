import type {
  CheckinAdjustment,
  FeltStateCode,
  MoodValue,
  RpeCode,
  SessionFeedbackKind,
  SkipReasonCode,
} from '@cadence/shared';
import { sql } from '../db/sql.ts';

/**
 * Storage for the two signals Cadence's moments capture: how a session FELT, and the once-a-day
 * check-in. Both are deliberately thin — they record an answer and nothing else. Nothing here
 * mutates a plan; the check-in's "adjust" hands a steer to the ordinary suggest→preview→confirm
 * flow so a plan can never move by a route the user can't see or undo.
 */

export interface SessionFeedbackRow {
  feedback_id: string;
  occurrence_id: string | null;
  kind: SessionFeedbackKind;
  rpe: RpeCode | null;
  felt_state: FeltStateCode | null;
  reason_code: SkipReasonCode | null;
  created_at: string;
}

/**
 * Record how a session felt. Upserts on occurrence — re-answering corrects the answer rather
 * than appending a second opinion, which would double-count in any trend built on this.
 * Ad-hoc sessions (no occurrence) always insert; there is no key to collapse them on.
 */
export async function saveSessionFeedback(
  userId: string,
  input: {
    occurrenceId: string | null;
    kind: SessionFeedbackKind;
    rpe?: RpeCode | null;
    feltState?: FeltStateCode | null;
    reasonCode?: SkipReasonCode | null;
  },
): Promise<void> {
  const { occurrenceId, kind } = input;
  const rpe = input.rpe ?? null;
  const felt = input.feltState ?? null;
  const reason = input.reasonCode ?? null;

  if (!occurrenceId) {
    await sql`
      insert into cadence.session_feedback (user_id, occurrence_id, kind, rpe, felt_state, reason_code)
      values (${userId}, null, ${kind}, ${rpe}, ${felt}, ${reason})`;
    return;
  }
  await sql`
    insert into cadence.session_feedback (user_id, occurrence_id, kind, rpe, felt_state, reason_code)
    values (${userId}, ${occurrenceId}, ${kind}, ${rpe}, ${felt}, ${reason})
    on conflict (occurrence_id) where occurrence_id is not null
    do update set kind = excluded.kind, rpe = excluded.rpe,
                  felt_state = excluded.felt_state, reason_code = excluded.reason_code,
                  created_at = now()`;
}

/**
 * The most recent answer for a given activity — the pre-activity insight's only honest source.
 * Joined through occurrences so "last time you did THIS" means the same activity, not merely
 * the last thing the user answered about.
 */
export async function lastFeedbackForActivity(userId: string, activityId: string): Promise<SessionFeedbackRow | null> {
  const [row] = await sql<SessionFeedbackRow[]>`
    select f.feedback_id, f.occurrence_id, f.kind, f.rpe, f.felt_state, f.reason_code, f.created_at
    from cadence.session_feedback f
    join cadence.occurrences o on o.occurrence_id = f.occurrence_id
    where f.user_id = ${userId} and o.activity_id = ${activityId}
    order by f.created_at desc
    limit 1`;
  return row ?? null;
}

/** Recent answers across everything — the weekly check-in's raw material. */
export async function recentFeedback(userId: string, days = 7): Promise<SessionFeedbackRow[]> {
  return sql<SessionFeedbackRow[]>`
    select feedback_id, occurrence_id, kind, rpe, felt_state, reason_code, created_at
    from cadence.session_feedback
    where user_id = ${userId} and created_at >= now() - make_interval(days => ${days})
    order by created_at desc`;
}

/**
 * Same rows as `recentFeedback`, windowed by an explicit [fromDate, toDate] instead of a
 * trailing day count — the `balance` widget's binding (Progress Engine W1-5), which re-windows
 * by the page's Week/Month/All control rather than a fixed lookback.
 */
export async function feedbackInRange(userId: string, fromDate: string, toDate: string): Promise<SessionFeedbackRow[]> {
  return sql<SessionFeedbackRow[]>`
    select feedback_id, occurrence_id, kind, rpe, felt_state, reason_code, created_at
    from cadence.session_feedback
    where user_id = ${userId} and created_at::date >= ${fromDate} and created_at::date <= ${toDate}
    order by created_at desc`;
}

export interface DailyCheckinRow {
  date: string;
  mood: MoodValue | null;
  adjustment: CheckinAdjustment | null;
  dismissed_at: string | null;
}

/** Today's check-in row, if the user has already answered or dismissed it. */
export async function getDailyCheckin(userId: string, date: string): Promise<DailyCheckinRow | null> {
  const [row] = await sql<DailyCheckinRow[]>`
    select date::text, mood, adjustment, dismissed_at
    from cadence.daily_checkins
    where user_id = ${userId} and date = ${date}`;
  return row ?? null;
}

/**
 * Every check-in row in [fromDate, toDate] (inclusive), oldest first — the `felt_week` widget's
 * binding. Rows with a null mood (dismissed, or answered without one) come back too: the caller
 * is the one that decides "no mood noted" means an unread day, never a zero.
 */
export async function listDailyCheckins(userId: string, fromDate: string, toDate: string): Promise<DailyCheckinRow[]> {
  return sql<DailyCheckinRow[]>`
    select date::text, mood, adjustment, dismissed_at
    from cadence.daily_checkins
    where user_id = ${userId} and date >= ${fromDate} and date <= ${toDate}
    order by date`;
}

/**
 * Record (or update) today's check-in. Both fields are optional and independently settable —
 * someone may set a mood, scroll away, and come back to take an adjustment, and neither answer
 * should clear the other.
 */
export async function saveDailyCheckin(
  userId: string,
  date: string,
  patch: { mood?: MoodValue | null; adjustment?: CheckinAdjustment | null; dismissed?: boolean },
): Promise<void> {
  const mood = patch.mood ?? null;
  const adjustment = patch.adjustment ?? null;
  const dismissed = patch.dismissed === true;
  await sql`
    insert into cadence.daily_checkins (user_id, date, mood, adjustment, dismissed_at)
    values (${userId}, ${date}, ${mood}, ${adjustment}, ${dismissed ? sql`now()` : null})
    on conflict (user_id, date) do update set
      mood = coalesce(excluded.mood, cadence.daily_checkins.mood),
      adjustment = coalesce(excluded.adjustment, cadence.daily_checkins.adjustment),
      dismissed_at = coalesce(excluded.dismissed_at, cadence.daily_checkins.dismissed_at)`;
}

/** Mood trend over the window — feeds the weekly check-in ("your Tuesdays keep feeling rough"). */
export async function recentMoods(userId: string, days = 14): Promise<{ date: string; mood: MoodValue }[]> {
  return sql<{ date: string; mood: MoodValue }[]>`
    select date::text, mood
    from cadence.daily_checkins
    where user_id = ${userId} and mood is not null and date >= current_date - ${days}::int
    order by date desc`;
}
