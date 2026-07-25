import { sql } from '../db/sql.ts';

/**
 * The explicit "I'm here" signal (Req 4). In a disrupted stretch, checking in counts as showing up
 * even with nothing completed — it keeps the streak alive (and, on a kept day, extends it). One row
 * per user per day; re-checking a day is a no-op.
 */
export async function recordCheckIn(userId: string, date: string): Promise<void> {
  await sql`
    insert into cadence.check_ins (user_id, date) values (${userId}, ${date})
    on conflict (user_id, date) do nothing`;
}

/** The set of YYYY-MM-DD dates the user checked in on within [from, to] — feeds streak `engaged`. */
export async function listCheckInDays(userId: string, from: string, to: string): Promise<string[]> {
  const rows = await sql<Array<{ date: string }>>`
    select to_char(date, 'YYYY-MM-DD') as date from cadence.check_ins
    where user_id = ${userId} and date >= ${from} and date <= ${to}`;
  return rows.map((r) => r.date);
}

/** The most recent check-in day — the other half of the "last engagement" signal (Req 4). */
export async function getLastCheckInDate(userId: string): Promise<string | null> {
  const [row] = await sql<Array<{ date: string }>>`
    select to_char(max(date), 'YYYY-MM-DD') as date from cadence.check_ins where user_id = ${userId}`;
  return row?.date ?? null;
}
