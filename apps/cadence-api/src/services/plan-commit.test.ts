/**
 * API-01 — integration tests for the plan-commit pipeline (the choke point every plan change
 * flows through: first lock, manual re-plan, weekly-proposal accept). Previously zero-tested.
 *
 * These run against a REAL Cadence Postgres (the §6 lightweight harness: a dedicated test user,
 * wiped with the existing dev-reset machinery between tests). They mock only the AI seam
 * (`ai/aim.ts` → the LLM) so they're deterministic and never make a live model call — and so the
 * cadence CI job never has to load `@ai-admin/core` (which needs AI-Manager secrets the cadence
 * job deliberately doesn't get). The DB transaction itself is exercised for real.
 *
 * Skips cleanly when no Cadence DB is configured (e.g. a CI run without CADENCE_* secrets):
 * the guard + lazy imports mean config.ts never throws at import in that case.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import type { PendingPlanActivity } from '@cadence/shared';

// Load apps/cadence-api/.env by absolute path (independent of cwd) so the DB check below is
// correct locally; in CI with no .env file this is a no-op and the check reads the job's env.
dotenv.config({ path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../.env') });

const HAS_DB = !!(process.env.CADENCE_DATABASE_URL || process.env.CADENCE_DB_PASSWORD);
const d = HAS_DB ? describe : describe.skip;

// A dedicated, obviously-synthetic test user — isolated from the dev demo accounts.
const USER = '00000000-0000-4000-a000-00000000a101';

// Fully replace the AI seam: no live LLM, no @ai-admin/core load. Flow tests drive `runJob`'s
// return value per-test; the direct commitActivities tests never call it.
vi.mock('../ai/aim.ts', () => ({ runJob: vi.fn(), runJobBySlug: vi.fn() }));
// Wrap insertActivities so a test can force it to reject mid-transaction (the atomicity case);
// by default it runs the real insert.
vi.mock('../repos/activities.ts', async (orig) => {
  const actual = await orig<typeof import('../repos/activities.ts')>();
  return { ...actual, insertActivities: vi.fn(actual.insertActivities) };
});

// Lazily-bound module refs (populated in beforeAll so a no-DB env skips without importing config).
let sql: (typeof import('../db/sql.ts'))['sql'];
let commitActivities: (typeof import('./plan-synthesis.ts'))['commitActivities'];
let normalizeActivity: (typeof import('./plan-synthesis.ts'))['normalizeActivity'];
let confirmLock: (typeof import('./lock.ts'))['confirmLock'];
let getActivePlan: (typeof import('../repos/plans.ts'))['getActivePlan'];
let listActivities: (typeof import('../repos/activities.ts'))['listActivities'];
let insertActivities: (typeof import('../repos/activities.ts'))['insertActivities'];
let getGoal: (typeof import('../repos/goals.ts'))['getGoal'];
let insertGoal: (typeof import('../repos/goals.ts'))['insertGoal'];
let resetUserData: (typeof import('./dev-reset.ts'))['resetUserData'];
let runJobBySlug: ReturnType<typeof vi.fn>;

/** Build N minimal, valid pending activities (recurrence yields occurrences within the horizon). */
function acts(goalId: string, n = 2): PendingPlanActivity[] {
  return Array.from({ length: n }, (_, i) => ({
    title: `Easy run ${i + 1}`,
    kind: 'user',
    cadence: 'weekly',
    recurrence: 'FREQ=WEEKLY;BYDAY=MO,WE,FR',
    time_of_day: '06:30',
    completion_source: 'self_report',
    goal_id: goalId,
  }));
}

/** Canned synthesize_plan + plan_vet responses; `verified` toggles the veto path. */
function primeRunJob(goalTitle: string, verified: boolean) {
  runJobBySlug.mockImplementation(async (_userId: string, slug: string) => {
    if (slug === 'synthesize-plan') {
      return {
        formatted: JSON.stringify({
          activities: [
            {
              title: 'Easy run',
              kind: 'user',
              schedule: { recurrence: 'FREQ=WEEKLY;BYDAY=MO,WE,FR', time_of_day: '06:30' },
              completion_source: 'self_report',
              goal_title: goalTitle,
              why: 'builds your aerobic base',
            },
          ],
          note: 'A gentle start.',
        }),
      };
    }
    if (slug === 'plan-vet') {
      return {
        formatted: JSON.stringify(
          verified ? { verified: true, valid: true } : { verified: false, violations: ['unrealistic'] },
        ),
      };
    }
    return { formatted: '{}' };
  });
}

async function seedGoal(title = 'Run a 5k'): Promise<string> {
  const g = await insertGoal(USER, {
    title,
    area: 'movement',
    type: 'target',
    status: 'confirmed',
    measure: { metric: 'distance', target: 5, unit: 'km' },
    timeframe: {},
    linked_equipment: [],
    source: 'manual',
  });
  return g.goal_id;
}

d('API-01 — plan commit pipeline', () => {
  beforeAll(async () => {
    ({ sql } = await import('../db/sql.ts'));
    ({ commitActivities, normalizeActivity } = await import('./plan-synthesis.ts'));
    ({ confirmLock } = await import('./lock.ts'));
    ({ getActivePlan } = await import('../repos/plans.ts'));
    ({ listActivities, insertActivities } = await import('../repos/activities.ts'));
    ({ getGoal, insertGoal } = await import('../repos/goals.ts'));
    ({ resetUserData } = await import('./dev-reset.ts'));
    ({ runJobBySlug } = (await import('../ai/aim.ts')) as unknown as { runJobBySlug: ReturnType<typeof vi.fn> });
  });

  afterAll(async () => {
    if (resetUserData) await resetUserData(USER);
    if (sql) await sql.end({ timeout: 5 });
  });

  beforeEach(async () => {
    await resetUserData(USER);
  });

  afterEach(() => {
    // insertActivities' one-shot mockRejectedValueOnce self-clears after firing, so its default
    // (the real insert) resumes on its own. Only runJob's per-test implementation needs clearing.
    runJobBySlug.mockReset();
  });

  it('normalizeActivity coerces kind/completion_source and derives a recurrence', () => {
    const out = normalizeActivity({
      kind: 'nonsense' as never,
      completion_source: 'bogus' as never,
      schedule: { time_of_day: '06:30' } as never,
    });
    expect(out.kind).toBe('user');
    expect(out.completion_source).toBe('self_report');
    expect(typeof out.schedule?.recurrence).toBe('string');
  });

  it('commits a first plan (v1) with its activities and materializes occurrences', async () => {
    const goalId = await seedGoal();
    const r = await commitActivities(USER, { activities: acts(goalId, 2), note: 'first', goalIds: [goalId] });
    expect(r.status).toBe('committed');
    expect(r.version).toBe(1);
    expect(r.occurrences).toBeGreaterThan(0);

    const active = await getActivePlan(USER);
    expect(active?.version).toBe(1);
    expect((await listActivities(active!.plan_id)).length).toBe(2);
  });

  it('a second commit supersedes v1 and makes v2 the only active plan', async () => {
    const goalId = await seedGoal();
    await commitActivities(USER, { activities: acts(goalId, 2), note: 'v1', goalIds: [goalId] });
    const v1 = await getActivePlan(USER);

    const r2 = await commitActivities(USER, { activities: acts(goalId, 1), note: 'v2', goalIds: [goalId] });
    expect(r2.version).toBe(2);

    const active = await getActivePlan(USER);
    expect(active?.version).toBe(2);
    expect(active?.plan_id).not.toBe(v1?.plan_id);
  });

  it('rolls back a mid-flight failure — the prior active plan survives (THE API-01 fix)', async () => {
    const goalId = await seedGoal();
    await commitActivities(USER, { activities: acts(goalId, 2), note: 'v1', goalIds: [goalId] });
    const v1 = await getActivePlan(USER);

    // Crash during activity insert, after supersede + insertPlan have run inside the transaction.
    vi.mocked(insertActivities).mockRejectedValueOnce(new Error('boom'));
    await expect(
      commitActivities(USER, { activities: acts(goalId, 2), note: 'v2', goalIds: [goalId] }),
    ).rejects.toThrow();

    // Pre-fix, supersede would have committed on its own, leaving the user with NO active plan.
    // With sql.begin(), the whole set rolled back: v1 is still active, unchanged.
    const active = await getActivePlan(USER);
    expect(active?.plan_id).toBe(v1?.plan_id);
    expect(active?.version).toBe(1);
  });

  it('confirmLock commits through the shared skeleton and flips the goal → committed', async () => {
    const goalId = await seedGoal();
    primeRunJob('Run a 5k', true);

    const r = await confirmLock(USER);
    expect(r.status).toBe('committed');
    expect(await getActivePlan(USER)).toBeTruthy();
    expect((await getGoal(USER, goalId))?.status).toBe('committed');
  });

  it('a vetoed plan leaves the DB untouched — no plan, goal stays confirmed', async () => {
    const goalId = await seedGoal();
    primeRunJob('Run a 5k', false);

    const r = await confirmLock(USER);
    expect(r.status).toBe('vetoed');
    expect(await getActivePlan(USER)).toBeNull();
    expect((await getGoal(USER, goalId))?.status).toBe('confirmed');
  });
});
