import { sql, json } from '../db/sql.ts';

export type AiLogKind =
  | 'capture'
  | 'coach'
  | 'pack_select'
  | 'pack_reuse'
  | 'pack_summarize'
  | 'context_select'
  | 'coach_tool'
  | 'synthesize_plan'
  | 'assess_goal'
  | 'prescribe_session'
  | 'parse_session_log'
  | 'parse_meal'
  | 'describe_meal_photo'
  | 'parse_meal_description'
  | 'nutrition_baseline'
  | 'plate_advice'
  | 'parse_nutrition_label'
  | 'estimate_food'
  | 'identify_food'
  | 'structure_recipe'
  | 'parse_fridge_photo'
  | 'generate_recipe'
  | 'generate_meal_plan'
  | 'discover_recipe';

/**
 * Durable log of a behind-the-scenes AI call (see migration 0004). Best-effort: a logging
 * failure must never break the coaching path. This is the persistent audit trail for
 * debugging capture/coach/broker behaviour (queryable in cadence.ai_log).
 */
export interface AiLogRow {
  kind: string;
  input: unknown;
  output: unknown;
  meta: unknown;
  created_at: string;
}

/** Recent durable log entries for a user (newest first) — powers the X-ray history view. */
export async function recentAiLog(userId: string, limit = 30): Promise<AiLogRow[]> {
  const rows = await sql`
    select kind, input, output, meta, created_at from cadence.ai_log
    where user_id = ${userId} order by created_at desc limit ${limit}`;
  return rows as unknown as AiLogRow[];
}

export async function logAi(
  userId: string,
  entry: { kind: AiLogKind; sessionId?: string | null; input?: unknown; output?: unknown; meta?: unknown },
): Promise<void> {
  try {
    await sql`
      insert into cadence.ai_log (user_id, kind, session_id, input, output, meta)
      values (${userId}, ${entry.kind}, ${entry.sessionId ?? null},
              ${json(entry.input ?? null)}, ${json(entry.output ?? null)}, ${json(entry.meta ?? null)})`;
  } catch (e) {
    console.error('[ai-log]', e);
  }
}
