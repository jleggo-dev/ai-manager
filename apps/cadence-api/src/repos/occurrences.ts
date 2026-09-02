import { sql, json, type SqlExecutor } from '../db/sql.ts';
import { WEIGH_IN_TITLE_SQL_PATTERN } from '@cadence/shared';
import type {
  Activity,
  Occurrence,
  OccurrenceLog,
  OccurrenceSession,
  OccurrenceStatus,
  OccurrenceWeather,
  Provenance,
} from '@cadence/shared';

export interface NewOccurrence {
  activity_id: string;
  user_id: string;
  date: string; // YYYY-MM-DD
  status?: OccurrenceStatus;
}

/**
 * Week / consistency / replan list row — matches `listOccurrences` SELECT (no session/log jsonb).
 * Callers that need the prescription or post-session report use `getOccurrenceWithActivity`.
 *
 * `kind` rides along from the parent activity because readers repeatedly have to tell an EFFORTFUL
 * commitment ('user') apart from a system tracking row ('system' — the per-meal food log, weigh-in).
 * Same line `pauseUserOccurrencesInWindow` draws; without it here, callers either re-join or, worse,
 * count the two together.
 */
export type OccurrenceListRow = Pick<
  Occurrence,
  'occurrence_id' | 'activity_id' | 'date' | 'status' | 'value' | 'provenance' | 'weather'
> & {
  kind: Activity['kind'];
  /** Whether a session is already cached — a flag, never the jsonb itself (see the SELECT's
   *  comment). Lets the prefetch skip warm rows at list time instead of paying a read per row. */
  has_session: boolean;
};

/** Bulk insert scheduled occurrences (idempotent on (activity_id, date)). */
export async function upsertOccurrences(rows: NewOccurrence[]): Promise<void> {
  if (rows.length === 0) return;
  const payload = rows.map((r) => ({
    activity_id: r.activity_id,
    user_id: r.user_id,
    date: r.date,
    status: r.status ?? 'pending',
  }));
  await sql`
    insert into cadence.occurrences ${sql(payload, 'activity_id', 'user_id', 'date', 'status')}
    on conflict (activity_id, date) do nothing`;
}

/**
 * Ensure an occurrence exists for (activity, date) and return its id — the ad-hoc log path, where
 * the row doesn't pre-exist (the off-plan bucket is never materialized by the scheduler). Upserts
 * against the unique (activity_id, date) index so a repeat same-day call returns the existing row
 * instead of colliding; the `do update` is a no-op that just forces RETURNING to yield the row.
 */
export async function getOrInsertOccurrenceId(activityId: string, userId: string, date: string): Promise<string> {
  const [row] = await sql<{ occurrence_id: string }[]>`
    insert into cadence.occurrences (activity_id, user_id, date, status)
    values (${activityId}, ${userId}, ${date}, 'pending')
    on conflict (activity_id, date) do update set date = excluded.date
    returning occurrence_id`;
  if (!row) throw new Error('getOrInsertOccurrenceId: no row returned');
  return row.occurrence_id;
}

export async function listOccurrences(userId: string, fromDate: string, toDate: string): Promise<OccurrenceListRow[]> {
  // Explicit columns, deliberately EXCLUDING session/log jsonb — this feeds the week view,
  // consistency, and replan context, none of which need the (potentially large) payloads.
  // The occurrence-detail path (getOccurrenceWithActivity) fetches them.
  // The activities join is for `a.kind` alone (see OccurrenceListRow) — activity_id is the PK on
  // the other side, so it can neither drop nor duplicate a row.
  // Ordered date-first, then by the activity's clock time so "soonest" is well-defined for the
  // prefetch (the 06:30 sit warms before the 18:00 run). Word times ("morning") and missing times
  // sort last within their day — best-effort, same stance minutesOfDay takes.
  return sql<OccurrenceListRow[]>`
    select o.occurrence_id, o.activity_id, o.date, o.status, o.value, o.provenance, o.weather, a.kind,
           (o.session is not null) as has_session
    from cadence.occurrences o
    join cadence.activities a on a.activity_id = o.activity_id
    where o.user_id = ${userId} and o.date >= ${fromDate} and o.date <= ${toDate}
    order by o.date, a.schedule->>'time_of_day' nulls last`;
}

/** Step counts (total prescribed items across a cached session's blocks) for occurrences in a range
 *  that already have a session — powers the trail's step ring in the plan view WITHOUT loading the
 *  full session jsonb into the app (a server-side jsonb count). Occurrences without a session are
 *  omitted (no ring until the coach has programmed the session). */
export async function listSessionStepCounts(
  userId: string,
  fromDate: string,
  toDate: string,
): Promise<Array<{ occurrence_id: string; steps: number }>> {
  return sql<Array<{ occurrence_id: string; steps: number }>>`
    select o.occurrence_id,
      coalesce((select sum(jsonb_array_length(b->'items'))
                from jsonb_array_elements(o.session->'blocks') b), 0)::int as steps
    from cadence.occurrences o
    where o.user_id = ${userId} and o.date >= ${fromDate} and o.date <= ${toDate} and o.session is not null`;
}

/**
 * Session + log jsonb for occurrences in a date range — the lean read the week-review's mind rows
 * need (step-level completion: `session.blocks[].items[].name` overlaid with `log.items[].done`),
 * without paying `listOccurrences`' cost of carrying those payloads for every row in the week when
 * only a handful (the mind/practice ones) actually want them. Same window shape as
 * `listSessionStepCounts`, one query, no join needed (nothing here comes from `activities`).
 */
export async function listOccurrenceSessionLogs(
  userId: string,
  fromDate: string,
  toDate: string,
): Promise<Array<{ occurrence_id: string; session: OccurrenceSession | null; log: OccurrenceLog | null }>> {
  return sql<Array<{ occurrence_id: string; session: OccurrenceSession | null; log: OccurrenceLog | null }>>`
    select occurrence_id, session, log
    from cadence.occurrences
    where user_id = ${userId} and date >= ${fromDate} and date <= ${toDate}`;
}

/**
 * Today's pending "Food log" system row, if any — the deterministic anchor the nutrition module
 * ticks when the first meal of the day is logged (mirrors the weigh-in title-test pattern).
 */
export async function findPendingFoodLogOccurrence(userId: string, date: string): Promise<string | null> {
  const [row] = await sql<{ occurrence_id: string }[]>`
    select o.occurrence_id
    from cadence.occurrences o
    join cadence.activities a on a.activity_id = o.activity_id
    where o.user_id = ${userId} and o.date = ${date} and o.status = 'pending'
      and a.kind = 'system' and a.title ~* 'food|meal|nutrition'
    limit 1`;
  return row?.occurrence_id ?? null;
}

/**
 * Today's pending meal-log system row for a specific meal (breakfast/lunch/dinner/snack) — the
 * redesign's per-meal tasks. `drink`/`other` (and any non-meal value) return null; the caller then
 * falls back to findPendingFoodLogOccurrence for plans that predate the per-meal split.
 */
export async function findPendingMealOccurrence(userId: string, date: string, meal: string): Promise<string | null> {
  if (!/^(breakfast|lunch|dinner|snack)$/.test(meal)) return null;
  const [row] = await sql<{ occurrence_id: string }[]>`
    select o.occurrence_id
    from cadence.occurrences o
    join cadence.activities a on a.activity_id = o.activity_id
    where o.user_id = ${userId} and o.date = ${date} and o.status = 'pending'
      and a.kind = 'system' and a.title ~* ${meal}
    limit 1`;
  return row?.occurrence_id ?? null;
}

/**
 * Today's — or any day's — meal-log system row for a specific meal, REGARDLESS of status. The
 * week-review's meal slots need to toggle a day both directions (logged → unlogged, not just the
 * one-way "log it" `findPendingMealOccurrence` was built for), so this drops that function's
 * `status = 'pending'` gate and returns the status alongside the id instead of assuming it.
 * Same `breakfast|lunch|dinner|snack` guard and title-regex match; `null` for anything else.
 */
export async function findMealOccurrence(
  userId: string,
  date: string,
  meal: string,
): Promise<{ occurrence_id: string; status: OccurrenceStatus } | null> {
  if (!/^(breakfast|lunch|dinner|snack)$/.test(meal)) return null;
  const [row] = await sql<Array<{ occurrence_id: string; status: OccurrenceStatus }>>`
    select o.occurrence_id, o.status
    from cadence.occurrences o
    join cadence.activities a on a.activity_id = o.activity_id
    where o.user_id = ${userId} and o.date = ${date}
      and a.kind = 'system' and a.title ~* ${meal}
    limit 1`;
  return row ?? null;
}

/** An occurrence joined with its activity — the payload behind the session detail sheet. */
export interface OccurrenceWithActivity extends Occurrence {
  title: string;
  kind: Activity['kind'];
  category?: string | null;
  goal_id?: string | null; // the activity's goal link (often null today) — rides onto goal_events
  schedule: Activity['schedule'] | null;
  target: Activity['target'] | null;
  why?: string | null; // the commitment's stored rationale (0012) — "why this session exists"
  how_to?: string | null;
}

/** Single occurrence + activity, DUAL-KEYED on user_id (cross-user ids must miss → 404). */
export async function getOccurrenceWithActivity(
  userId: string,
  occurrenceId: string,
): Promise<OccurrenceWithActivity | null> {
  const [row] = await sql<OccurrenceWithActivity[]>`
    select o.occurrence_id, o.activity_id, to_char(o.date, 'YYYY-MM-DD') as date, o.status,
           o.value, o.provenance, o.weather, o.session, o.log,
           a.title, a.kind, a.category, a.goal_id, a.schedule, a.target, a.why, a.how_to
    from cadence.occurrences o
    join cadence.activities a on a.activity_id = o.activity_id
    where o.user_id = ${userId} and o.occurrence_id = ${occurrenceId}`;
  return row ?? null;
}

/**
 * Attach weather jsonb ONLY if none exists yet — outdoor open/log paths race-safe.
 * Dual-keyed on user_id. Returns whether THIS write won.
 */
export async function setOccurrenceWeatherIfEmpty(
  userId: string,
  occurrenceId: string,
  weather: OccurrenceWeather,
): Promise<boolean> {
  const res = await sql`
    update cadence.occurrences
    set weather = ${json(weather)}
    where user_id = ${userId} and occurrence_id = ${occurrenceId} and weather is null`;
  return res.count > 0;
}

// The session-cache writes (set-if-empty, clear-for-revise) and the revision's upcoming list live
// in occurrence-sessions.ts — split out when this file crossed the 500-line gate (2026-08-31).

/**
 * Diff-aware commit invalidation (PLAN-CHANGES.md, Phase 1): move an UNCHANGED activity's future
 * pending occurrences onto the new plan version's row instead of letting the commit wipe them.
 * Runs inside commitActivities' transaction BEFORE deleteFuturePendingOccurrences — once
 * re-pointed, the rows belong to the new plan's activity and are out of the wipe's scope, and
 * their session/status/log/steps ride along untouched (occurrence_id is stable too, so a client
 * holding one keeps a working handle). ensureHorizon's on-conflict (activity_id, date) upsert
 * then counts them as already materialized rather than duplicating them.
 *
 * Bounded to [fromDate, toDate] — the NEW horizon — so a previously-extended plan's rows beyond
 * the incoming week still fall to the wipe, exactly as they always did. `status = 'pending'`
 * mirrors the wipe's scope: paused (episode-shelved) rows are outside both, as before. The
 * unique (activity_id, date) index cannot collide here — the new activity was inserted in this
 * same transaction and owns no occurrences yet. Returns the count re-pointed.
 */
export async function repointFuturePendingOccurrences(
  oldActivityId: string,
  newActivityId: string,
  fromDate: string,
  toDate: string,
  db: SqlExecutor = sql, // the sql.begin() tx handle when called inside commitActivities' transaction
): Promise<number> {
  const res = await db`
    update cadence.occurrences
    set activity_id = ${newActivityId}
    where activity_id = ${oldActivityId}
      and date >= ${fromDate}
      and date <= ${toDate}
      and status = 'pending'`;
  return res.count;
}

/**
 * Remove a superseded plan's still-pending FUTURE occurrences when a new plan version commits —
 * they're replaced by the new plan's schedule. Past + done/skipped occurrences are kept (that's
 * the user's history, and it feeds consistency). Runs AFTER repointFuturePendingOccurrences has
 * moved any unchanged activities' rows onto the new version, so what it deletes is only the
 * changed/removed remainder. Returns the number removed.
 */
export async function deleteFuturePendingOccurrences(
  planId: string,
  fromDate: string,
  db: SqlExecutor = sql, // the sql.begin() tx handle when called inside commitActivities' transaction
): Promise<number> {
  const res = await db`
    delete from cadence.occurrences o
    using cadence.activities a
    where o.activity_id = a.activity_id
      and a.plan_id = ${planId}
      and o.date >= ${fromDate}
      and o.status = 'pending'`;
  return res.count;
}

/**
 * Store the user's parsed post-session report in ONE update: log + numeric rollups +
 * provenance (first real writer of that column) + status → done. Dual-keyed and count-checked
 * — false means the occurrence isn't this user's / vanished under a replan (route → 404).
 */
export async function recordOccurrenceLog(
  userId: string,
  occurrenceId: string,
  fields: { log: OccurrenceLog; value: Record<string, number>; provenance: Provenance },
): Promise<boolean> {
  const res = await sql`
    update cadence.occurrences
    set log = ${json(fields.log)}, value = ${json(fields.value)}, provenance = ${json(fields.provenance)}, status = 'done'
    where user_id = ${userId} and occurrence_id = ${occurrenceId}`;
  return res.count > 0;
}

/**
 * The user's most recent logs for the SAME activity by TITLE, across plan versions — replan
 * recreates activities with new ids, so an id-keyed lookup would reset progression memory
 * exactly when the plan evolves. Feeds prescribe-session's <recent_logs> (the Adapt half).
 */
export async function listRecentLogsByTitle(
  userId: string,
  title: string,
  limit = 4,
): Promise<Array<{ date: string; log: OccurrenceLog }>> {
  return sql<Array<{ date: string; log: OccurrenceLog }>>`
    select to_char(o.date, 'YYYY-MM-DD') as date, o.log
    from cadence.occurrences o
    join cadence.activities a on a.activity_id = o.activity_id
    where o.user_id = ${userId} and lower(a.title) = ${title.toLowerCase()} and o.log is not null
    order by o.date desc
    limit ${limit}`;
}

/**
 * The EARLIEST same-title occurrence that has a cached session — the deterministic engine's anchor
 * (the eval week the Coach programmed). Title-keyed (like listRecentLogsByTitle) so it survives a
 * replan that recreates activities with new ids. Returns its scheduled date + the session template.
 */
export async function getAnchorSessionByTitle(
  userId: string,
  title: string,
): Promise<{ date: string; session: OccurrenceSession } | null> {
  const [row] = await sql<Array<{ date: string; session: OccurrenceSession }>>`
    select to_char(o.date, 'YYYY-MM-DD') as date, o.session
    from cadence.occurrences o
    join cadence.activities a on a.activity_id = o.activity_id
    where o.user_id = ${userId} and lower(a.title) = ${title.toLowerCase()} and o.session is not null
    order by o.date asc
    limit 1`;
  return row ?? null;
}

/** Done occurrences with their value/log payloads (oldest first) — the progress engine's feed. */
export async function listLoggedForProgress(
  userId: string,
  fromDate: string,
): Promise<
  Array<{
    date: string;
    title: string;
    kind: Activity['kind'];
    category: string | null;
    value: Record<string, number> | null;
    log: OccurrenceLog | null;
  }>
> {
  return sql<
    Array<{
      date: string;
      title: string;
      kind: Activity['kind'];
      category: string | null;
      value: Record<string, number> | null;
      log: OccurrenceLog | null;
    }>
  >`
    select to_char(o.date, 'YYYY-MM-DD') as date, a.title, a.kind, a.category, o.value, o.log
    from cadence.occurrences o
    join cadence.activities a on a.activity_id = o.activity_id
    where o.user_id = ${userId} and o.status = 'done' and o.date >= ${fromDate}
    order by o.date asc`;
}

/** One day's DONE user (movement) occurrences with their activity category + scheduled EFFORT
 *  minutes (not the whole session — owner ruling 2026-08-17) — the input to the deterministic
 *  exercise-burn estimate (net-calorie eat-back), whose MET constants assume effort intensity. */
export async function listDoneUserOccurrencesForDay(
  userId: string,
  date: string,
): Promise<Array<{ category: string | null; duration_min: number | null }>> {
  return sql<Array<{ category: string | null; duration_min: number | null }>>`
    select a.category, (a.schedule->>'duration_min')::int as duration_min
    from cadence.occurrences o
    join cadence.activities a on a.activity_id = o.activity_id
    where o.user_id = ${userId} and o.date = ${date} and o.status = 'done' and a.kind = 'user'`;
}

/** The user's weigh-in series (date + kg) over the trailing window — feeds the adaptive-target
 *  weight-trend read. Weigh-ins store `value.weight_kg` on their occurrence (see weigh-in.ts). */
/**
 * The user's weigh-in activity, if their plan has one (A23 §2c). Daily weigh-ins hang their
 * occurrence off this same activity rather than inventing a parallel store, so the series, the
 * history entry and the trend all keep coming from one place.
 */
export async function findWeighInActivity(userId: string): Promise<{ activity_id: string } | null> {
  const [row] = await sql<Array<{ activity_id: string }>>`
    select a.activity_id
    from cadence.activities a
    join cadence.plans p on p.plan_id = a.plan_id
    where a.user_id = ${userId} and a.kind = 'system' and a.title ~* ${WEIGH_IN_TITLE_SQL_PATTERN}
    order by (p.status = 'active') desc
    limit 1`;
  return row ?? null;
}

/**
 * This week's weigh-in row, so the check-in can carry it (A23 §2b). Its own query because
 * `listOccurrences` deliberately omits the activity title, and the week view has no use for it.
 * Prefers a still-pending row, else the most recent one in the window.
 */
export async function findWeighInOccurrence(
  userId: string,
  fromDate: string,
  toDate: string,
): Promise<{ occurrence_id: string; date: string; status: string } | null> {
  const [row] = await sql<Array<{ occurrence_id: string; date: string; status: string }>>`
    select o.occurrence_id, to_char(o.date, 'YYYY-MM-DD') as date, o.status
    from cadence.occurrences o
    join cadence.activities a on a.activity_id = o.activity_id
    where o.user_id = ${userId}
      and o.date >= ${fromDate} and o.date <= ${toDate}
      and a.kind = 'system' and a.title ~* 'weigh'
    order by (o.status = 'pending') desc, o.date desc
    limit 1`;
  return row ?? null;
}

export async function listWeighInSeries(userId: string, days = 60): Promise<Array<{ date: string; kg: number }>> {
  const from = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
  return sql<Array<{ date: string; kg: number }>>`
    select to_char(o.date, 'YYYY-MM-DD') as date, (o.value->>'weight_kg')::float as kg
    from cadence.occurrences o
    where o.user_id = ${userId} and o.value ? 'weight_kg' and o.date >= ${from}
    order by o.date asc`;
}

/** Recent logged occurrences across ALL activities (newest first) — coach-chat retrieval. */
export async function listRecentLogged(
  userId: string,
  days = 14,
  limit = 6,
): Promise<Array<{ date: string; title: string; log: OccurrenceLog }>> {
  const from = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
  return sql<Array<{ date: string; title: string; log: OccurrenceLog }>>`
    select to_char(o.date, 'YYYY-MM-DD') as date, a.title, o.log
    from cadence.occurrences o
    join cadence.activities a on a.activity_id = o.activity_id
    where o.user_id = ${userId} and o.log is not null and o.date >= ${from}
    order by o.date desc
    limit ${limit}`;
}

/** The most recent day the user completed something (any done occurrence) — half of the
 *  "last engagement" signal the on-return detour prompt uses (Req 4). Null if they never have. */
export async function getLastDoneOccurrenceDate(userId: string): Promise<string | null> {
  const [row] = await sql<Array<{ date: string }>>`
    select to_char(max(date), 'YYYY-MM-DD') as date
    from cadence.occurrences where user_id = ${userId} and status = 'done'`;
  return row?.date ?? null;
}

/* ── Disrupted-episode overlay (Req 4 Phase C) ─────────────────────────────────────────────── */

/**
 * Shelve the base plan for an episode window: set still-pending USER occurrences (the effortful
 * ones — system tracking like food/weigh-in keeps running) to `paused` across [from, to]. Paused
 * base days are preserved, not deleted, and never count as slips. Returns the count paused.
 */
export async function pauseUserOccurrencesInWindow(userId: string, from: string, to: string): Promise<number> {
  const res = await sql`
    update cadence.occurrences o set status = 'paused'
    from cadence.activities a
    where o.activity_id = a.activity_id and o.user_id = ${userId}
      and o.date >= ${from} and o.date <= ${to} and o.status = 'pending' and a.kind = 'user'`;
  return res.count;
}

/** Un-pause base occurrences from `from` forward when an episode ends — the base plan resumes.
 *  Past paused days are left as-is (honest history: they were shelved, not done). Returns count. */
export async function restorePausedOccurrencesFrom(userId: string, from: string): Promise<number> {
  const res = await sql`
    update cadence.occurrences set status = 'pending'
    where user_id = ${userId} and status = 'paused' and date >= ${from}`;
  return res.count;
}

/** Materialize an episode's TEMP occurrences (the "do what you can" options), tagged with its
 *  episode_id. Idempotent on (activity_id, date). */
export async function insertTempOccurrences(
  rows: Array<{ activity_id: string; user_id: string; date: string; episode_id: string }>,
): Promise<void> {
  if (rows.length === 0) return;
  await sql`
    insert into cadence.occurrences ${sql(
      rows.map((r) => ({ ...r, status: 'pending' as const })),
      'activity_id',
      'user_id',
      'date',
      'episode_id',
      'status',
    )}
    on conflict (activity_id, date) do nothing`;
}

/** Drop an episode's still-pending FUTURE temp occurrences when it ends (past done ones stay as
 *  history). Returns the count removed. */
export async function deleteFutureTempOccurrences(userId: string, episodeId: string, from: string): Promise<number> {
  const res = await sql`
    delete from cadence.occurrences
    where user_id = ${userId} and episode_id = ${episodeId} and date >= ${from} and status = 'pending'`;
  return res.count;
}

export async function setOccurrenceStatus(
  userId: string,
  occurrenceId: string,
  status: OccurrenceStatus,
  value?: Record<string, number>,
): Promise<void> {
  if (value) {
    await sql`
      update cadence.occurrences set status = ${status}, value = ${json(value)}
      where user_id = ${userId} and occurrence_id = ${occurrenceId}`;
  } else {
    await sql`
      update cadence.occurrences set status = ${status}
      where user_id = ${userId} and occurrence_id = ${occurrenceId}`;
  }
}

/** Un-pause base occurrences on ONE day — the "not arrived yet" push (a scheduled detour's first
 *  day returns to the plan when arrival slips). Targeted so nothing else moves. */
export async function restorePausedOccurrencesOn(userId: string, date: string): Promise<number> {
  const res = await sql`
    update cadence.occurrences set status = 'pending'
    where user_id = ${userId} and status = 'paused' and date = ${date}`;
  return res.count;
}

/** Drop an episode's pending temp occurrences on ONE day — the other half of the arrival push. */
export async function deleteTempOccurrencesOn(userId: string, episodeId: string, date: string): Promise<number> {
  const res = await sql`
    delete from cadence.occurrences
    where user_id = ${userId} and episode_id = ${episodeId} and date = ${date} and status = 'pending'`;
  return res.count;
}

/**
 * Recently logged sessions WITH their ids — what a correction needs and `listRecentLogged`
 * deliberately omits (that one feeds the coach's context, where an id is noise).
 */
export async function listLoggedForCorrection(
  userId: string,
  days = 30,
  limit = 40,
): Promise<
  Array<{
    occurrence_id: string;
    date: string;
    title: string;
    log: OccurrenceLog | null;
    value: Record<string, number> | null;
    status: string;
    recurrence: string;
  }>
> {
  const from = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
  return sql<
    Array<{
      occurrence_id: string;
      date: string;
      title: string;
      log: OccurrenceLog | null;
      value: Record<string, number> | null;
      status: string;
      recurrence: string;
    }>
  >`
    select o.occurrence_id, to_char(o.date, 'YYYY-MM-DD') as date, a.title, o.log, o.value, o.status,
           coalesce(a.schedule->>'recurrence', '') as recurrence
    from cadence.occurrences o
    join cadence.activities a on a.activity_id = o.activity_id
    where o.user_id = ${userId} and o.date >= ${from} and o.status in ('done', 'skipped', 'missed')
    order by o.date desc
    limit ${limit}`;
}

/**
 * Erase an occurrence outright — for the ONE case that earns it: a session that never happened
 * and was never scheduled, so the row exists only because something logged it into being.
 *
 * A scheduled slot is never deleted here. Marking it not-done is the honest correction, because
 * the plan really did ask for it that day. And the inverse matters just as much: setting a
 * NEVER-scheduled occurrence to 'skipped' would invent a missed session on a day nothing was
 * asked of them, which then counts against their consistency — punishing someone for correcting
 * our mistake.
 */
export async function deleteOccurrence(userId: string, occurrenceId: string): Promise<void> {
  await sql`delete from cadence.occurrences where user_id = ${userId} and occurrence_id = ${occurrenceId}`;
}

/**
 * Overwrite a logged session's columns — a correction, not a new log. Each field given is a
 * whole-column jsonb SET, so callers pass the COMPLETE corrected value/log, merged with the
 * stored row first: a correction that names one metric must not erase the others (see
 * correct_log in coach-actions.ts, which owns that merge).
 */
export async function correctOccurrenceLog(
  userId: string,
  occurrenceId: string,
  fields: { log?: OccurrenceLog; value?: Record<string, number>; status?: OccurrenceStatus },
): Promise<void> {
  await sql`
    update cadence.occurrences
       set ${sql(
         Object.fromEntries(
           Object.entries({
             ...(fields.log ? { log: json(fields.log) } : {}),
             ...(fields.value ? { value: json(fields.value) } : {}),
             ...(fields.status ? { status: fields.status } : {}),
           }),
         ),
       )}
     where user_id = ${userId} and occurrence_id = ${occurrenceId}`;
}

/**
 * Recent occurrences in any state, for the coach to log against. Distinct from
 * `listLoggedForCorrection`, which is deliberately limited to sessions already recorded — this
 * one must see PENDING ones, because the whole point is completing something by talking about it.
 */
export async function listRecentForLogging(
  userId: string,
  days = 14,
  limit = 40,
): Promise<
  Array<{
    occurrence_id: string;
    date: string;
    title: string;
    status: string;
    category: string | null;
    completion_source: string | null;
    logged: boolean;
  }>
> {
  const from = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
  /**
   * The upper bound is the whole point, and its absence broke logging entirely.
   *
   * This is a "recent" query ordered newest-first with a limit — and it had no ceiling, while the
   * rolling horizon materializes commitments about two weeks AHEAD. On a fifteen-commitment plan
   * that is ~200 future rows, so the "newest 40" were all in the future and today's session never
   * appeared. `log_session` scopes by date and found nothing to match.
   *
   * Owner, 2026-08-16, four times in a row: *"I did ask Cadence to fix that incline workout and she
   * said she did but it didn't take."* She called the tool correctly every single time and got back
   * *"No session clearly matches … Recent ones: 2026-08-30 …"* — a list two weeks in the future,
   * for a workout done that morning. (Found in one query the moment `coach_tool` logging existed;
   * before that it had been unprovable for a day.)
   *
   * You cannot log a session that has not happened, so today is the ceiling.
   */
  const to = new Date().toISOString().slice(0, 10);
  return sql<
    Array<{
      occurrence_id: string;
      date: string;
      title: string;
      status: string;
      category: string | null;
      completion_source: string | null;
      logged: boolean;
    }>
  >`
    select o.occurrence_id, to_char(o.date, 'YYYY-MM-DD') as date, a.title, o.status,
           a.category, a.completion_source, (o.log is not null) as logged
    from cadence.occurrences o
    join cadence.activities a on a.activity_id = o.activity_id
    where o.user_id = ${userId} and o.date >= ${from} and o.date <= ${to} and a.kind = 'user'
    order by o.date desc
    limit ${limit}`;
}

/** Pending device-completed occurrences on a date — what a recorded workout might tick. */
export async function listPendingForDate(
  userId: string,
  date: string,
): Promise<
  Array<{
    occurrence_id: string;
    activity_id: string;
    title: string;
    category: string | null;
    completion_source: string | null;
  }>
> {
  return sql<
    Array<{
      occurrence_id: string;
      activity_id: string;
      title: string;
      category: string | null;
      completion_source: string | null;
    }>
  >`
    select o.occurrence_id, a.activity_id, a.title, a.category, a.completion_source
    from cadence.occurrences o
    join cadence.activities a on a.activity_id = o.activity_id
    where o.user_id = ${userId} and o.date = ${date} and o.status = 'pending'`;
}
