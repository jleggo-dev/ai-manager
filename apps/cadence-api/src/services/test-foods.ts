import { sql } from '../db/sql.ts';

/**
 * Clearing the shared food cache a DB test would otherwise collide with.
 *
 * `testUserId` isolates concurrent runs by putting the pid in the user id, which works because
 * almost everything in `cadence` is keyed by `user_id`. Shared foods are the exception: USDA,
 * Open Food Facts and FatSecret rows have `owner_user_id = null` on purpose, because one cached
 * copy serves everybody. `resetUserData` therefore cannot touch them — they belong to nobody.
 *
 * That is fine until a shared row answers a query a test expected to MISS. The ledger suite proves
 * a first log pins a private food; if "Chai Latte (Venti)" is already in the shared cache, the
 * resolver matches it, nothing is pinned, and the test fails for a reason that has nothing to do
 * with the code. It happened on 2026-08-23 — live FatSecret calls during a failing run cached seven
 * rows, which then broke the same suite a second way.
 *
 * WHY THIS IS SAFE, AND WHY THE CONDITIONS ARE NOT OPTIONAL. A shared food is a CACHE: deleting one
 * costs a refetch and nothing else. But only while nothing points at it. `cadence.food_usage` has
 * `on delete cascade` on `food_id`, so removing a food a real person has eaten would silently take
 * their rhythm history (A23 §1c) with it, and a logged meal referencing it would lose its ledger
 * link. So a row is only removed when NOTHING uses it and NOTHING has logged it — which is exactly
 * the set that costs nothing to lose.
 *
 * Test-only. Never call this from application code.
 */
export async function clearUnusedSharedFoods(namePatterns: string[]): Promise<number> {
  // Guard the NAME, not the wrapped pattern: '%a%' is three characters and would have passed a
  // length check while matching most of the cache. A fragment shorter than this is a wildcard.
  const patterns = namePatterns
    .map((p) => p.trim().toLowerCase())
    .filter((p) => p.length >= 3)
    .map((p) => `%${p}%`);
  if (patterns.length === 0) return 0;
  const gone = await sql`
    delete from cadence.foods f
    where f.owner_user_id is null
      and f.visibility = 'shared'
      and lower(f.name) like any(${patterns})
      and not exists (select 1 from cadence.food_usage u where u.food_id = f.food_id)
      and not exists (
        select 1
        from cadence.nutrition_logs l, jsonb_array_elements(l.items) i
        where i->>'food_id' = f.food_id::text
      )
    returning f.food_id`;
  return gone.length;
}
