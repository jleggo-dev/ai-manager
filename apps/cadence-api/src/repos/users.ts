import { sql, json } from '../db/sql.ts';
import type { Baseline, MacroTargets, PendingProposal, PendingPlan, SteerBack, StreakState } from '@cadence/shared';

export interface CadenceUserRow {
  id: string;
  name: string;
  email: string | null;
  baseline: Baseline;
  macro_targets: MacroTargets | null;
  timezone: string | null;
  home_location: { lat: number; lon: number; label?: string } | null;
  steer_back: SteerBack;
  last_assessed_at: string | null;
  pending_proposal: PendingProposal | null;
  pending_plan: PendingPlan | null;
  // Present once migration 0015 is applied; older rows (or a pre-migration read) leave it
  // undefined and callers fall back to initialStreakState().
  streak_state?: StreakState | null;
}

export async function getUser(userId: string): Promise<CadenceUserRow | null> {
  const [row] = await sql<CadenceUserRow[]>`select * from cadence.users where id = ${userId}`;
  return row ?? null;
}

/**
 * Ensure a cadence.users row exists (the FK anchor for all per-user data). Idempotent. Used by
 * the auth middleware to lazily provision a row on a Supabase user's FIRST authenticated request
 * (no signup trigger needed) and by dev-reset to seed the scratch accounts. `email` is only set on
 * insert — an existing row is left untouched (on conflict do nothing).
 */
export async function ensureUser(userId: string, email: string | null = null): Promise<void> {
  await sql`
    insert into cadence.users (id, email, baseline) values (${userId}, ${email}, ${json({})})
    on conflict (id) do nothing`;
}

/** Set the user's display name (top-level column, not baseline). */
export async function setName(userId: string, name: string): Promise<void> {
  await sql`update cadence.users set name = ${name}, updated_at = now() where id = ${userId}`;
}

/** Shallow-merge captured baseline deltas via jsonb `||`. */
export async function mergeBaseline(userId: string, patch: Partial<Baseline>): Promise<void> {
  await sql`
    update cadence.users set baseline = baseline || ${json(patch)}, updated_at = now()
    where id = ${userId}`;
}

export async function setMacroTargets(userId: string, targets: MacroTargets): Promise<void> {
  await sql`
    update cadence.users set macro_targets = ${json(targets)}, updated_at = now()
    where id = ${userId}`;
}

/** Mark the weekly situation_assess gate as run now (§B4) — regardless of whether it fired. */
export async function touchAssessedAt(userId: string): Promise<void> {
  await sql`update cadence.users set last_assessed_at = now() where id = ${userId}`;
}

/** Store (or clear, with null) the coach's pending proposal — the user's accept/dismiss resolves it. */
export async function setPendingProposal(userId: string, proposal: PendingProposal | null): Promise<void> {
  await sql`update cadence.users set pending_proposal = ${proposal ? json(proposal) : null} where id = ${userId}`;
}

/** Store (or clear, with null) a synthesized-but-not-yet-committed plan — the first-lock analog
 *  of setPendingProposal. The user's confirm/dismiss resolves it. */
export async function setPendingPlan(userId: string, plan: PendingPlan | null): Promise<void> {
  await sql`update cadence.users set pending_plan = ${plan ? json(plan) : null} where id = ${userId}`;
}

/** Persist the forward-only streak state (Req 4) — written by services/streak.ts after it
 *  finalizes past days. Whole-object replace; the caller owns the merge. */
export async function setStreakState(userId: string, state: StreakState): Promise<void> {
  await sql`update cadence.users set streak_state = ${json(state)} where id = ${userId}`;
}
