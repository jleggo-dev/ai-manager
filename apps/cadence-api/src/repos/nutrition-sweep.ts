/**
 * The Sunday sweep's own reads and writes on nutrition_logs (S3/S4).
 *
 * A separate file rather than additions to repos/nutrition.ts because the sweep needs the
 * post-0053 columns (`parts`, `state`) that the main repo's COLS does not select — and that file
 * belongs to the draft-lifecycle parcel. Everything here is dual-keyed on user_id.
 *
 * The one write (`writeLogPartsAndItems`) touches parts + items ONLY — never macros, est, or any
 * other column. The retro tidy changes how a day reads back, never what it counted.
 */
import { sql, json } from '../db/sql.ts';
import type { Macros, MealItem, MealKind, MealPart } from '@cadence/shared';

export interface SweepLogRow {
  log_id: string;
  date: string;
  meal: MealKind;
  items: MealItem[];
  parts: MealPart[];
  raw_text: string | null;
  macros: Macros;
}

const COLS = sql`
  log_id, to_char(date, 'YYYY-MM-DD') as date, meal, items, parts, raw_text, macros`;

/** Closed meals in [fromDate, toDate], oldest first. Open drafts are excluded — the sweep only
 *  reads days that are finished being written. */
export async function listSweepLogs(userId: string, fromDate: string, toDate: string): Promise<SweepLogRow[]> {
  return sql<SweepLogRow[]>`
    select ${COLS} from cadence.nutrition_logs
    where user_id = ${userId} and date >= ${fromDate} and date <= ${toDate}
      and state <> 'open'
    order by date asc, created_at asc`;
}

/** One log with its parts, for the tidy's read-before-write. */
export async function getSweepLog(userId: string, logId: string): Promise<SweepLogRow | null> {
  const [row] = await sql<SweepLogRow[]>`
    select ${COLS} from cadence.nutrition_logs
    where user_id = ${userId} and log_id = ${logId} and state <> 'open'
    limit 1`;
  return row ?? null;
}

/** Every log carrying at least one sweep-tagged part — the revert's worklist. */
export async function listLogsWithSweepParts(userId: string): Promise<SweepLogRow[]> {
  return sql<SweepLogRow[]>`
    select ${COLS} from cadence.nutrition_logs
    where user_id = ${userId} and parts @> ${json([{ source: 'sweep' }])}`;
}

/** Replace a log's parts + items together (they cross-reference via item.part). Nothing else. */
export async function writeLogPartsAndItems(
  userId: string,
  logId: string,
  parts: MealPart[],
  items: MealItem[],
): Promise<void> {
  await sql`
    update cadence.nutrition_logs
    set parts = ${json(parts)}, items = ${json(items)}
    where user_id = ${userId} and log_id = ${logId}`;
}
