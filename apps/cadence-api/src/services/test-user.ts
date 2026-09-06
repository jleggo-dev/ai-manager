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
  return `00000000-0000-4000-a000-${marker}${pidHex()}`;
}

/** 8 hex of pid — fills a uuid's 12-character final group. Pids are well under 2^32. */
function pidHex(): string {
  return (process.pid >>> 0).toString(16).padStart(8, '0').slice(-8);
}

/**
 * A fixture NAME nobody else is using — the same isolation, for rows that are not keyed by user.
 *
 * `testUserId` covers almost everything, because almost everything in `cadence` hangs off a
 * user_id. The shared food cache is the documented exception: those rows have `owner_user_id =
 * null` on purpose, so `resetUserData` cannot reach them and a suite has to tidy them by NAME
 * instead. A name is global. `delete from cadence.foods where name like 'Zzq Test%'` therefore
 * deletes every concurrent run's fixtures along with its own, and hands back exactly the failure
 * this module was written to end — one process's row vanishing between two of another's
 * statements.
 *
 * It did, on 2026-09-05: an assertion that a PRIVATE food survived, in a suite where the function
 * under test provably cannot delete private foods, reddened a PR that had touched nothing but an
 * Info.plist and two docs files. Re-running it went green, which is the outcome this file's
 * opening comment warns is the real cost.
 *
 * So a name carries the process too. Still starts with `Zzq` so a stray row reads as obviously
 * synthetic, and so any human-facing sweep for test detritus still finds it.
 */
export function testNamePrefix(): string {
  return `Zzq${pidHex()}`;
}

/** `Zzq<pid> Latte` — a fixture name unique to this process. Sweep with `testNamePrefix()`. */
export function testName(base: string): string {
  return `${testNamePrefix()} ${base}`;
}
