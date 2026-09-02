/**
 * A23 §2c — logging a weight on a day the plan did not schedule.
 *
 * The point of "daily weigh-ins" is not a second store: today's reading hangs off the SAME weigh-in
 * activity as the scheduled one, so the series, the history entry and the smoothed trend all keep
 * coming from one place. These pin that, and pin that a plan with no weigh-in says so rather than
 * inventing an activity nobody asked for.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { testUserId } from './test-user.ts';

dotenv.config({ path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../.env') });

const HAS_DB = !!(process.env.CADENCE_DATABASE_URL || process.env.CADENCE_DB_PASSWORD);
const d = HAS_DB ? describe : describe.skip;

const USER = testUserId('a108');

let sql: (typeof import('../db/sql.ts'))['sql'];
let recordWeighInToday: (typeof import('./weigh-in.ts'))['recordWeighInToday'];
let listWeighInSeries: (typeof import('../repos/occurrences.ts'))['listWeighInSeries'];
let getUser: (typeof import('../repos/users.ts'))['getUser'];
let resetUserData: (typeof import('./dev-reset.ts'))['resetUserData'];

const today = (): string => new Date().toISOString().slice(0, 10);

/** The plan spine the planner would have built for a weight goal. */
async function seedWeighInActivity(): Promise<void> {
  const [plan] = await sql<{ plan_id: string }[]>`
    insert into cadence.plans (user_id, goal_ids, status) values (${USER}, '{}', 'active') returning plan_id`;
  await sql`
    insert into cadence.activities (plan_id, user_id, title, kind, category, schedule)
    values (${plan!.plan_id}, ${USER}, 'Weekly weigh-in', 'system', 'measurement', '{}')`;
}

d('A23 §2c — a weight on any day (DB)', () => {
  beforeAll(async () => {
    ({ sql } = await import('../db/sql.ts'));
    ({ recordWeighInToday } = await import('./weigh-in.ts'));
    ({ listWeighInSeries } = await import('../repos/occurrences.ts'));
    ({ getUser } = await import('../repos/users.ts'));
    ({ resetUserData } = await import('./dev-reset.ts'));
  });

  afterAll(async () => {
    if (resetUserData) await resetUserData(USER);
    if (sql) await sql.end({ timeout: 5 });
  });

  beforeEach(async () => {
    await resetUserData(USER);
  });

  it('lands in the same series the scheduled weigh-in feeds', async () => {
    await seedWeighInActivity();

    const r = await recordWeighInToday(USER, 195, 'lb');

    expect(r?.weight_kg).toBeCloseTo(88.5, 1);
    const series = await listWeighInSeries(USER);
    expect(series).toHaveLength(1);
    expect(series[0]).toMatchObject({ date: today() });
    // And the baseline moved with it, so every other surface agrees.
    expect((await getUser(USER))?.baseline?.weight_kg?.current).toBeCloseTo(88.5, 1);
  });

  it('does not mint a second row when logged twice in one day', async () => {
    await seedWeighInActivity();

    await recordWeighInToday(USER, 195, 'lb');
    await recordWeighInToday(USER, 194, 'lb');

    // One occurrence per day: the later reading corrects the earlier one rather than joining it.
    const series = await listWeighInSeries(USER);
    expect(series).toHaveLength(1);
    expect(series[0]!.kg).toBeCloseTo(88, 0);
  });

  it('builds a real series across days, which is what the trend needs', async () => {
    await seedWeighInActivity();
    for (const [day, kg] of [
      [2, 89],
      [1, 88.6],
      [0, 88.4],
    ] as const) {
      const date = new Date(Date.now() - day * 86_400_000).toISOString().slice(0, 10);
      await recordWeighInToday(USER, kg, 'kg', date);
    }
    const series = await listWeighInSeries(USER);
    expect(series).toHaveLength(3);
    expect(series.map((p) => p.kg)).toEqual([89, 88.6, 88.4]);
  });

  it('says no rather than inventing a weigh-in the plan never had', async () => {
    expect(await recordWeighInToday(USER, 195, 'lb')).toBeNull();
    expect(await listWeighInSeries(USER)).toEqual([]);
  });

  /**
   * 2026-09-01: the lookup was `title ~* 'weigh'`, so a plan whose only "weigh" was a WEIGHTED
   * hill session had that session picked as the weigh-in row, and a weight logged from Settings
   * would have landed on a workout. Same word-boundary rule as the client's router now.
   */
  it('does not mistake a weighted workout for the weigh-in row', async () => {
    const [plan] = await sql<{ plan_id: string }[]>`
      insert into cadence.plans (user_id, goal_ids, status) values (${USER}, '{}', 'active') returning plan_id`;
    await sql`
      insert into cadence.activities (plan_id, user_id, title, kind, category, schedule)
      values (${plan!.plan_id}, ${USER}, 'Weighted hill intervals (vest or sandbag) + grip finisher', 'system', 'measurement', '{}')`;

    expect(await recordWeighInToday(USER, 195, 'lb')).toBeNull();
    expect(await listWeighInSeries(USER)).toEqual([]);
  });

  it('still refuses an implausible reading', async () => {
    await seedWeighInActivity();
    expect(await recordWeighInToday(USER, 5, 'kg')).toBeNull();
    expect(await recordWeighInToday(USER, 900, 'kg')).toBeNull();
    expect(await listWeighInSeries(USER)).toEqual([]);
  });
});
