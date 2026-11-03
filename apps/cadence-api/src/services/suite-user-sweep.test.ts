import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { testUserId } from './test-user.ts';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
dotenv.config({ path: path.join(repoRoot, 'apps/cadence-api/.env') });

const HAS_DB = !!(process.env.CADENCE_DATABASE_URL || process.env.CADENCE_DB_PASSWORD);
const d = HAS_DB ? describe : describe.skip;

// The first storage purge is the first thing `resetUserData` does after the row exists; wrapping it
// lets one test look at the row at that moment. The wrapper calls the real purge otherwise.
vi.mock('./meal-photos.ts', async (importOriginal) => {
  const mod = await importOriginal<typeof import('./meal-photos.ts')>();
  return { ...mod, purgeMealPhotos: vi.fn(mod.purgeMealPhotos) };
});

/**
 * `npm run cleanup:test-data` runs right after a merge, while main's CI runs the DB suites against
 * the same database. On 2026-10-31 the sweep deleted a running suite's user twice and main went red
 * on a clean merge. On 2026-11-03 it did it again through the gap between its freshness check and
 * its delete (main red at 61de4c83). A user a run is using must survive; one left behind by a
 * finished or crashed run must not.
 */
const LIVE = testUserId('5e01');
const IDLE = testUserId('5e02');
const REUSED = testUserId('5e03');
const RACED = testUserId('5e04');
const TOUCHED = testUserId('5e05');

let sql: (typeof import('../db/sql.ts'))['sql'];
let ensureUser: (typeof import('./dev-reset.ts'))['ensureUser'];
let resetUserData: (typeof import('./dev-reset.ts'))['resetUserData'];
let sweepSuiteUsers: (typeof import('./suite-user-sweep.ts'))['sweepSuiteUsers'];

async function exists(id: string): Promise<boolean> {
  const [row] = await sql<{ id: string }[]>`select id::text from cadence.users where id = ${id}`;
  return !!row;
}

async function age(id: string, minutes: number): Promise<void> {
  await sql`update cadence.users set updated_at = now() - make_interval(mins => ${minutes}) where id = ${id}`;
}

d('sweepSuiteUsers — leaves a live run alone (DB)', () => {
  beforeAll(async () => {
    ({ sql } = await import('../db/sql.ts'));
    ({ ensureUser, resetUserData } = await import('./dev-reset.ts'));
    ({ sweepSuiteUsers } = await import('./suite-user-sweep.ts'));
  }, 30_000);

  afterAll(async () => {
    for (const id of [LIVE, IDLE, REUSED, RACED, TOUCHED]) {
      await resetUserData(id);
      await sql`delete from cadence.users where id = ${id}`;
    }
    await sql.end({ timeout: 5 });
  });

  it('keeps a user a suite just touched, removes one nobody has touched in an hour', async () => {
    await ensureUser(LIVE);
    await ensureUser(IDLE);
    await age(IDLE, 120);

    // Its own two users only: the whole table under a running CI is minutes of cascading deletes.
    const { swept } = await sweepSuiteUsers(undefined, [LIVE, IDLE]);

    expect(await exists(LIVE)).toBe(true);
    expect(swept).not.toContain(LIVE);
    expect(await exists(IDLE)).toBe(false);
    expect(swept).toContain(IDLE);
  });

  it('keeps an old row a new run has picked up again (a reused pid)', async () => {
    await ensureUser(REUSED);
    await age(REUSED, 600);
    // The new run's first beforeEach — this is what every DB suite does.
    await resetUserData(REUSED);

    const { swept } = await sweepSuiteUsers(undefined, [REUSED]);

    expect(await exists(REUSED)).toBe(true);
    expect(swept).not.toContain(REUSED);
  });

  it('keeps a row a run picks up between the listing and the delete (the 2026-11-03 gap)', async () => {
    await ensureUser(RACED);
    await age(RACED, 600);

    // Listed idle — then the new run's first beforeEach lands before the sweep reaches the row.
    const { swept } = await sweepSuiteUsers(undefined, [RACED], {
      beforeDelete: async (id) => {
        if (id === RACED) await resetUserData(RACED);
      },
    });

    expect(await exists(RACED)).toBe(true);
    expect(swept).not.toContain(RACED);
  });

  it('resetUserData makes the row fresh before its wipe begins, not after', async () => {
    await ensureUser(TOUCHED);
    await age(TOUCHED, 600);
    const { purgeMealPhotos } = await import('./meal-photos.ts');
    let freshAtFirstPurge: boolean | null = null;
    vi.mocked(purgeMealPhotos).mockImplementationOnce(async (id: string) => {
      const [row] = await sql<{ fresh: boolean }[]>`
        select updated_at > now() - make_interval(mins => 1) as fresh from cadence.users where id = ${id}`;
      freshAtFirstPurge = row?.fresh ?? null;
    });

    await resetUserData(TOUCHED);

    // The wipe takes a second or two; a sweep that checks during it must already see a live row.
    expect(freshAtFirstPurge).toBe(true);
  });
});
