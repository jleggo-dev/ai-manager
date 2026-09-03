/**
 * P3 SWEEP-SERVER — the pending rail, commit and retro tidy (S3/S4) against a real Cadence
 * Postgres, with the AI seam (`ai/aim.ts`) fully mocked (the plan-commit.test.ts pattern).
 *
 * The sweep's NEVER list lives here as tests, not comments: never saves without asking, never
 * proposes more than three, never a set seen once (pinned in food-sweep-detect.test.ts), never a
 * changed logged number, never a silent regroup of a meal the user already bracketed.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import type { FoodSweepProposal, MealItem, MealKind, NutritionLog } from '@cadence/shared';
import { testUserId } from './test-user.ts';

dotenv.config({ path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../.env') });
const HAS_DB = !!(process.env.CADENCE_DATABASE_URL || process.env.CADENCE_DB_PASSWORD);
const d = HAS_DB ? describe : describe.skip;

const USER = testUserId('f5d2');

// Fully replace the AI seam: no live model call, no @ai-admin/core load.
vi.mock('../ai/aim.ts', () => ({ runJob: vi.fn(), runJobBySlug: vi.fn() }));

// Lazily-bound module refs (populated in beforeAll so a no-DB env skips without importing config).
let sql: (typeof import('../db/sql.ts'))['sql'];
let insertNutritionLog: (typeof import('../repos/nutrition.ts'))['insertNutritionLog'];
let getSweepLog: (typeof import('../repos/nutrition-sweep.ts'))['getSweepLog'];
let writeLogPartsAndItems: (typeof import('../repos/nutrition-sweep.ts'))['writeLogPartsAndItems'];
let getUser: (typeof import('../repos/users.ts'))['getUser'];
let setPendingFoodSweep: (typeof import('../repos/users.ts'))['setPendingFoodSweep'];
let listRecipes: (typeof import('../repos/recipes.ts'))['listRecipes'];
let sweepIfDue: (typeof import('./food-sweep.ts'))['sweepIfDue'];
let commitSweep: (typeof import('./food-sweep.ts'))['commitSweep'];
let dismissSweep: (typeof import('./food-sweep.ts'))['dismissSweep'];
let readFoodSweep: (typeof import('./food-sweep.ts'))['readFoodSweep'];
let tidyApply: (typeof import('./food-sweep-tidy.ts'))['tidyApply'];
let tidyRevert: (typeof import('./food-sweep-tidy.ts'))['tidyRevert'];
let resetUserData: (typeof import('./dev-reset.ts'))['resetUserData'];
let runJobBySlug: ReturnType<typeof vi.fn>;

const iso = (daysAgo: number): string => new Date(Date.now() - daysAgo * 86_400_000).toISOString().slice(0, 10);

function item(foodId: string, name: string, kcal: number): MealItem {
  return { name, qty: 1, unit: 'serving', food_id: foodId, est: { kcal, protein_g: 3 } };
}

const OATS = item('zzq-food-oats', 'oats', 150);
const CHIA = item('zzq-food-chia', 'chia seeds', 50);
const BERRIES = item('zzq-food-berries', 'blueberries', 80);
const COFFEE = item('zzq-food-coffee', 'coffee', 5);

async function seedMeal(daysAgo: number, meal: MealKind, items: MealItem[], rawText: string | null = null) {
  return insertNutritionLog(USER, {
    date: iso(daysAgo),
    meal,
    items,
    input_method: 'text',
    raw_text: rawText,
    macros: { kcal: items.reduce((n, i) => n + (i.est?.kcal ?? 0), 0) },
  });
}

/** The standard fixture: a three-day breakfast set, one day carrying a loose extra coffee. */
async function seedBreakfastSet(): Promise<NutritionLog[]> {
  return [
    await seedMeal(1, 'breakfast', [OATS, CHIA, BERRIES], 'my chia bowl'),
    await seedMeal(2, 'breakfast', [OATS, CHIA, BERRIES], 'chia bowl'),
    await seedMeal(3, 'breakfast', [OATS, CHIA, BERRIES, COFFEE], 'chia bowl and coffee'),
  ];
}

/** Answer every candidate the job is shown with keep:true — the "eager model" fixture. */
function primeModelKeepAll(name = 'Chia bowl', yieldServings = 1): void {
  runJobBySlug.mockImplementation(async (_userId: string, _slug: string, vars: Record<string, unknown>) => {
    const candidates = JSON.parse(String(vars.candidates)) as { candidate_id: string }[];
    return {
      formatted: JSON.stringify({
        proposals: candidates.map((c) => ({
          candidate_id: c.candidate_id,
          keep: true,
          name,
          yield_servings: yieldServings,
          reason: 'seen repeatedly',
          line: 'Three mornings, always these together.',
        })),
      }),
    };
  });
}

/** A hand-built pending sweep pointing at real seeded logs — commit/tidy fixtures. */
function proposal(id: string, logs: NutritionLog[], yieldServings: number): FoodSweepProposal {
  return {
    id,
    yield_servings: yieldServings,
    name: 'Chia bowl',
    members: [OATS, CHIA, BERRIES].map((m) => ({ food_id: m.food_id!, name: m.name, qty: m.qty!, unit: m.unit! })),
    seen_count: logs.length,
    slot: 'breakfast',
    line: 'Three mornings, always these together.',
    macros_per_serving: { kcal: 280 },
    tidy_log_ids: logs.map((l) => l.log_id),
  };
}

d('food-sweep rail (S3) + retro tidy (S4)', () => {
  beforeAll(async () => {
    ({ sql } = await import('../db/sql.ts'));
    ({ insertNutritionLog } = await import('../repos/nutrition.ts'));
    ({ getSweepLog, writeLogPartsAndItems } = await import('../repos/nutrition-sweep.ts'));
    ({ getUser, setPendingFoodSweep } = await import('../repos/users.ts'));
    ({ listRecipes } = await import('../repos/recipes.ts'));
    ({ sweepIfDue, commitSweep, dismissSweep, readFoodSweep } = await import('./food-sweep.ts'));
    ({ tidyApply, tidyRevert } = await import('./food-sweep-tidy.ts'));
    ({ resetUserData } = await import('./dev-reset.ts'));
    ({ runJobBySlug } = (await import('../ai/aim.ts')) as unknown as { runJobBySlug: ReturnType<typeof vi.fn> });
  });

  afterAll(async () => {
    if (resetUserData) await resetUserData(USER);
    if (sql) await sql.end({ timeout: 5 });
  });

  beforeEach(async () => {
    await resetUserData(USER);
    // dev-reset predates the sweep columns — clear them here so each test starts unswept.
    await sql`update cadence.users set pending_food_sweep = null, last_food_sweep_at = null where id = ${USER}`;
    runJobBySlug.mockReset();
  });

  /** The gate is Sunday-anchored: first sight only arms it, and it opens once the stamp predates
   *  the most recent Sunday. Nine days back is before the most recent Sunday on every weekday, so
   *  these tests stay deterministic whatever real day they run on. */
  const armLastWeek = () =>
    sql`update cadence.users set last_food_sweep_at = now() - interval '9 days' where id = ${USER}`;

  it('first sight arms the gate: stamp set, no detection, no model, no ask', async () => {
    await seedBreakfastSet(); // even with a findable set, the first read must not sweep
    await sweepIfDue(USER);
    const user = await getUser(USER);
    expect(user?.last_food_sweep_at).toBeTruthy();
    expect(user?.pending_food_sweep ?? null).toBeNull();
    expect(runJobBySlug).not.toHaveBeenCalled();
  });

  it('a stamp inside the current Sunday-week does not sweep again', async () => {
    await seedBreakfastSet();
    primeModelKeepAll();
    await sql`update cadence.users set last_food_sweep_at = now() where id = ${USER}`;
    await sweepIfDue(USER);
    expect(runJobBySlug).not.toHaveBeenCalled();
  });

  describe("mostRecentSundayIso — the Sunday anchor, in the user's own timezone", () => {
    it('walks a mid-week date back to its Sunday, and a Sunday to itself', async () => {
      const { mostRecentSundayIso } = await import('./food-sweep.ts');
      expect(mostRecentSundayIso(new Date('2026-09-02T12:00:00Z'), 'UTC')).toBe('2026-08-30'); // Wed
      expect(mostRecentSundayIso(new Date('2026-08-30T00:00:01Z'), 'UTC')).toBe('2026-08-30'); // Sun itself
    });

    it('anchors to the LOCAL Sunday: late Saturday UTC is already Sunday in Auckland', async () => {
      const { mostRecentSundayIso } = await import('./food-sweep.ts');
      const lateSatUtc = new Date('2026-08-29T23:30:00Z');
      expect(mostRecentSundayIso(lateSatUtc, 'UTC')).toBe('2026-08-23');
      expect(mostRecentSundayIso(lateSatUtc, 'Pacific/Auckland')).toBe('2026-08-30');
    });

    it('falls back to UTC on a broken timezone rather than failing the day read', async () => {
      const { mostRecentSundayIso } = await import('./food-sweep.ts');
      expect(mostRecentSundayIso(new Date('2026-09-02T12:00:00Z'), 'Not/A_Zone')).toBe('2026-08-30');
    });
  });

  it('nothing to find: stamps the gate and never calls the model', async () => {
    await armLastWeek();
    await sweepIfDue(USER);
    const user = await getUser(USER);
    expect(user?.last_food_sweep_at).toBeTruthy();
    expect(user?.pending_food_sweep ?? null).toBeNull();
    expect(runJobBySlug).not.toHaveBeenCalled();
  });

  it('builds proposals from the model keeps — numbers from the candidate, name from the model', async () => {
    await seedBreakfastSet();
    await armLastWeek();
    primeModelKeepAll('Chia bowl', 1);
    await sweepIfDue(USER);

    expect(runJobBySlug).toHaveBeenCalledTimes(1);
    const [, slug, vars] = runJobBySlug.mock.calls[0] as [string, string, Record<string, unknown>];
    expect(slug).toBe('sweep-food-recipes');
    // The model sees names, counts and the user's words — never log ids or food ids.
    const shown = JSON.parse(String(vars.candidates)) as Record<string, unknown>[];
    expect(shown[0]).not.toHaveProperty('tidy_log_ids');
    expect(shown[0]).not.toHaveProperty('macros_per_serving');
    expect(shown[0]!.raw_fragments).toContain('chia bowl');

    const sweep = await readFoodSweep(USER);
    expect(sweep?.proposals).toHaveLength(1);
    const p = sweep!.proposals[0]!;
    expect(p.name).toBe('Chia bowl');
    expect(p.seen_count).toBe(3);
    expect(p.macros_per_serving.kcal).toBe(280);
    expect(p.tidy_log_ids).toHaveLength(3);
    // Proposing saved NOTHING — a proposal is an ask, not an act.
    expect(await listRecipes(USER)).toHaveLength(0);
  });

  it('one sweep per Sunday-week: a second call after the sweep does not run again', async () => {
    await seedBreakfastSet();
    await armLastWeek();
    primeModelKeepAll();
    await sweepIfDue(USER);
    await commitSweep(USER, []); // decline everything so no ask is outstanding
    runJobBySlug.mockClear();
    await sweepIfDue(USER);
    expect(runJobBySlug).not.toHaveBeenCalled();
  });

  it('waits for the user while an ask is outstanding, even once the gate is stale', async () => {
    await seedBreakfastSet();
    await armLastWeek();
    primeModelKeepAll();
    await sweepIfDue(USER);
    await sql`update cadence.users set last_food_sweep_at = now() - interval '9 days' where id = ${USER}`;
    runJobBySlug.mockClear();
    await sweepIfDue(USER);
    expect(runJobBySlug).not.toHaveBeenCalled();
    expect((await readFoodSweep(USER))?.proposals).toHaveLength(1); // the original ask, untouched
  });

  it('unusable model output: stamps the throttle, proposes nothing, saves nothing', async () => {
    await seedBreakfastSet();
    await armLastWeek();
    runJobBySlug.mockResolvedValue({ formatted: 'not json at all' });
    await sweepIfDue(USER);
    expect((await getUser(USER))?.last_food_sweep_at).toBeTruthy();
    expect(await readFoodSweep(USER)).toBeNull();
    expect(await listRecipes(USER)).toHaveLength(0);
  });

  it('never more than three proposals, however many the model keeps', async () => {
    await armLastWeek();
    // Four distinct three-day sets, one per slot — four candidates reach the model.
    const slots: MealKind[] = ['breakfast', 'lunch', 'dinner', 'snack'];
    for (const [i, slot] of slots.entries()) {
      for (const daysAgo of [1, 2, 3]) {
        await seedMeal(daysAgo, slot, [item(`zzq-a${i}`, `food a${i}`, 100), item(`zzq-b${i}`, `food b${i}`, 100)]);
      }
    }
    primeModelKeepAll();
    await sweepIfDue(USER);
    const sweep = await readFoodSweep(USER);
    expect(sweep?.proposals).toHaveLength(3);
  });

  it('commit saves the accepted recipes with their yield; declined ones are simply not saved', async () => {
    const logs = await seedBreakfastSet();
    const other = await seedMeal(4, 'dinner', [item('zzq-x', 'stew', 300), item('zzq-y', 'rice', 200)]);
    await setPendingFoodSweep(USER, {
      built_at: new Date().toISOString(),
      proposals: [proposal('c1', logs, 4), { ...proposal('c2', [other], 1), name: 'Stew night' }],
    });

    const out = await commitSweep(USER, ['c1']);
    expect(out.saved).toHaveLength(1);
    expect(out.saved[0]).toMatchObject({ name: 'Chia bowl', servings: 4, source: 'ai', saved: true });
    expect(out.saved[0]!.ingredients.map((i) => i.food_id).sort()).toEqual(
      [OATS.food_id, CHIA.food_id, BERRIES.food_id].sort() as string[],
    );
    expect(out.saved[0]!.macros_per_serving.kcal).toBe(280);
    expect(out.tidy).toEqual([{ proposal_id: 'c1', log_count: 3 }]);
    // The ask is answered: the card is gone, and the declined proposal saved nothing.
    expect(await readFoodSweep(USER)).toBeNull();
    expect(await listRecipes(USER)).toHaveLength(1);
  });

  it('dismiss clears the ask, stamps the throttle, saves nothing', async () => {
    const logs = await seedBreakfastSet();
    await setPendingFoodSweep(USER, { built_at: new Date().toISOString(), proposals: [proposal('c1', logs, 1)] });
    await dismissSweep(USER);
    expect(await readFoodSweep(USER)).toBeNull();
    expect((await getUser(USER))?.last_food_sweep_at).toBeTruthy();
    expect(await listRecipes(USER)).toHaveLength(0);
  });

  it('tidy brackets matching logs, keeps extras loose, and changes no numbers', async () => {
    const logs = await seedBreakfastSet();
    await setPendingFoodSweep(USER, { built_at: new Date().toISOString(), proposals: [proposal('c1', logs, 4)] });
    const { saved } = await commitSweep(USER, ['c1']);
    const before = await Promise.all(logs.map((l) => getSweepLog(USER, l.log_id)));

    expect(await tidyApply(USER, ['c1'])).toEqual({ tidied: 3 });

    for (const [i, l] of logs.entries()) {
      const after = (await getSweepLog(USER, l.log_id))!;
      // One sweep part, pointing at the saved recipe, marked reversible.
      expect(after.parts).toHaveLength(1);
      expect(after.parts[0]).toMatchObject({
        name: 'Chia bowl',
        recipe_id: saved[0]!.recipe_id,
        yield_servings: 4,
        servings_logged: 1,
        source: 'sweep',
      });
      // Members joined the bracket; anything else stayed loose.
      for (const it2 of after.items) {
        if (it2.food_id === COFFEE.food_id) expect(it2.part).toBeUndefined();
        else expect(it2.part).toBe(after.parts[0]!.key);
      }
      // The NEVER that matters most: identical macros, identical per-item est.
      expect(after.macros).toEqual(before[i]!.macros);
      expect(after.items.map((x) => x.est)).toEqual(before[i]!.items.map((x) => x.est));
    }
    // Calling it again re-brackets nothing.
    expect(await tidyApply(USER, ['c1'])).toEqual({ tidied: 0 });
  });

  it('tidy leaves a log the user already bracketed alone', async () => {
    const logs = await seedBreakfastSet();
    // The user grouped day 2 themselves — their bracket, their meal.
    const theirs = (await getSweepLog(USER, logs[1]!.log_id))!;
    await writeLogPartsAndItems(
      USER,
      theirs.log_id,
      [{ key: 'mine', name: 'my bowl', source: 'user' }],
      theirs.items.map((x) => ({ ...x, part: 'mine' })),
    );
    await setPendingFoodSweep(USER, { built_at: new Date().toISOString(), proposals: [proposal('c1', logs, 1)] });
    await commitSweep(USER, ['c1']);

    expect(await tidyApply(USER, ['c1'])).toEqual({ tidied: 2 });
    const untouched = (await getSweepLog(USER, theirs.log_id))!;
    expect(untouched.parts).toEqual([{ key: 'mine', name: 'my bowl', source: 'user' }]);
  });

  it('revert removes exactly the sweep parts — user parts and their refs stay', async () => {
    const logs = await seedBreakfastSet();
    await setPendingFoodSweep(USER, { built_at: new Date().toISOString(), proposals: [proposal('c1', logs, 1)] });
    await commitSweep(USER, ['c1']);
    await tidyApply(USER, ['c1']);
    // The user then brackets the loose coffee on day 3 themselves (data-level fixture).
    const day3 = (await getSweepLog(USER, logs[2]!.log_id))!;
    await writeLogPartsAndItems(
      USER,
      day3.log_id,
      [...day3.parts, { key: 'mine', name: 'my coffee', source: 'user' }],
      day3.items.map((x) => (x.food_id === COFFEE.food_id ? { ...x, part: 'mine' } : x)),
    );

    expect(await tidyRevert(USER)).toEqual({ reverted: 3 });
    for (const l of logs) {
      const after = (await getSweepLog(USER, l.log_id))!;
      expect(after.parts.filter((p) => p.source === 'sweep')).toHaveLength(0);
      for (const x of after.items) {
        if (x.food_id === COFFEE.food_id && l.log_id === day3.log_id) expect(x.part).toBe('mine');
        else expect(x.part).toBeUndefined();
      }
    }
    const day3After = (await getSweepLog(USER, day3.log_id))!;
    expect(day3After.parts).toEqual([{ key: 'mine', name: 'my coffee', source: 'user' }]);
  });
});
