import { sql, json } from '../db/sql.ts';
import type { RecapFacts } from '../services/recap-facts.ts';

/**
 * `cadence.recaps` (0046) — the week review's confirmed receipt, persisted so the `recap_rail`
 * widget has something to read without re-deriving it from occurrences every time
 * (docs/cadence/PROGRESS-ENGINE.md "Check-in unification"). One row per (user, week_start); a
 * re-confirm of the same week upserts.
 */
export interface RecapRow {
  id: string;
  user_id: string;
  /** The Monday on/before the reviewed window — YYYY-MM-DD. */
  week_start: string;
  facts: RecapFacts;
  facts_line: string;
  /** The coach's/receipt's one-sentence conclusion — null until something writes one (honest v1). */
  line: string | null;
  detour: boolean;
  created_at: string;
}

const COLS = sql`id, user_id, week_start::text as week_start, facts, facts_line, line, detour, created_at::text as created_at`;

export interface UpsertRecapInput {
  weekStart: string;
  facts: RecapFacts;
  factsLine: string;
  line?: string | null;
  detour: boolean;
}

/** Insert this week's recap, or overwrite it if the user already confirmed this week once before
 *  (UNIQUE (user_id, week_start) backs the upsert — see 0046). */
export async function upsertRecap(userId: string, input: UpsertRecapInput): Promise<RecapRow> {
  const [row] = await sql<RecapRow[]>`
    insert into cadence.recaps (user_id, week_start, facts, facts_line, line, detour)
    values (
      ${userId}, ${input.weekStart}, ${json(input.facts)}, ${input.factsLine},
      ${input.line ?? null}, ${input.detour}
    )
    on conflict (user_id, week_start) do update set
      facts = excluded.facts,
      facts_line = excluded.facts_line,
      line = excluded.line,
      detour = excluded.detour
    returning ${COLS}`;
  if (!row) throw new Error('upsertRecap: no row returned');
  return row;
}

/** Most recent recaps first — the rail's own read, `GET /me/recaps`. */
export async function listRecaps(userId: string, limit = 8): Promise<RecapRow[]> {
  return sql<RecapRow[]>`
    select ${COLS} from cadence.recaps
    where user_id = ${userId}
    order by week_start desc
    limit ${limit}`;
}
