import { sql, json } from '../db/sql.ts';
import type { NutritionLog } from '@cadence/shared';

// date/created_at cast to text in every select — the postgres.js Date-object trap
// (goal_events.at, plan generated_at) bites any string-typed column left uncast.
const COLS = sql`
  log_id, to_char(date, 'YYYY-MM-DD') as date, meal, items, macros, input_method,
  ai_confidence, provisional, photo_ref, raw_text, flags, created_at::text as created_at`;

export async function insertNutritionLog(
  userId: string,
  row: {
    date: string;
    meal: NutritionLog['meal'];
    items: NutritionLog['items'];
    input_method: NutritionLog['input_method'];
    ai_confidence?: number | null;
    raw_text?: string | null;
    flags?: NutritionLog['flags'];
  },
): Promise<NutritionLog> {
  const [out] = await sql<NutritionLog[]>`
    insert into cadence.nutrition_logs
      (user_id, date, meal, items, input_method, ai_confidence, raw_text, flags)
    values (
      ${userId}, ${row.date}, ${row.meal}, ${json(row.items ?? [])}, ${row.input_method},
      ${row.ai_confidence ?? null}, ${row.raw_text ?? null}, ${json(row.flags ?? {})}
    )
    returning ${COLS}`;
  return out!;
}

/** Meals in [fromDate, toDate], newest first (date, then entry time). Dual-keyed on user_id. */
export async function listNutritionLogs(userId: string, fromDate: string, toDate: string): Promise<NutritionLog[]> {
  return sql<NutritionLog[]>`
    select ${COLS} from cadence.nutrition_logs
    where user_id = ${userId} and date >= ${fromDate} and date <= ${toDate}
    order by date desc, created_at desc`;
}
