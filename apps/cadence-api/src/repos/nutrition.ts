import { sql, json } from '../db/sql.ts';
import type { NutritionLog } from '@cadence/shared';

// date/created_at cast to text in every select — the postgres.js Date-object trap
// (goal_events.at, plan generated_at) bites any string-typed column left uncast.
// closes_at renders as ISO-8601 (not ::text) because the meal screen parses it to show the
// window ("adds until 10:30"), and Safari rejects Postgres's space-separated text form.
const COLS = sql`
  log_id, to_char(date, 'YYYY-MM-DD') as date, meal, items, macros, input_method,
  ai_confidence, provisional, photo_ref, raw_text, flags, recipe_id, parts, state,
  to_char(closes_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as closes_at,
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
    /** The brackets (0053). Absent = a flat meal. */
    parts?: NutritionLog['parts'];
    /** Draft lifecycle (0053). Absent = 'closed', which is what every express write is. */
    state?: NutritionLog['state'];
    /** When an open draft stops accepting adds (ISO). Only ever set alongside state 'open'. */
    closes_at?: string | null;
  },
): Promise<NutritionLog> {
  const [out] = await sql<NutritionLog[]>`
    insert into cadence.nutrition_logs
      (user_id, date, meal, items, input_method, ai_confidence, raw_text, flags, photo_ref, macros, provisional, recipe_id, photo_reading, parts, state, closes_at)
    values (
      ${userId}, ${row.date}, ${row.meal}, ${json(row.items ?? [])}, ${row.input_method},
      ${row.ai_confidence ?? null}, ${row.raw_text ?? null}, ${json(row.flags ?? {})}, ${row.photo_ref ?? null},
      ${json(row.macros ?? {})}, ${row.provisional ?? false}, ${row.recipe_id ?? null}, ${row.photo_reading ?? null},
      ${json(row.parts ?? [])}, ${row.state ?? 'closed'}, ${row.closes_at ?? null}
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
    /** Sparse signals on the row — merged, never replaced, so one writer cannot drop another's. */
    flags?: Record<string, unknown>;
    /** The brackets — replaced whole ([] clears them; parts ops always send the full array). */
    parts?: NutritionLog['parts'];
    /** Draft lifecycle: the close write flips 'open' → 'closed'. Never flips back. */
    state?: NutritionLog['state'];
  },
): Promise<NutritionLog | null> {
  const [out] = await sql<NutritionLog[]>`
    update cadence.nutrition_logs set
      meal = coalesce(${patch.meal ?? null}, meal),
      items = coalesce(${patch.items ? json(patch.items) : null}, items),
      macros = coalesce(${patch.macros ? json(patch.macros) : null}, macros),
      ai_confidence = coalesce(${patch.ai_confidence ?? null}, ai_confidence),
      provisional = coalesce(${patch.provisional ?? null}, provisional),
      flags = flags || coalesce(${patch.flags ? json(patch.flags) : null}, '{}'::jsonb),
      parts = coalesce(${patch.parts ? json(patch.parts) : null}, parts),
      state = coalesce(${patch.state ?? null}, state)
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
/** One meal by id, scoped to its owner — what a correction reads before it edits. */
export async function findNutritionLog(userId: string, logId: string): Promise<NutritionLog | null> {
  const rows = await sql<NutritionLog[]>`
    select ${COLS} from cadence.nutrition_logs
    where user_id = ${userId} and log_id = ${logId}
    limit 1`;
  return rows[0] ?? null;
}

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

/**
 * The one open meal, if any — how a reopened app finds its way back into breakfast. Rides the
 * `nutrition_open_idx` partial index. Newest first, since expiry should have left at most one.
 */
export async function findOpenMeal(userId: string): Promise<NutritionLog | null> {
  const rows = await sql<NutritionLog[]>`
    select ${COLS} from cadence.nutrition_logs
    where user_id = ${userId} and state = 'open'
    order by created_at desc
    limit 1`;
  return rows[0] ?? null;
}

/** The open draft for one (date, slot) — the openDraft idempotency lookup. */
export async function findOpenMealForSlot(
  userId: string,
  date: string,
  meal: NutritionLog['meal'],
): Promise<NutritionLog | null> {
  const rows = await sql<NutritionLog[]>`
    select ${COLS} from cadence.nutrition_logs
    where user_id = ${userId} and state = 'open' and date = ${date} and meal = ${meal}
    order by created_at desc
    limit 1`;
  return rows[0] ?? null;
}

/** Open meals whose window has ended — what the lazy expiry sweep closes or deletes. */
export async function listOverdueOpenMeals(userId: string): Promise<NutritionLog[]> {
  return sql<NutritionLog[]>`
    select ${COLS} from cadence.nutrition_logs
    where user_id = ${userId} and state = 'open'
      and closes_at is not null and closes_at < now()`;
}

/** Meals in [fromDate, toDate], newest first (date, then entry time). Dual-keyed on user_id. */
export async function listNutritionLogs(userId: string, fromDate: string, toDate: string): Promise<NutritionLog[]> {
  return sql<NutritionLog[]>`
    select ${COLS} from cadence.nutrition_logs
    where user_id = ${userId} and date >= ${fromDate} and date <= ${toDate}
    order by date desc, created_at desc`;
}
