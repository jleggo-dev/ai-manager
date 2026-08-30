import { sql, json } from '../db/sql.ts';
import type { ProgressLayout } from '@cadence/shared';

/**
 * Progress-layout rows (0045). Lifecycle mirrors cadence.plans: draft → committed, superseded
 * lineage — a row is never deleted, only superseded, so what a user's page looked like at any
 * point stays recoverable. The DEFAULT composition (no committed row) is computed on read by the
 * deterministic composer (services/progress-layout.ts) and never lands in this table.
 */
export interface ProgressLayoutRow {
  id: string;
  user_id: string;
  status: 'draft' | 'committed' | 'superseded';
  layout: ProgressLayout;
  created_at: string;
  committed_at: string | null;
}

const COLS = sql`id, user_id, status, layout, created_at::text as created_at, committed_at::text as committed_at`;

/** The user's current committed layout, or null when none exists yet (the caller falls back to the default composition). */
export async function getCommitted(userId: string): Promise<ProgressLayoutRow | null> {
  const [row] = await sql<ProgressLayoutRow[]>`
    select ${COLS} from cadence.progress_layouts
    where user_id = ${userId} and status = 'committed'
    limit 1`;
  return row ?? null;
}

/** Insert a new draft — the coach's proposed layout (Wave 3), awaiting the "did I get it right?" confirm. */
export async function insertDraft(userId: string, layout: ProgressLayout): Promise<ProgressLayoutRow> {
  const [row] = await sql<ProgressLayoutRow[]>`
    insert into cadence.progress_layouts (user_id, status, layout)
    values (${userId}, 'draft', ${json(layout)})
    returning ${COLS}`;
  if (!row) throw new Error('insertDraft: no row returned');
  return row;
}

/**
 * Promote a draft to committed. Supersedes any previously committed row for this user in the SAME
 * transaction (same shape as supersedeActivePlans + insertPlan in repos/plans.ts) — a crash between
 * the two steps must never leave the user with two committed layouts, or none.
 */
export async function commitDraft(userId: string, draftId: string): Promise<ProgressLayoutRow> {
  return sql.begin(async (tx) => {
    await tx`
      update cadence.progress_layouts set status = 'superseded'
      where user_id = ${userId} and status = 'committed'`;
    const [row] = await tx<ProgressLayoutRow[]>`
      update cadence.progress_layouts set status = 'committed', committed_at = now()
      where user_id = ${userId} and id = ${draftId} and status = 'draft'
      returning ${COLS}`;
    if (!row) throw new Error(`commitDraft: draft ${draftId} not found (or not a draft) for user`);
    return row;
  });
}
