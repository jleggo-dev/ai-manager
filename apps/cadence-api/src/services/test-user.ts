/**
 * A test user nobody else is using.
 *
 * The DB-backed suites run against the REAL Cadence Postgres, and each one owned a fixed uuid
 * (`…a101`, `…a104`, `…a105`, `…a107`) that its `beforeEach` wiped with `resetUserData`. That is
 * correct for one runner and quietly destructive for two: on 2026-08-17 a second process — an
 * agent working in a git worktree against the same database — reset the same rows mid-test, and
 * the first run's freshly seeded goal vanished between its insert and the insert that referenced
 * it. It surfaced as `activities_goal_id_fkey` violations and a deadlock.
 *
 * The cost is not the lost run. It is that a foreign-key violation from contention is
 * indistinguishable from a foreign-key violation from a real bug, so the habit it teaches is to
 * re-run a red suite and believe the green — which is exactly how a genuine failure gets waved
 * through. Twice today a red suite had to be hand-proved innocent before work could continue.
 *
 * So the id carries the process in it. Concurrent runs cannot see each other's rows at all, and no
 * lock, retry or serialisation is needed. The shape stays inside the obviously-synthetic
 * `00000000-0000-4000-a000-…` namespace, and keeps the per-suite marker so a stray row still says
 * which suite left it.
 */

/**
 * `00000000-0000-4000-a000-<marker><pid>` — a valid v4-shaped uuid unique to this process.
 *
 * @param marker four hex characters identifying the suite (the old fixed tail, e.g. 'a101').
 */
export function testUserId(marker: string): string {
  if (!/^[0-9a-f]{4}$/.test(marker)) throw new Error(`testUserId: marker must be 4 hex chars, got "${marker}"`);
  // 8 hex of pid fills the 12-character final group. Pids are well under 2^32.
  const pid = (process.pid >>> 0).toString(16).padStart(8, '0').slice(-8);
  return `00000000-0000-4000-a000-${marker}${pid}`;
}
