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
 * A live suite cannot be idle: every `beforeEach` calls `resetUserData`, whose FIRST statement
 * after the row exists sets `updated_at = now()` (`touchUser`). That also covers a pid reused from
 * an old run — CI runners boot the same way every time, so a worker gets the pid an earlier run's
 * worker had, and the same user id with it; the new run's first `beforeEach` makes the old row
 * fresh again.
 *
 * The check and the delete are ONE statement. The first version re-checked freshness, then ran
 * the whole `resetUserData` (three storage purges and a wipe of every child table — a second or
 * two per row), then deleted the row. On 2026-11-03 (19:55 UTC) a CI run's `beforeEach` picked up
 * its reused row inside that gap, and `resetUserData` then bumped `updated_at` only as its LAST
 * statement, so the sweep deleted the user while the run was inserting:
 * `nutrition_logs_user_id_fkey`, main red at 61de4c83 on a merge that had nothing wrong with it.
 * Now the delete carries the idle predicate itself; Postgres re-evaluates it on the row's current
 * version under the row lock, so a touch that lands first wins, every time. Every child table
 * cascades on user delete (migrations: 27 of 27 `references cadence.users … on delete cascade`),
 * and the storage purges need only the id, so they run after.
 *
 * Matched on the synthetic prefix plus the four-hex suite marker, which is narrower than the
 * scratch namespace and cannot touch a real auth user.
 */
import { sql } from '../db/sql.ts';
import { purgeMealPhotos } from './meal-photos.ts';
import { purgeProgressPhotos } from './progress-photos.ts';
import { purgeCoachAttachments } from './coach-attachments.ts';

const SUITE_USER = '^00000000-0000-4000-a000-[0-9a-f]{4}[0-9a-f]{8}$';
const SCRATCH_ACCOUNT = '^00000000-0000-4000-a000-0000000';

/** How long a suite user must go untouched before it counts as left behind. */
export const SUITE_USER_IDLE_MINUTES = 60;

export interface SweepResult {
  swept: string[];
  /** Matching users touched within the idle window — a run may be using them right now. */
  skippedLive: number;
}

export interface SweepHooks {
  /**
   * Runs after the listing and before each listed row's delete. The sweep's own test uses it to
   * stand in for a run that starts in exactly that gap; production passes nothing.
   */
  beforeDelete?: (id: string) => Promise<void>;
}

/**
 * `only` narrows the sweep to those ids. The sweep's own test passes its users: sweeping the
 * whole table under a running CI (every idle user is a cascading delete) timed out at 30 s three
 * times on 2026-11-01. The cleanup script passes nothing and sweeps everything idle.
 */
export async function sweepSuiteUsers(
  idleMinutes = SUITE_USER_IDLE_MINUTES,
  only?: readonly string[],
  hooks: SweepHooks = {},
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
    await hooks.beforeDelete?.(id);
    // The idle check and the delete are one statement: a run that touched the row since the
    // listing keeps it, and there is no gap between a check and a delete for a run to fall into.
    const gone = await sql<{ id: string }[]>`
      delete from cadence.users
       where id = ${id}
         and updated_at < now() - make_interval(mins => ${idleMinutes})
      returning id::text`;
    if (gone.length === 0) {
      const [still] = await sql<{ id: string }[]>`select id::text from cadence.users where id = ${id}`;
      if (still) skippedLive++;
      continue;
    }
    await purgeStorage(id);
    swept.push(id);
  }
  return { swept, skippedLive };
}

/**
 * Photos and chat attachments live in Storage, not in a table, so the cascade cannot reach them.
 * Best-effort and by id alone — the row is already gone.
 */
async function purgeStorage(id: string): Promise<void> {
  for (const purge of [purgeMealPhotos, purgeProgressPhotos, purgeCoachAttachments]) {
    try {
      await purge(id);
    } catch (e) {
      console.warn(`[sweep] storage purge failed for ${id} (continuing):`, e);
    }
  }
}
