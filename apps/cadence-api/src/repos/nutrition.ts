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
    /** Stage-1 prose for a photo log — possibly the user's edited version. See migration 0038. */
    photo_reading?: string | null;
  },
): Promise<NutritionLog> {
  const [out] = await sql<NutritionLog[]>`
    insert into cadence.nutrition_logs
      (user_id, date, meal, items, input_method, ai_confidence, raw_text, flags, photo_ref, macros, provisional, recipe_id, photo_reading)
    values (
      ${userId}, ${row.date}, ${row.meal}, ${json(row.items ?? [])}, ${row.input_method},
      ${row.ai_confidence ?? null}, ${row.raw_text ?? null}, ${json(row.flags ?? {})}, ${row.photo_ref ?? null},
      ${json(row.macros ?? {})}, ${row.provisional ?? false}, ${row.recipe_id ?? null}, ${row.photo_reading ?? null}
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

/**
 * Remove a logged meal outright. Dual-keyed on user_id, so one user can never delete another's row.
 *
 * Reserved for a meal that DID NOT HAPPEN — a mis-tap, a double log, or a parse that invented a
 * food nobody ate. That is the same distinction `removeCapturedConstraint` draws: a mis-capture is
 * not history, it is an error, and leaving it on file keeps it shaping the day's totals.
 *
 * It is NOT how you fix a wrong number. "That was a large, not a small" keeps the meal and corrects
 * it (`updateNutritionLog`, which marks the macros `source: 'user'`) — the meal happened, we simply
 * wrote it down wrong. Count what happened; delete only what didn't.
 */
export async function deleteNutritionLog(userId: string, logId: string): Promise<boolean> {
  const rows = await sql`
    delete from cadence.nutrition_logs
    where user_id = ${userId} and log_id = ${logId}
    returning log_id`;
  return rows.length > 0;
}

/** How many distinct days in [fromDate, toDate] have at least one meal logged. One count, no rows —
 *  this runs on every Plan render for a user with no targets yet (the 7-day countdown). */
export async function countNutritionDays(userId: string, fromDate: string, toDate: string): Promise<number> {
  const [r] = await sql<{ n: number }[]>`
    select count(distinct date)::int as n from cadence.nutrition_logs
    where user_id = ${userId} and date >= ${fromDate} and date <= ${toDate}`;
  return r?.n ?? 0;
}

/** Meals in [fromDate, toDate], newest first (date, then entry time). Dual-keyed on user_id. */
export async function listNutritionLogs(userId: string, fromDate: string, toDate: string): Promise<NutritionLog[]> {
  return sql<NutritionLog[]>`
    select ${COLS} from cadence.nutrition_logs
    where user_id = ${userId} and date >= ${fromDate} and date <= ${toDate}
    order by date desc, created_at desc`;
}
