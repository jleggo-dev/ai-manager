import { sql } from '../db/sql.ts';

/**
 * Water rows (0037) — one per pour, ml canonical. The day total is a sum, never a counter
 * mutated in place, so a mistaken pour is one row to delete and the audit trail keeps the when.
 */
export interface WaterLog {
  water_id: string;
  date: string;
  ml: number;
  created_at: string;
}

const COLS = sql`water_id, to_char(date, 'YYYY-MM-DD') as date, ml, created_at::text as created_at`;

export async function insertWaterLog(userId: string, row: { date: string; ml: number }): Promise<WaterLog> {
  const [out] = await sql<WaterLog[]>`
    insert into cadence.water_logs (user_id, date, ml)
    values (${userId}, ${row.date}, ${row.ml})
    returning ${COLS}`;
  if (!out) throw new Error('insertWaterLog: no row returned');
  return out;
}

/** The day's total, in ml. Zero rows is zero water — an honest number, not an absence. */
export async function sumWaterMl(userId: string, date: string): Promise<number> {
  const [row] = await sql<{ total: number }[]>`
    select coalesce(sum(ml), 0)::int as total
      from cadence.water_logs
     where user_id = ${userId} and date = ${date}`;
  return row?.total ?? 0;
}
