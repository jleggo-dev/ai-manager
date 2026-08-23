/**
 * API-04 — integration tests for nutrition orchestration (logMeal fallback + provisional
 * gating; getBaselineRead day-count cost-control gate + propose_targets gating).
 *
 * Same harness as API-01: real Cadence Postgres + mocked AI seam (`ai/aim.ts`). Skips cleanly
 * when no CADENCE_* DB env is configured.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { testUserId } from './test-user.ts';

dotenv.config({ path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../.env') });

const HAS_DB = !!(process.env.CADENCE_DATABASE_URL || process.env.CADENCE_DB_PASSWORD);
const d = HAS_DB ? describe : describe.skip;

/** Dedicated synthetic user — isolated from plan-commit and demo accounts. */
const USER = testUserId('a104');

// The FatSecret rung is mocked for the same reason USDA is: a test must not depend on a third
// party, and once real credentials exist in .env these would quietly start making live calls.
vi.mock('./food-sources/fatsecret-enrich.ts', () => ({
  findFatSecretMatch: vi.fn(async () => null),
  refreshFatSecretFood: vi.fn(async () => null),
  isFatSecretRowFresh: vi.fn(() => true),
}));

vi.mock('../ai/aim.ts', () => ({ runJob: vi.fn(), runJobBySlug: vi.fn() }));

let sql: (typeof import('../db/sql.ts'))['sql'];
let logMeal: (typeof import('./nutrition.ts'))['logMeal'];
let getBaselineRead: (typeof import('./nutrition.ts'))['getBaselineRead'];
let getNutritionDay: (typeof import('./nutrition.ts'))['getNutritionDay'];
let insertNutritionLog: (typeof import('../repos/nutrition.ts'))['insertNutritionLog'];
let listNutritionLogs: (typeof import('../repos/nutrition.ts'))['listNutritionLogs'];
let insertFood: (typeof import('../repos/foods.ts'))['insertFood'];
let insertGoal: (typeof import('../repos/goals.ts'))['insertGoal'];
let setMacroTargets: (typeof import('../repos/users.ts'))['setMacroTargets'];
let resetUserData: (typeof import('./dev-reset.ts'))['resetUserData'];
let runJobBySlug: ReturnType<typeof vi.fn>;

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/** YYYY-MM-DD for `daysAgo` calendar days before today (UTC). */
function daysAgo(n: number): string {
  return new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
}

async function seedLoggedDays(count: number): Promise<void> {
  for (let i = 0; i < count; i++) {
    await insertNutritionLog(USER, {
      date: daysAgo(i),
      meal: 'lunch',
      items: [{ name: `meal-day-${i}` }],
      input_method: 'text',
      raw_text: `seed day ${i}`,
      macros: { kcal: 500, protein_g: 30, source: 'user' },
      provisional: false,
    });
  }
}

d('API-04 — nutrition service (DB)', () => {
  beforeAll(async () => {
    ({ sql } = await import('../db/sql.ts'));
    ({ logMeal, getBaselineRead, getNutritionDay } = await import('./nutrition.ts'));
    ({ insertNutritionLog, listNutritionLogs } = await import('../repos/nutrition.ts'));
    ({ insertFood } = await import('../repos/foods.ts'));
    ({ insertGoal } = await import('../repos/goals.ts'));
    ({ setMacroTargets } = await import('../repos/users.ts'));
    ({ resetUserData } = await import('./dev-reset.ts'));
    ({ runJobBySlug } = (await import('../ai/aim.ts')) as unknown as {
      runJobBySlug: ReturnType<typeof vi.fn>;
    });
  });

  afterAll(async () => {
    if (resetUserData) await resetUserData(USER);
    if (sql) await sql.end({ timeout: 5 });
  });

  beforeEach(async () => {
    await resetUserData(USER);
  });

  afterEach(() => {
    runJobBySlug.mockReset();
  });

  /**
   * Keeping their words was always right; calling the result CONFIRMED was not. The owner logged
   * two photos on 2026-08-20 whose parse produced nothing — and each was stored `provisional:
   * false`, a settled meal worth zero calories, quietly dragging his day's totals down while
   * looking like data he had approved. A meal with no numbers is awaiting, never settled.
   */
  it('logMeal keeps their words when parse-meal fails — and never calls the result confirmed', async () => {
    runJobBySlug.mockResolvedValueOnce({ formatted: 'NOT_JSON{{{' });

    const row = await logMeal(USER, { text: 'oats and berries', meal: 'breakfast', date: today() });

    expect(row.raw_text).toBe('oats and berries');
    expect(row.meal).toBe('breakfast');
    expect(row.items).toEqual([]);
    expect(row.macros).toEqual({});
    // Provisional keeps it OUT of the day's totals and visibly awaiting a confirm.
    expect(row.provisional).toBe(true);
    expect(row.ai_confidence).toBeNull();

    const listed = await listNutritionLogs(USER, today(), today());
    expect(listed).toHaveLength(1);
    expect(listed[0]?.raw_text).toBe('oats and berries');
  });

  it('logMeal marks low-confidence macros provisional (< 0.5)', async () => {
    runJobBySlug.mockResolvedValueOnce({
      formatted: JSON.stringify({
        meal: 'lunch',
        items: [{ name: 'burrito' }],
        confidence: 0.3,
        est_macros: { kcal: 700, protein_g: 35, carbs_g: 80, fat_g: 25 },
      }),
    });

    const row = await logMeal(USER, { text: 'a burrito', date: today() });
    expect(row.provisional).toBe(true);
    expect(row.ai_confidence).toBe(0.3);
    expect(row.macros?.kcal).toBe(700);
    expect(row.macros?.source).toBe('ai');
    expect(row.items).toEqual([{ name: 'burrito' }]);
  });

  it('logMeal does not mark high-confidence macros provisional', async () => {
    runJobBySlug.mockResolvedValueOnce({
      formatted: JSON.stringify({
        meal: 'dinner',
        items: [{ name: 'salmon' }],
        confidence: 0.9,
        est_macros: { kcal: 450, protein_g: 40 },
      }),
    });

    const row = await logMeal(USER, { text: 'salmon', date: today() });
    expect(row.provisional).toBe(false);
    expect(row.ai_confidence).toBe(0.9);
  });

  it('logMeal with food_id is deterministic (no AI) and correlates items[].food_id', async () => {
    const food = await insertFood(USER, {
      name: 'Nonfat Greek Yogurt',
      brand: 'Fage',
      source: 'manual',
      base_unit: 'g',
      macros_per_base: { kcal: 59, protein_g: 10.3, carbs_g: 3.5, fat_g: 0 },
      servings: [
        { label: '1 container (170g)', unit: 'container', amount_g: 170 },
        { label: '100 g', unit: 'g', amount_g: 100 },
      ],
      default_serving: 0,
      confidence: 1,
    });

    const row = await logMeal(USER, {
      food_id: food.food_id,
      meal: 'breakfast',
      quantity: 1,
      date: today(),
    });

    expect(runJobBySlug).not.toHaveBeenCalled();
    expect(row.input_method).toBe('manual');
    expect(row.provisional).toBe(false);
    expect(row.items[0]?.food_id).toBe(food.food_id);
    expect(row.items[0]?.name).toBe('Nonfat Greek Yogurt');
    expect(row.macros?.kcal).toBeCloseTo(100.3, 1);
    expect(row.raw_text).toBe('Fage Nonfat Greek Yogurt');

    const usage = await sql<{ use_count: number }[]>`
      select use_count from cadence.food_usage
      where user_id = ${USER} and food_id = ${food.food_id}`;
    expect(usage[0]?.use_count).toBe(1);
  });

  it('getBaselineRead returns ready:false under 7 logged days and never calls the LLM', async () => {
    await seedLoggedDays(3);

    const result = await getBaselineRead(USER);

    expect(result).toEqual({ ready: false, days_logged: 3, days_needed: 7 });
    expect(runJobBySlug).not.toHaveBeenCalled();
  });

  it('getBaselineRead proposes targets only when wantsTargets and none are set', async () => {
    await seedLoggedDays(7);
    await insertGoal(USER, {
      title: 'Eat more protein',
      area: 'nourishment',
      type: 'milestone',
      status: 'confirmed',
      measure: { metric: 'protein', target: 140, unit: 'g' },
      timeframe: {},
      source: 'manual',
    });

    runJobBySlug.mockResolvedValueOnce({
      formatted: JSON.stringify({
        read: 'You usually skip breakfast.',
        suggestion: 'Add protein at the first meal.',
        rationale: 'Seven days of sparse mornings.',
        proposed_targets: { kcal: 2200, protein_g: 140, carbs_g: 220, fat_g: 70 },
        targets_rationale: 'Anchored to your logged volume.',
      }),
    });

    const result = await getBaselineRead(USER);
    expect(result.ready).toBe(true);
    if (!result.ready) throw new Error('expected ready');
    expect(result.proposed_targets?.kcal).toBe(2200);
    expect(result.targets_rationale).toBeTruthy();

    expect(runJobBySlug).toHaveBeenCalledTimes(1);
    const vars = runJobBySlug.mock.calls[0]?.[2] as { propose_targets?: string };
    expect(vars.propose_targets).toBe('yes');
  });

  it('getBaselineRead skips proposing when targets already exist (Settings owns edits)', async () => {
    await seedLoggedDays(7);
    await insertGoal(USER, {
      title: 'Eat more protein',
      area: 'nourishment',
      type: 'milestone',
      status: 'confirmed',
      measure: { metric: 'protein', target: 140, unit: 'g' },
      timeframe: {},
      source: 'manual',
    });
    await setMacroTargets(USER, { kcal: 2000, protein_g: 120 });

    runJobBySlug.mockResolvedValueOnce({
      formatted: JSON.stringify({
        read: 'Steady logging.',
        suggestion: 'Keep the midday protein habit.',
        rationale: 'Already on targets.',
        proposed_targets: { kcal: 9999, protein_g: 200 },
        targets_rationale: 'should be discarded',
      }),
    });

    const result = await getBaselineRead(USER);
    expect(result.ready).toBe(true);
    if (!result.ready) throw new Error('expected ready');
    expect(result.proposed_targets).toBeNull();
    expect(result.targets_rationale).toBeNull();

    const vars = runJobBySlug.mock.calls[0]?.[2] as { propose_targets?: string };
    expect(vars.propose_targets).toBe('no');
  });

  it('getBaselineRead skips proposing when no eating/weight goal warrants targets', async () => {
    await seedLoggedDays(7);
    await insertGoal(USER, {
      title: 'Run a 5k',
      area: 'movement',
      type: 'target',
      status: 'confirmed',
      measure: { metric: 'distance', target: 5, unit: 'km' },
      timeframe: {},
      source: 'manual',
    });

    runJobBySlug.mockResolvedValueOnce({
      formatted: JSON.stringify({
        read: 'Movement-first week.',
        suggestion: 'Keep the easy runs.',
        rationale: 'No nutrition goal.',
        proposed_targets: { kcal: 2200, protein_g: 140 },
        targets_rationale: 'should be discarded',
      }),
    });

    const result = await getBaselineRead(USER);
    expect(result.ready).toBe(true);
    if (!result.ready) throw new Error('expected ready');
    expect(result.proposed_targets).toBeNull();

    const vars = runJobBySlug.mock.calls[0]?.[2] as { propose_targets?: string };
    expect(vars.propose_targets).toBe('no');
  });

  /**
   * `has_recent_food` is the strip's gate: the trail door must survive a target-less logger
   * (device report 2026-08-15 — the door was gated on the thing the door leads to), and must
   * stay closed for someone whose food is truly idle, so a mind-only user never grows a strip.
   */
  it('getNutritionDay reports has_recent_food=false for a user with no food at all', async () => {
    const day = await getNutritionDay(USER, today());
    expect(day.has_recent_food).toBe(false);
    expect(day.targets_wait).toBeNull();
  });

  it('getNutritionDay reports has_recent_food=true from an old log, with nothing today', async () => {
    await insertNutritionLog(USER, {
      date: daysAgo(3),
      meal: 'dinner',
      items: [{ name: 'stew' }],
      input_method: 'text',
      raw_text: 'stew',
      macros: { kcal: 480, source: 'user' },
      provisional: false,
    });

    const day = await getNutritionDay(USER, today());
    expect(day.meals).toHaveLength(0); // nothing today — the 14-day window is what says "active"
    expect(day.has_recent_food).toBe(true);
  });

  it('getNutritionDay reports has_recent_food=true when targets are set, even with no logs', async () => {
    await setMacroTargets(USER, { kcal: 2100, protein_g: 140 });

    const day = await getNutritionDay(USER, today());
    expect(day.has_recent_food).toBe(true);
  });

  /** Water (0037): pours sum into the day, and zero rows read as an honest 0 — never an absence. */
  it('logWater sums pours into the day, and the day carries water_ml', async () => {
    const { logWater } = await import('./water.ts');
    expect((await getNutritionDay(USER, today())).water_ml).toBe(0);

    await logWater(USER, 250);
    const r = await logWater(USER, 500);
    expect(r.water_ml).toBe(750);
    expect((await getNutritionDay(USER, today())).water_ml).toBe(750);
  });
});
