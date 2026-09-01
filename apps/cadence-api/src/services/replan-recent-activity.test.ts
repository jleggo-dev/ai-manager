/**
 * What the re-planner is TOLD about how the person has been doing — `recent_activity`, which
 * gatherReplanInputs builds and both re-plan paths JSON-stringify straight into the prompt.
 *
 * The counts used to be read off the status column directly, and they lied in both directions:
 * nothing in the app ever writes status 'missed', so the one counter whose job is to say "this week
 * was too heavy" was structurally zero; and `scheduled`/`done` included the food log's per-meal
 * system rows, up to 56 of them in a 14-day window. A person who no-showed 12 of 14 sessions
 * reached the planning model as done 2 / missed 0 / scheduled 14, and PLAN_COUNTS_NOTE told it to
 * read those as plan engagement — so it read the zero as fact.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Goal } from '@cadence/shared';

const listGoalsByStatus = vi.fn();
const getUser = vi.fn();
const listEquipment = vi.fn();
const getActivePlan = vi.fn();
const listActivities = vi.fn();
const listOccurrences = vi.fn();
const listNutritionLogs = vi.fn();
const observedHealthForPlanning = vi.fn();

vi.mock('../repos/goals.ts', () => ({ listGoalsByStatus: (...a: unknown[]) => listGoalsByStatus(...a) }));
vi.mock('../repos/users.ts', () => ({
  getUser: (...a: unknown[]) => getUser(...a),
  setPendingPlan: vi.fn(async () => {}),
  setPendingProposal: vi.fn(async () => {}),
}));
vi.mock('../repos/equipment.ts', () => ({ listEquipment: (...a: unknown[]) => listEquipment(...a) }));
vi.mock('../repos/plans.ts', () => ({ getActivePlan: (...a: unknown[]) => getActivePlan(...a) }));
vi.mock('../repos/activities.ts', () => ({ listActivities: (...a: unknown[]) => listActivities(...a) }));
vi.mock('../repos/occurrences.ts', () => ({ listOccurrences: (...a: unknown[]) => listOccurrences(...a) }));
vi.mock('../repos/nutrition.ts', () => ({ listNutritionLogs: (...a: unknown[]) => listNutritionLogs(...a) }));
vi.mock('./observed-health.ts', () => ({
  observedHealthForPlanning: (...a: unknown[]) => observedHealthForPlanning(...a),
  PLAN_COUNTS_NOTE: 'counts note',
}));
vi.mock('./plan-ready-push.ts', () => ({ sendPlanReadyPush: vi.fn(async () => {}) }));
vi.mock('./plan-evolve.ts', () => ({ planEvolve: vi.fn() }));
vi.mock('./plan-fanout.ts', () => ({ planSynthesize: vi.fn(), planSynthesizeVetCommit: vi.fn() }));
vi.mock('./plan-synthesis.ts', () => ({ commitActivities: vi.fn() }));
vi.mock('./plan-partial-apply.ts', () => ({ resolveToggledActivities: vi.fn() }));
vi.mock('./plan-commit-flow.ts', () => ({ confirmPendingPlan: vi.fn() }));

const { gatherReplanInputs } = await import('./replan.ts');

const USER = '00000000-0000-4000-a000-00000000e703';
const GOAL = { goal_id: 'g1', title: 'Run a 10k', area: 'movement', type: 'milestone', status: 'committed' } as Goal;

/** Wednesday 2026-07-15 — the 14-day window is 2026-07-02 … 2026-07-15. */
const TODAY = '2026-07-15';
const day = (n: number) => `2026-07-${String(n).padStart(2, '0')}`;

const counts = async () =>
  (await gatherReplanInputs(USER))!.recentActivity as {
    done: number;
    skipped: number;
    missed: number;
    scheduled: number;
  };

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date(`${TODAY}T12:00:00.000Z`));
  listGoalsByStatus.mockResolvedValue([GOAL]);
  getUser.mockResolvedValue({ user_id: USER, baseline: {} });
  listEquipment.mockResolvedValue([]);
  listActivities.mockResolvedValue([]);
  getActivePlan.mockResolvedValue({ plan_id: 'p1', version: 3 });
  listNutritionLogs.mockResolvedValue([]);
  observedHealthForPlanning.mockResolvedValue(null);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('recent_activity — plan-engagement counts', () => {
  it('a past-due pending session is a MISS, not a silence', async () => {
    // 14 scheduled sessions, 2 done, the other 12 past-due and never touched.
    listOccurrences.mockResolvedValue([
      ...Array.from({ length: 12 }, (_, i) => ({ date: day(2 + i), kind: 'user', status: 'pending' })),
      { date: day(14), kind: 'user', status: 'done' },
      { date: day(15), kind: 'user', status: 'done' },
    ]);

    expect(await counts()).toMatchObject({ done: 2, skipped: 0, missed: 12, scheduled: 14 });
  });

  it("today's still-open session is not held against them", async () => {
    listOccurrences.mockResolvedValue([{ date: TODAY, kind: 'user', status: 'pending' }]);

    expect(await counts()).toMatchObject({ missed: 0, scheduled: 1 });
  });

  it('untapped meal cards are neither missed sessions nor scheduled ones', async () => {
    const meals = ['Breakfast', 'Lunch', 'Snack', 'Dinner'];
    listOccurrences.mockResolvedValue([
      // 13 past days × 4 per-meal system tasks, all untapped — 52 rows of noise.
      ...Array.from({ length: 13 }, (_, i) => day(2 + i)).flatMap((date) =>
        meals.map(() => ({ date, kind: 'system', status: 'pending' })),
      ),
      { date: day(10), kind: 'system', status: 'done' }, // a tapped weigh-in is still not a session
      { date: day(13), kind: 'user', status: 'done' },
      { date: day(14), kind: 'user', status: 'skipped' },
    ]);

    expect(await counts()).toMatchObject({ done: 1, skipped: 1, missed: 0, scheduled: 2 });
  });
});
