import { sql } from '../db/sql.ts';

/** Seconds per breath count, or null if this person has never set one. */
export async function getBreathPace(userId: string): Promise<number | null> {
  const rows = await sql<{ breath_pace: number | null }[]>`
    select breath_pace from cadence.users where id = ${userId}`;
  return rows[0]?.breath_pace ?? null;
}

export async function setBreathPace(userId: string, pace: number): Promise<void> {
  await sql`
    update cadence.users set breath_pace = ${pace}, updated_at = now()
    where id = ${userId}`;
}
