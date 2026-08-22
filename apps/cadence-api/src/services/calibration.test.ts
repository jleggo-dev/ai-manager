/**
 * A23 §3 — calibration end to end, against a real Cadence Postgres.
 *
 * The pure arithmetic has its own suite; these pin the parts only a database can prove: that the
 * daily series is built from the same rows the rest of the app trusts, that a provisional day is
 * excluded here exactly as it is everywhere else, and that "not yet" arrives as a real answer with
 * progress attached rather than as a silent null.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { testUserId } from './test-user.ts';

dotenv.config({ path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../.env') });

const HAS_DB = !!(process.env.CADENCE_DATABASE_URL || process.env.CADENCE_DB_PASSWORD);
const d = HAS_DB ? describe : describe.skip;

const USER = testUserId('a109');
const TODAY = '2026-08-22';

let sql: (typeof import('../db/sql.ts'))['sql'];
let getCalibration: (typeof import('./calibration.ts'))['getCalibration'];
let groupDailyIntake: (typeof import('./calibration.ts'))['groupDailyIntake'];
let goalDirection: (typeof import('./calibration.ts'))['goalDirection'];
let insertNutritionLog: (typeof import('../repos/nutrition.ts'))['insertNutritionLog'];
let mergeBaseline: (typeof import('../repos/users.ts'))['mergeBaseline'];
let setMacroTargets: (typeof import('../repos/users.ts'))['setMacroTargets'];
let resetUserData: (typeof import('./dev-reset.ts'))['resetUserData'];

const dayBefore = (n: number): string =>
  new Date(Date.parse(`${TODAY}T00:00:00Z`) - n * 86_400_000).toISOString().slice(0, 10);

d('A23 §3 — calibration (DB)', () => {
  beforeAll(async () => {
    ({ sql } = await import('../db/sql.ts'));
    ({ getCalibration, groupDailyIntake, goalDirection } = await import('./calibration.ts'));
    ({ insertNutritionLog } = await import('../repos/nutrition.ts'));
    ({ mergeBaseline, setMacroTargets } = await import('../repos/users.ts'));
    ({ resetUserData } = await import('./dev-reset.ts'));
  });

  afterAll(async () => {
    if (resetUserData) await resetUserData(USER);
    if (sql) await sql.end({ timeout: 5 });
  });

  beforeEach(async () => {
    await resetUserData(USER);
  });

  /** `days` days of logs at `kcal`, plus weekly weigh-ins losing `kgPerWeek`. */
  async function seed(opts: { days: number; kcal: number; weighIns: number; kgPerWeek: number }): Promise<void> {
    for (let i = 0; i < opts.days; i++) {
      await insertNutritionLog(USER, {
        date: dayBefore(i),
        meal: 'lunch',
        items: [{ name: 'lunch' }],
        input_method: 'text',
        raw_text: 'lunch',
        macros: { kcal: opts.kcal, source: 'ledger' },
        provisional: false,
      });
    }
    const [plan] = await sql<{ plan_id: string }[]>`
      insert into cadence.plans (user_id, goal_ids, status) values (${USER}, '{}', 'active') returning plan_id`;
    const [act] = await sql<{ activity_id: string }[]>`
      insert into cadence.activities (plan_id, user_id, title, kind, category, schedule)
      values (${plan!.plan_id}, ${USER}, 'Weekly weigh-in', 'system', 'measurement', '{}') returning activity_id`;
    for (let i = 0; i < opts.weighIns; i++) {
      const kg = 90 + opts.kgPerWeek * (opts.weighIns - 1 - i);
      await sql`
        insert into cadence.occurrences (user_id, activity_id, date, status, value)
        values (${USER}, ${act!.activity_id}, ${dayBefore(i * 7)}, 'done', ${sql.json({ weight_kg: kg })})`;
    }
    await mergeBaseline(USER, { weight_kg: { current: 90, start: 92, source: 'manual', updated_at: TODAY } });
  }

  it('computes maintenance above intake for someone losing, and proposes a target under it', async () => {
    await seed({ days: 28, kcal: 2000, weighIns: 5, kgPerWeek: -0.5 });
    await sql`
      insert into cadence.goals (user_id, title, area, type, status, measure)
      values (${USER}, 'Get to 85kg', 'movement', 'target', 'confirmed', ${sql.json({ unit: 'kg', target: 85 })})`;

    const c = await getCalibration(USER, TODAY);

    expect(c.blocker).toBeNull();
    expect(c.maintenance!.maintenance_kcal).toBeGreaterThan(2000);
    expect(c.direction).toBe('lose');
    expect(c.proposed!.kcal).toBeLessThan(c.maintenance!.maintenance_kcal);
  });

  it('will not answer off a fortnight of logging, and says how far along they are', async () => {
    await seed({ days: 8, kcal: 2000, weighIns: 5, kgPerWeek: -0.5 });
    const c = await getCalibration(USER, TODAY);

    expect(c.maintenance).toBeNull();
    expect(c.blocker).toBe('not_enough_logged_days');
    expect(c.complete_days).toBe(8);
    expect(c.complete_days_needed).toBe(17);
  });

  it('will not answer off two weigh-ins', async () => {
    await seed({ days: 28, kcal: 2000, weighIns: 2, kgPerWeek: -0.5 });
    expect((await getCalibration(USER, TODAY)).blocker).toBe('not_enough_weigh_ins');
  });

  /** Provisional rows are excluded from day totals everywhere else; this must be no exception. */
  it('does not let a provisional day into the mean', async () => {
    await seed({ days: 28, kcal: 2000, weighIns: 5, kgPerWeek: -0.5 });
    await insertNutritionLog(USER, {
      date: dayBefore(0),
      meal: 'dinner',
      items: [{ name: 'guess' }],
      input_method: 'text',
      raw_text: 'guess',
      macros: { kcal: 5000, source: 'ai' },
      provisional: true,
    });

    const c = await getCalibration(USER, TODAY);
    expect(c.maintenance!.mean_intake_kcal).toBe(2000);
  });

  it('holds the proposal above the floor rather than chasing the arithmetic down', async () => {
    // Eating very little while barely losing implies a low maintenance; the floor is what stops
    // the loop prescribing something punitive from it.
    await seed({ days: 28, kcal: 1200, weighIns: 5, kgPerWeek: -0.05 });
    await sql`
      insert into cadence.goals (user_id, title, area, type, status, measure)
      values (${USER}, 'Get to 85kg', 'movement', 'target', 'confirmed', ${sql.json({ unit: 'kg', target: 85 })})`;
    await setMacroTargets(USER, { kcal: 1300 });
    const c = await getCalibration(USER, TODAY);

    expect(c.proposed!.kcal).toBeGreaterThanOrEqual(Math.round(c.maintenance!.maintenance_kcal * 0.85 * 0.999));
    expect(c.proposed!.limited_by).toBe('maintenance_floor');
  });

  it('refuses a third cut in a month, and says which guardrail stopped it', async () => {
    await seed({ days: 28, kcal: 2000, weighIns: 5, kgPerWeek: -0.1 });
    await sql`
      insert into cadence.goals (user_id, title, area, type, status, measure)
      values (${USER}, 'Get to 85kg', 'movement', 'target', 'confirmed', ${sql.json({ unit: 'kg', target: 85 })})`;
    await setMacroTargets(USER, {
      kcal: 2200,
      adjustments: [
        { date: dayBefore(20), from: 2500, to: 2350 },
        { date: dayBefore(10), from: 2350, to: 2200 },
      ],
    });

    const c = await getCalibration(USER, TODAY);
    expect(c.proposed!.kcal).toBe(2200);
    expect(c.proposed!.limited_by).toBe('ratchet');
  });
});

describe('groupDailyIntake / goalDirection (pure)', () => {
  it('sums a day and marks it complete only from rows we trust', async () => {
    ({ groupDailyIntake, goalDirection } = await import('./calibration.ts'));
    const rows = [
      { date: '2026-08-20', macros: { kcal: 600 }, provisional: false },
      { date: '2026-08-20', macros: { kcal: 700 }, provisional: false },
      { date: '2026-08-21', macros: { kcal: 900 }, provisional: true },
    ] as unknown as Parameters<typeof groupDailyIntake>[0];

    expect(groupDailyIntake(rows)).toEqual([
      { date: '2026-08-20', kcal: 1300, complete: true },
      { date: '2026-08-21', kcal: 0, complete: false },
    ]);
  });

  /** The trap: comparing a pounds target to a kilos weight and inferring a forty-kilo gain goal. */
  it('compares the target in the unit it was captured in', async () => {
    ({ goalDirection } = await import('./calibration.ts'));
    const lbGoal = [{ type: 'target', measure: { unit: 'lb', target: 180 } }];
    expect(goalDirection(lbGoal, 90)).toBe('lose'); // 90kg ≈ 198lb → 180lb is a loss
    const kgGoal = [{ type: 'target', measure: { unit: 'kg', target: 95 } }];
    expect(goalDirection(kgGoal, 90)).toBe('gain');
    expect(goalDirection([{ type: 'target', measure: { unit: 'kg', target: 90 } }], 90)).toBe('hold');
    expect(goalDirection([], 90)).toBe('hold');
  });
});
