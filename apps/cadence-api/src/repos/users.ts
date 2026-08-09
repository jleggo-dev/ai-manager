import { sql, json } from '../db/sql.ts';
import type {
  Baseline,
  DietaryProfile,
  MacroTargets,
  PendingProposal,
  PendingPlan,
  PointsState,
  SteerBack,
  StreakState,
} from '@cadence/shared';

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
  // Present once migration 0017 is applied (Req 5 dietary safety input).
  dietary_profile?: DietaryProfile | null;
  // Present once migration 0020 is applied (REQ8 rewards); undefined pre-migration → callers fall
  // back to initialPointsState().
  points_state?: PointsState | null;
  // Present once migration 0027 is applied. Which PORTRAIT the user picked — null means they
  // haven't, which every surface renders as the brand mark. Never read by prompts or planning:
  // a face is a picture, not a personality (packages/cadence-shared/src/coach-face.ts).
  coach_face_id?: string | null;
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

/** Persist the forward-only points wallet (REQ8) — written by the rewards finalize after it folds
 *  past days / redeems a freeze. Whole-object replace; the caller owns the merge. */
export async function setPointsState(userId: string, state: PointsState): Promise<void> {
  await sql`update cadence.users set points_state = ${json(state)} where id = ${userId}`;
}

/**
 * Set (or clear, with null) the portrait the user picked for the coach. Clearing is a supported
 * choice, not an error state — it returns them to the brand mark rather than to a default face
 * they never chose.
 */
export async function setCoachFaceId(userId: string, faceId: string | null): Promise<void> {
  await sql`update cadence.users set coach_face_id = ${faceId}, updated_at = now() where id = ${userId}`;
}

/** Read dietary profile jsonb (Req 5). Null only if the user row is missing. */
export async function getDietaryProfile(userId: string): Promise<DietaryProfile | null> {
  const [row] = await sql<{ dietary_profile: DietaryProfile }[]>`
    select dietary_profile from cadence.users where id = ${userId}`;
  return row?.dietary_profile ?? null;
}

/** Whole-object replace for Settings confirm-first save (Req 5 WS5). */
export async function setDietaryProfile(userId: string, profile: DietaryProfile): Promise<void> {
  await sql`
    update cadence.users
    set dietary_profile = ${json(profile)}, updated_at = now()
    where id = ${userId}`;
}

export type HomeLocation = { lat: number; lon: number; label?: string };

/**
 * Persist coarse home location + IANA timezone (§B1). Columns exist since migration 0001 —
 * no new migration. Whole-object replace for location; timezone is a plain text column.
 */
export async function setHomeLocation(userId: string, location: HomeLocation, timezone: string | null): Promise<void> {
  await sql`
    update cadence.users
    set home_location = ${json(location)},
        timezone = ${timezone},
        updated_at = now()
    where id = ${userId}`;
}

/** Clear home location (and optionally timezone) — Settings "forget this place". */
export async function clearHomeLocation(userId: string, clearTimezone = false): Promise<void> {
  if (clearTimezone) {
    await sql`
      update cadence.users
      set home_location = null, timezone = null, updated_at = now()
      where id = ${userId}`;
  } else {
    await sql`
      update cadence.users
      set home_location = null, updated_at = now()
      where id = ${userId}`;
  }
}
