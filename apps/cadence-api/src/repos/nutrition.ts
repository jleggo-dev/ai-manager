import { sql, json } from '../db/sql.ts';
import type { NutritionLog } from '@cadence/shared';

// date/created_at cast to text in every select — the postgres.js Date-object trap
// (goal_events.at, plan generated_at) bites any string-typed column left uncast.
const COLS = sql`
  log_id, to_char(date, 'YYYY-MM-DD') as date, meal, items, macros, input_method,
  ai_confidence, provisional, photo_ref, raw_text, flags, recipe_id,
  created_at::text as created_at`;

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
    photo_ref?: string | null;
    macros?: NutritionLog['macros'] | null;
    provisional?: boolean;
    /** Correlate a meal logged as N servings of a saved recipe (Req 5 WS3). */
    recipe_id?: string | null;
  },
): Promise<NutritionLog> {
  const [out] = await sql<NutritionLog[]>`
    insert into cadence.nutrition_logs
      (user_id, date, meal, items, input_method, ai_confidence, raw_text, flags, photo_ref, macros, provisional, recipe_id)
    values (
      ${userId}, ${row.date}, ${row.meal}, ${json(row.items ?? [])}, ${row.input_method},
      ${row.ai_confidence ?? null}, ${row.raw_text ?? null}, ${json(row.flags ?? {})}, ${row.photo_ref ?? null},
      ${json(row.macros ?? {})}, ${row.provisional ?? false}, ${row.recipe_id ?? null}
    )
    returning ${COLS}`;
  return out!;
}

/**
 * Correction/confirmation update (dual-keyed — a foreign id must miss). Only the provided fields
 * change; the user's word always wins, so callers set ai_confidence/provisional accordingly.
 */
export async function updateNutritionLog(
  userId: string,
  logId: string,
  patch: {
    meal?: NutritionLog['meal'];
    items?: NutritionLog['items'];
    macros?: NutritionLog['macros'];
    ai_confidence?: number | null;
    provisional?: boolean;
  },
): Promise<NutritionLog | null> {
  const [out] = await sql<NutritionLog[]>`
    update cadence.nutrition_logs set
      meal = coalesce(${patch.meal ?? null}, meal),
      items = coalesce(${patch.items ? json(patch.items) : null}, items),
      macros = coalesce(${patch.macros ? json(patch.macros) : null}, macros),
      ai_confidence = coalesce(${patch.ai_confidence ?? null}, ai_confidence),
      provisional = coalesce(${patch.provisional ?? null}, provisional)
    where user_id = ${userId} and log_id = ${logId}
    returning ${COLS}`;
  return out ?? null;
}

/** Meals in [fromDate, toDate], newest first (date, then entry time). Dual-keyed on user_id. */
export async function listNutritionLogs(userId: string, fromDate: string, toDate: string): Promise<NutritionLog[]> {
  return sql<NutritionLog[]>`
    select ${COLS} from cadence.nutrition_logs
    where user_id = ${userId} and date >= ${fromDate} and date <= ${toDate}
    order by date desc, created_at desc`;
}
