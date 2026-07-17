import { sql, json } from '../db/sql.ts';
import { ensureUser } from '../repos/users.ts';
import { purgeMealPhotos } from './meal-photos.ts';

/**
 * Dev-only account data reset — the shared implementation behind both the `/dev/reset`
 * endpoint (the in-app "Reset" button) and `scripts/account.ts`. Wipes every per-user
 * cadence table and clears the profile, so a test account can be re-onboarded from zero.
 * Real auth is deferred; callers gate this on dev mode.
 */

// Every per-user table in the cadence schema (all keyed by user_id).
export const DEV_CHILD_TABLES = [
  'activities', 'ai_log', 'context_pack', 'conversations', 'episodes', 'equipment',
  'goal_events', 'goals', 'meal_plans', 'nutrition_logs', 'occurrences', 'plans', 'recipes',
] as const;

// ensureUser lives in repos/users.ts now (the auth middleware needs it too); re-export so the
// existing script imports (`scripts/account.ts`, `scripts/verify-p1.ts`) keep resolving from here.
export { ensureUser };

/** Wipe all cadence data for a user; keep the users row but reset name + baseline. */
export async function resetUserData(userId: string): Promise<void> {
  await ensureUser(userId);
  // Meal photos live in Storage, not a table — purge them too (the start-over promise:
  // "erases everything"). Best-effort: a storage hiccup must never block the data wipe.
  try {
    await purgeMealPhotos(userId);
  } catch (e) {
    console.warn('[reset] meal-photo purge failed (continuing):', e);
  }
  for (const t of DEV_CHILD_TABLES) {
    await sql`delete from cadence.${sql(t)} where user_id = ${userId}`;
  }
  // name is NOT NULL (default ''); "" is treated as "no name captured" by the context pack.
  await sql`
    update cadence.users
    set name = '', baseline = ${json({})}, last_assessed_at = null, pending_proposal = null,
        pending_plan = null, updated_at = now()
    where id = ${userId}`;
}
