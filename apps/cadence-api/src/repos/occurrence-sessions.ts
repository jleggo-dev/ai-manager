import { sql, json } from '../db/sql.ts';
import type { OccurrenceSession } from '@cadence/shared';

/**
 * The session-cache slice of the occurrences repo — how a prescribed session lands on its row,
 * how a revision drops one to rebuild it, and what a revision may aim at. Split out of
 * occurrences.ts when that file crossed the 500-line gate (2026-08-31, the revise-session build);
 * everything here serves session-generate.ts and the revise_session coach tool.
 */

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
 * Drop a stored session so it can be rebuilt — the revise path ("add chest and abs to today's
 * workout", PLAN-CHANGES.md rung 1). `setOccurrenceSessionIfEmpty` only writes into NULL, so a
 * revise must clear FIRST and the fresh session then lands through the same compare-and-set every
 * other writer uses. Guarded to still-pending rows: a done occurrence's session is the record of
 * what was actually asked that day, and no rebuild may erase it. Returns whether a row was
 * cleared — false means the row is gone or no longer pending, and the caller reports that instead
 * of generating into a wall.
 */
export async function clearOccurrenceSession(userId: string, occurrenceId: string): Promise<boolean> {
  const res = await sql`
    update cadence.occurrences set session = null
    where user_id = ${userId} and occurrence_id = ${occurrenceId} and status = 'pending'`;
  return res.count > 0;
}

/**
 * Upcoming still-to-do sessions WITH their ids — what a session revision aims at. The mirror of
 * `listRecentForLogging` (occurrences.ts): that one is ceilinged at today because you cannot log
 * the future; this one FLOORS at today because you cannot rebuild the past. Soonest first, so an
 * unscoped match ("today's workout", no date given) lands on the next one on the calendar.
 * `kind = 'user'` for the same reason as everywhere else: a system tracking row (weigh-in, food
 * log) has no session inside it to rebuild.
 */
export async function listUpcomingForRevision(
  userId: string,
  days = 28,
  limit = 40,
): Promise<Array<{ occurrence_id: string; date: string; title: string }>> {
  const from = new Date().toISOString().slice(0, 10);
  const to = new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
  return sql<Array<{ occurrence_id: string; date: string; title: string }>>`
    select o.occurrence_id, to_char(o.date, 'YYYY-MM-DD') as date, a.title
    from cadence.occurrences o
    join cadence.activities a on a.activity_id = o.activity_id
    where o.user_id = ${userId} and o.date >= ${from} and o.date <= ${to}
      and o.status = 'pending' and a.kind = 'user'
    order by o.date asc
    limit ${limit}`;
}
