import { sql } from '../db/sql.ts';

/**
 * The by-hand changes to the calendar (0060) — one row per move, copy or delete of a dated
 * session, whoever made it. Written by services/occurrence-edit.ts on every successful edit (the
 * trail's hold menu passes `trail`, the coach's edit_calendar passes `coach`); read by the plan
 * read the coach carries every turn, so a session the person moved or dropped on the plan screen
 * is a fact in front of her rather than a row she would have to notice was missing.
 */
export type PlanEditSource = 'trail' | 'coach';
export type PlanEditAction = 'move' | 'copy' | 'delete';

export interface PlanEdit {
  edit_id: string;
  source: PlanEditSource;
  action: PlanEditAction;
  title: string;
  /** YYYY-MM-DD — the day the session sat on. */
  from_date: string;
  /** YYYY-MM-DD for a move or copy; null for a delete. */
  to_date: string | null;
  /** ISO timestamp. */
  at: string;
}

export async function recordPlanEdit(
  userId: string,
  edit: { source: PlanEditSource; action: PlanEditAction; title: string; from_date: string; to_date?: string | null },
): Promise<void> {
  await sql`
    insert into cadence.plan_edits (user_id, source, action, title, from_date, to_date)
    values (${userId}, ${edit.source}, ${edit.action}, ${edit.title}, ${edit.from_date}::date, ${edit.to_date ?? null}::date)`;
}

/** The most recent edits since `sinceIso` (inclusive, by `at`), newest first, capped. */
export async function listPlanEdits(userId: string, sinceIso: string, limit = 8): Promise<PlanEdit[]> {
  return sql<PlanEdit[]>`
    select edit_id, source, action, title,
           to_char(from_date, 'YYYY-MM-DD') as from_date,
           to_char(to_date, 'YYYY-MM-DD') as to_date,
           at::text as at
      from cadence.plan_edits
     where user_id = ${userId} and at >= ${sinceIso}::timestamptz
     order by at desc
     limit ${limit}`;
}
