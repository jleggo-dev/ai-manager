/**
 * Delete the per-process users the DB-backed suites leave behind (`services/test-user.ts`).
 *
 * Those ids carry the pid so two concurrent runs cannot wipe each other's rows, which means each
 * run leaves one user behind and `afterAll` cannot be relied on — a crashed or killed run never
 * gets there. Nobody owns them, so they are removed outright.
 *
 * Only IDLE ones. The sweep runs from `npm run cleanup:test-data`, which the workflow says to run
 * right after a merge — exactly when main's CI is running the same suites against the same
 * database. Sweeping every matching row deleted users out from under a live run twice on
 * 2026-10-31 (18:43 and 19:31 UTC): a `water_logs_user_id_fkey` violation, a plan that vanished
 * after commit, and a goal that vanished before its assertion. Main went red on a merge that had
 * nothing wrong with it.
 *
 * A live suite cannot be idle: every `beforeEach` calls `resetUserData` → `ensureUser`, which sets
 * `updated_at = now()`. That also covers a pid reused from an old run — the first `beforeEach`
 * makes the old row fresh again. The freshness check is repeated per row right before it is
 * touched, so a run that starts between the listing and the delete is left alone too.
 *
 * Matched on the synthetic prefix plus the four-hex suite marker, which is narrower than the
 * scratch namespace and cannot touch a real auth user.
 */
import { sql } from '../db/sql.ts';
import { resetUserData } from './dev-reset.ts';

const SUITE_USER = '^00000000-0000-4000-a000-[0-9a-f]{4}[0-9a-f]{8}$';
const SCRATCH_ACCOUNT = '^00000000-0000-4000-a000-0000000';

/** How long a suite user must go untouched before it counts as left behind. */
export const SUITE_USER_IDLE_MINUTES = 60;

export interface SweepResult {
  swept: string[];
  /** Matching users touched within the idle window — a run may be using them right now. */
  skippedLive: number;
}

/**
 * `only` narrows the sweep to those ids. The sweep's own test passes its three users: sweeping the
 * whole table under a running CI (every idle user is a cascading delete) timed out at 30 s three
 * times on 2026-11-01. The cleanup script passes nothing and sweeps everything idle.
 */
export async function sweepSuiteUsers(
  idleMinutes = SUITE_USER_IDLE_MINUTES,
  only?: readonly string[],
): Promise<SweepResult> {
  const scope = only ? sql`and id = any(${[...only]}::uuid[])` : sql``;
  const rows = await sql<{ id: string; idle: boolean }[]>`
    select id::text, updated_at < now() - make_interval(mins => ${idleMinutes}) as idle
      from cadence.users
     where id::text ~ ${SUITE_USER}
       and id::text !~ ${SCRATCH_ACCOUNT}
       ${scope}`;
  const swept: string[] = [];
  let skippedLive = rows.filter((r) => !r.idle).length;
  for (const { id } of rows.filter((r) => r.idle)) {
    const [still] = await sql<{ idle: boolean }[]>`
      select updated_at < now() - make_interval(mins => ${idleMinutes}) as idle
        from cadence.users where id = ${id}`;
    if (!still?.idle) {
      if (still) skippedLive++;
      continue;
    }
    await resetUserData(id);
    await sql`delete from cadence.users where id = ${id}`;
    swept.push(id);
  }
  return { swept, skippedLive };
}
