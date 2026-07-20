import { sql, json, type SqlExecutor } from '../db/sql.ts';
import type {
  Activity,
  Occurrence,
  OccurrenceLog,
  OccurrenceSession,
  OccurrenceStatus,
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
 */
export type OccurrenceListRow = Pick<
  Occurrence,
  'occurrence_id' | 'activity_id' | 'date' | 'status' | 'value' | 'provenance' | 'weather'
>;

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

export async function listOccurrences(userId: string, fromDate: string, toDate: string): Promise<OccurrenceListRow[]> {
  // Explicit columns, deliberately EXCLUDING session/log jsonb — this feeds the week view,
  // consistency, and replan context, none of which need the (potentially large) payloads.
  // The occurrence-detail path (getOccurrenceWithActivity) fetches them.
  return sql<OccurrenceListRow[]>`
    select occurrence_id, activity_id, date, status, value, provenance, weather
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
           o.value, o.provenance, o.session, o.log,
           a.title, a.kind, a.category, a.goal_id, a.schedule, a.target, a.why, a.how_to
    from cadence.occurrences o
    join cadence.activities a on a.activity_id = o.activity_id
    where o.user_id = ${userId} and o.occurrence_id = ${occurrenceId}`;
  return row ?? null;
}

/**
 * Cache a generated session ONLY if none exists yet (`session is null` guard) — with lazy
 * generate-on-open, two racing requests both generate; the first write wins and the loser
 * re-reads, so the user never sees the session swap. Returns whether THIS write won.
 */
export async function setOccurrenceSessionIfEmpty(
  userId: string,
  occurrenceId: string,
  session: OccurrenceSession,
): Promise<boolean> {
  const res = await sql`
    update cadence.occurrences set session = ${json(session)}
    where user_id = ${userId} and occurrence_id = ${occurrenceId} and session is null`;
  return res.count > 0;
}

/**
 * Remove a superseded plan's still-pending FUTURE occurrences when a new plan version commits —
 * they're replaced by the new plan's schedule. Past + done/skipped occurrences are kept (that's
 * the user's history, and it feeds consistency). Returns the number removed.
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

/** Done occurrences with their value/log payloads (oldest first) — the progress engine's feed. */
export async function listLoggedForProgress(
  userId: string,
  fromDate: string,
): Promise<
  Array<{
    date: string;
    title: string;
    kind: Activity['kind'];
    value: Record<string, number> | null;
    log: OccurrenceLog | null;
  }>
> {
  return sql<
    Array<{
      date: string;
      title: string;
      kind: Activity['kind'];
      value: Record<string, number> | null;
      log: OccurrenceLog | null;
    }>
  >`
    select to_char(o.date, 'YYYY-MM-DD') as date, a.title, a.kind, o.value, o.log
    from cadence.occurrences o
    join cadence.activities a on a.activity_id = o.activity_id
    where o.user_id = ${userId} and o.status = 'done' and o.date >= ${fromDate}
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
