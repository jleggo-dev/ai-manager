import { sql, json } from '../db/sql.ts';
import { ensureUser } from '../repos/users.ts';
import { purgeMealPhotos } from './meal-photos.ts';
import { initialStreakState } from './metrics.ts';
import { EMPTY_DIETARY_PROFILE } from '@cadence/shared';

/**
 * Dev-only account data reset — the shared implementation behind both the `/dev/reset`
 * endpoint (the in-app "Reset" button) and `scripts/account.ts`. Wipes every per-user
 * cadence table and clears the profile, so a test account can be re-onboarded from zero.
 * Real auth is deferred; callers gate this on dev mode.
 */

/**
 * Every per-user table in the cadence schema keyed by `user_id`. `foods` is handled separately
 * below (it keys on `owner_user_id`, and its shared/global rows have no owner at all).
 *
 * **This list is the whole promise, so it is guarded by a test rather than by care.** Seven tables
 * had gone missing from it by 2026-08-12 — `daily_checkins`, `device_tokens`, `health_digests`,
 * `journal_entries`, `notification_prefs`, `notifications`, `session_feedback` — because a list
 * hand-maintained beside `create table` drifts silently and nothing fails when it does. A start-
 * over that says "erases everything" while leaving someone's journal entries and Apple Health
 * digests behind is the kind of quiet lie this product cannot afford, and it is exactly the
 * privacy-shaped end of the drift. `dev-reset.test.ts` reads the migrations and fails if a table
 * with a `user_id` column is not named here, so the NEXT new table cannot slip through either.
 *
 * Order does not matter, and that is a property of the schema, not luck: every FK between these
 * tables is `on delete cascade` or `on delete set null`, so no deletion order can trip one. Kept
 * alphabetical for diffing against the guard test.
 */
export const DEV_CHILD_TABLES = [
  'activities',
  'ai_log',
  'check_ins',
  'context_pack',
  'conversations',
  'daily_checkins',
  'device_tokens',
  'episodes',
  'equipment',
  'food_portions',
  'food_usage',
  'food_usage_ctx',
  'goal_events',
  'goals',
  'health_digests',
  'journal_entries',
  'meal_plans',
  'notification_prefs',
  'notifications',
  'nutrition_logs',
  'occurrences',
  'plans',
  'progress_layouts',
  'recaps',
  'recipes',
  'repertoire',
  'session_feedback',
  'water_logs',
  'workout_history',
] as const;

// ensureUser lives in repos/users.ts now (the auth middleware needs it too); re-export so the
// existing script imports (`scripts/account.ts`, `scripts/verify-p1.ts`) keep resolving from here.
export { ensureUser };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * All the child deletes as ONE round trip.
 *
 * They used to be a `for` loop of awaits — one network hop per table against remote Postgres, where
 * a hop is ~200-400ms. At 15 tables that was already slow enough to make the DB-backed suites
 * flaky; completing the list to 22 pushed their 10s hooks straight over, which is how a correctness
 * fix turned into red tests. Sending the statements together makes the whole wipe faster than the
 * incomplete version it replaces.
 *
 * Separate statements, not one multi-CTE delete, and that distinction is load-bearing: several of
 * these tables cascade into each other (`occurrences` from `activities`, `session_feedback` from
 * `occurrences`), and data-modifying CTEs all run against the same snapshot, so a cascade and an
 * explicit delete racing for the same row is exactly the kind of thing that fails in production and
 * not on a small test fixture. Sequential statements behave identically to the loop they replace.
 *
 * Built by hand because the simple protocol carries no parameters — so both halves are validated
 * rather than trusted: table names come from our own `as const` array and are re-checked here, and
 * the caller's id must be a UUID (`resetUserData` throws otherwise, below).
 */
const CHILD_DELETES = (() => {
  const bad = DEV_CHILD_TABLES.filter((t) => !/^[a-z_]+$/.test(t));
  if (bad.length) throw new Error(`DEV_CHILD_TABLES holds non-identifier names: ${bad.join(', ')}`);
  return DEV_CHILD_TABLES.map((t) => `delete from cadence.${t} where user_id = '%ID%';`).join('\n');
})();

/** Wipe all cadence data for a user; keep the users row but reset name + baseline. */
export async function resetUserData(userId: string): Promise<void> {
  // The id is interpolated into CHILD_DELETES, so this is the injection gate, not a tidiness check.
  if (!UUID.test(userId)) throw new Error('resetUserData: userId must be a UUID');
  await ensureUser(userId);
  // Meal photos live in Storage, not a table — purge them too (the start-over promise:
  // "erases everything"). Best-effort: a storage hiccup must never block the data wipe.
  try {
    await purgeMealPhotos(userId);
  } catch (e) {
    console.warn('[reset] meal-photo purge failed (continuing):', e);
  }
  // One round trip for every child table. `foods` rides along: it keys on owner_user_id, and the
  // shared/global rows (owner null) stay.
  //
  // No explicit begin/commit — the driver rejects those outside `sql.begin` (UNSAFE_TRANSACTION),
  // and they are not needed: Postgres runs the statements of one simple-protocol query inside an
  // implicit transaction, so a failure part-way still leaves nothing half-wiped.
  await sql
    .unsafe(`${CHILD_DELETES}\ndelete from cadence.foods where owner_user_id = '${userId}';`.replaceAll('%ID%', userId))
    .simple();
  // name is NOT NULL (default ''); "" is treated as "no name captured" by the context pack.
  // macro_targets cleared too — observe phase starts with no rings / no "left". streak_state resets
  // to the seed (freezes:1) so a start-over truly begins the streak from zero (Req 4).
  // dietary_profile cleared so allergen/diet prefs don't leak across resets (Req 5).
  await sql`
    update cadence.users
    set name = '', baseline = ${json({})}, macro_targets = ${json({})},
        last_assessed_at = null, pending_proposal = null, pending_plan = null, pending_week_review = null,
        streak_state = ${json(initialStreakState())},
        dietary_profile = ${json(EMPTY_DIETARY_PROFILE)},
        updated_at = now()
    where id = ${userId}`;
}
