/**
 * `listSettledCommitmentDates` against the real table. The horizon fill keys a Set on
 * `${commitment_id}|${date}`, and `plan-horizon.test.ts` mocks this read with string dates — which
 * is exactly how the real one returning a JS Date (postgres.js parses a `date` column) went unseen:
 * every commit re-issued the morning's done breakfast and piano beside the done rows (2026-11-01).
 * This suite pins the shape the caller relies on: a plain `YYYY-MM-DD` string.
 *
 * Same harness as follow-ups.test.ts: skips with no Cadence DB env, lazy imports, a per-process
 * synthetic user, deleted after.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { testUserId } from '../services/test-user.ts';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
dotenv.config({ path: path.join(repoRoot, 'apps/cadence-api/.env') });

const HAS_DB = !!(process.env.CADENCE_DATABASE_URL || process.env.CADENCE_DB_PASSWORD);
const d = HAS_DB ? describe : describe.skip;

const USER = testUserId('c0d1');
const COMMITMENT = '00000000-0000-4000-a000-c0d100000001';

let sql: (typeof import('../db/sql.ts'))['sql'];
let listSettledCommitmentDates: (typeof import('./commitment-dates.ts'))['listSettledCommitmentDates'];

async function wipe(): Promise<void> {
  await sql`delete from cadence.occurrences where user_id = ${USER}`;
  await sql`delete from cadence.activities where user_id = ${USER}`;
  await sql`delete from cadence.plans where user_id = ${USER}`;
}

d('listSettledCommitmentDates (DB)', () => {
  beforeAll(async () => {
    ({ sql } = await import('../db/sql.ts'));
    ({ listSettledCommitmentDates } = await import('./commitment-dates.ts'));
    const { ensureUser } = await import('./users.ts');
    await ensureUser(USER, 'zzq-commitment-dates@cadence.test');
    await wipe();
    // Two versions of one commitment: the done row sits on the superseded plan, the new plan's
    // row is still pending — the shape a mid-day commit leaves behind.
    const [oldPlan] = await sql<Array<{ plan_id: string }>>`
      insert into cadence.plans (user_id, version, status) values (${USER}, 1, 'superseded') returning plan_id`;
    const [newPlan] = await sql<Array<{ plan_id: string }>>`
      insert into cadence.plans (user_id, version, status) values (${USER}, 2, 'active') returning plan_id`;
    const [oldAct] = await sql<Array<{ activity_id: string }>>`
      insert into cadence.activities (user_id, plan_id, commitment_id, title, kind)
      values (${USER}, ${oldPlan!.plan_id}, ${COMMITMENT}, 'zzq Log breakfast', 'system') returning activity_id`;
    const [newAct] = await sql<Array<{ activity_id: string }>>`
      insert into cadence.activities (user_id, plan_id, commitment_id, title, kind)
      values (${USER}, ${newPlan!.plan_id}, ${COMMITMENT}, 'zzq Log breakfast', 'system') returning activity_id`;
    await sql`
      insert into cadence.occurrences (activity_id, user_id, date, status) values
        (${oldAct!.activity_id}, ${USER}, '2026-11-01', 'done'),
        (${newAct!.activity_id}, ${USER}, '2026-11-02', 'pending')`;
  }, 30_000);

  afterAll(async () => {
    await wipe();
    await sql`delete from cadence.users where id = ${USER}`;
    await sql.end({ timeout: 5 });
  }, 30_000);

  it('returns the settled date as the same YYYY-MM-DD string the horizon fill keys on', async () => {
    const rows = await listSettledCommitmentDates(USER, '2026-11-01', '2026-11-08');
    expect(rows).toEqual([{ commitment_id: COMMITMENT, date: '2026-11-01' }]);
    // The exact key ensureHorizon builds — a Date here stringifies to "Sun Nov 01 2026 …".
    expect(rows.map((r) => `${r.commitment_id}|${r.date}`)).toContain(`${COMMITMENT}|2026-11-01`);
  });

  it('leaves pending rows and dates outside the window out', async () => {
    expect(await listSettledCommitmentDates(USER, '2026-11-02', '2026-11-08')).toEqual([]);
  });
});
