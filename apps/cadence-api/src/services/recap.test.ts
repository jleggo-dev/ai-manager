/**
 * A23 §2b — the weekly check-in, against a real Cadence Postgres.
 *
 * What these pin, in order of how badly each would hurt:
 *   • the numbers are the check-in — a failed narration costs the prose and nothing else;
 *   • averages count the days they LOGGED, never the seven days they might have (dividing by
 *     seven is the arithmetic version of counting what broke);
 *   • the model is handed data and nothing else — every variable the job declares is populated
 *     by app code, which is the contract its own config states;
 *   • the weigh-in rides along, so Sunday is one moment rather than two unconnected tasks.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { testUserId } from './test-user.ts';

dotenv.config({ path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../.env') });

const HAS_DB = !!(process.env.CADENCE_DATABASE_URL || process.env.CADENCE_DB_PASSWORD);
const d = HAS_DB ? describe : describe.skip;

const USER = testUserId('a107');
const TODAY = '2026-08-22';

vi.mock('../ai/aim.ts', () => ({ runJob: vi.fn(), runJobBySlug: vi.fn() }));

let sql: (typeof import('../db/sql.ts'))['sql'];
let getWeeklyRecap: (typeof import('./recap.ts'))['getWeeklyRecap'];
let buildRecapFacts: (typeof import('./recap.ts'))['buildRecapFacts'];
let insertNutritionLog: (typeof import('../repos/nutrition.ts'))['insertNutritionLog'];
let setMacroTargets: (typeof import('../repos/users.ts'))['setMacroTargets'];
let resetUserData: (typeof import('./dev-reset.ts'))['resetUserData'];
let runJobBySlug: ReturnType<typeof vi.fn>;

/** N days before TODAY, as YYYY-MM-DD. */
function daysBefore(n: number): string {
  return new Date(Date.parse(`${TODAY}T00:00:00Z`) - n * 86_400_000).toISOString().slice(0, 10);
}

d('A23 §2b — the weekly check-in (DB)', () => {
  beforeAll(async () => {
    ({ sql } = await import('../db/sql.ts'));
    ({ getWeeklyRecap, buildRecapFacts } = await import('./recap.ts'));
    ({ insertNutritionLog } = await import('../repos/nutrition.ts'));
    ({ setMacroTargets } = await import('../repos/users.ts'));
    ({ resetUserData } = await import('./dev-reset.ts'));
    ({ runJobBySlug } = (await import('../ai/aim.ts')) as unknown as { runJobBySlug: ReturnType<typeof vi.fn> });
  });

  afterAll(async () => {
    if (resetUserData) await resetUserData(USER);
    if (sql) await sql.end({ timeout: 5 });
  });

  beforeEach(async () => {
    await resetUserData(USER);
    runJobBySlug.mockReset();
  });

  afterEach(() => {
    runJobBySlug.mockReset();
  });

  /** Three logged days inside the window, one of them provisional and therefore uncounted. */
  async function seedFood(): Promise<void> {
    for (const [day, kcal] of [
      [0, 2000],
      [1, 2200],
      [2, 1800],
    ] as const) {
      await insertNutritionLog(USER, {
        date: daysBefore(day),
        meal: 'lunch',
        items: [{ name: 'lunch' }],
        input_method: 'text',
        raw_text: 'lunch',
        macros: { kcal, protein_g: 120, source: 'ledger' },
        provisional: false,
      });
    }
    await insertNutritionLog(USER, {
      date: daysBefore(3),
      meal: 'dinner',
      items: [{ name: 'guess' }],
      input_method: 'text',
      raw_text: 'guess',
      macros: { kcal: 9000, source: 'ai' },
      provisional: true, // excluded everywhere else, and it must be excluded here too
    });
  }

  it('averages the days they logged, not the days in the week', async () => {
    await seedFood();
    await setMacroTargets(USER, { kcal: 2100 });

    const facts = await buildRecapFacts(USER, TODAY);

    // They logged on four days; three of them carry numbers we trust.
    expect(facts.nutrition?.days_logged).toBe(4);
    expect(facts.nutrition?.days_counted).toBe(3);
    expect(facts.nutrition?.days_in_window).toBe(7);
    // (2000 + 2200 + 1800) / 3 — a provisional 9000 kcal row cannot reach this.
    expect(facts.nutrition?.avg_kcal).toBe(2000);
    expect(facts.nutrition?.avg_protein_g).toBe(120);
    expect(facts.nutrition?.target_kcal).toBe(2100);
  });

  it('says nothing about food rather than reporting a zero week', async () => {
    const facts = await buildRecapFacts(USER, TODAY);
    expect(facts.nutrition).toBeNull();
    expect(facts.consistency).toEqual({ kept: 0, window: 7 });
    expect(facts.rolling.window).toBe(28);
  });

  it('hands the job every variable it declares, and only data', async () => {
    await seedFood();
    runJobBySlug.mockResolvedValueOnce({ formatted: 'Three days logged, and the week held.' });

    const recap = await getWeeklyRecap(USER, TODAY);

    expect(runJobBySlug).toHaveBeenCalledOnce();
    const [, slug, vars] = runJobBySlug.mock.calls[0]!;
    expect(slug).toBe('weekly-readout');
    // The job's own config declares exactly these six.
    expect(Object.keys(vars as object).sort()).toEqual(
      ['consistency', 'episodes', 'goals_progress', 'outcomes', 'period', 'rolling_window'].sort(),
    );
    const v = vars as Record<string, string>;
    expect(v.period).toBe(`${daysBefore(6)} to ${TODAY}`);
    expect(v.consistency).toMatch(/^\d+ of 7 days$/);
    expect(v.rolling_window).toMatch(/^\d+ of 28 days$/);
    const food = JSON.parse(v.outcomes!).food;
    expect(food.days_logged).toBe('4 of 7');
    expect(food.avg_is_over_days).toBe(3);
    expect(recap.note).toBe('Three days logged, and the week held.');
  });

  /** The rule the photo path learned the expensive way: an error must not read as an empty week. */
  it('still returns the week when the narration fails', async () => {
    await seedFood();
    runJobBySlug.mockRejectedValueOnce(new Error('coach profile unavailable'));

    const recap = await getWeeklyRecap(USER, TODAY);

    expect(recap.note).toBe('');
    expect(recap.nutrition?.days_counted).toBe(3);
    expect(recap.period.to).toBe(TODAY);
  });

  it('leaves the weigh-in out when the plan has none scheduled', async () => {
    const facts = await buildRecapFacts(USER, TODAY);
    expect(facts.weigh_in).toBeNull();
    expect(facts.weight).toBeNull();
  });

  it('carries this week’s weigh-in so Sunday is one moment, not two', async () => {
    const [plan] = await sql<{ plan_id: string }[]>`
      insert into cadence.plans (user_id, goal_ids, status) values (${USER}, '{}', 'active') returning plan_id`;
    const [act] = await sql<{ activity_id: string }[]>`
      insert into cadence.activities (plan_id, user_id, title, kind, category, schedule)
      values (${plan!.plan_id}, ${USER}, 'Weekly weigh-in', 'system', 'measurement', '{}')
      returning activity_id`;
    await sql`
      insert into cadence.occurrences (user_id, activity_id, date, status)
      values (${USER}, ${act!.activity_id}, ${daysBefore(1)}, 'pending')`;

    const facts = await buildRecapFacts(USER, TODAY);

    expect(facts.weigh_in).toMatchObject({ date: daysBefore(1), pending: true });
  });
});
