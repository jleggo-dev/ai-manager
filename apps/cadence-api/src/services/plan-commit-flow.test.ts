/**
 * `confirmPendingPlan` is the single commit funnel first-lock (services/lock.ts), the manual
 * re-plan (services/replan.ts), and applying a `propose_plan_change` edit (via the same
 * `/plan/lock` route, since that edit already lives in `pending_plan`) all share. Step 7 taught it
 * to resolve per-item toggles before handing `activities` to `commitActivities` — these tests
 * prove that wiring end to end (real `resolveToggledActivities`, only the repos mocked), asserting
 * the EXACT activity shape that reaches `commitActivities`, not just that a helper function is
 * correct in isolation (see plan-partial-apply.test.ts for that).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Activity, PendingPlan, PendingPlanActivity } from '@cadence/shared';

const getUser = vi.fn();
const commitActivities = vi.fn();
const getActivePlan = vi.fn();
const listActivities = vi.fn();

vi.mock('../repos/users.ts', () => ({ getUser: (...a: unknown[]) => getUser(...a) }));
vi.mock('./plan-synthesis.ts', () => ({ commitActivities: (...a: unknown[]) => commitActivities(...a) }));
vi.mock('../repos/plans.ts', () => ({ getActivePlan: (...a: unknown[]) => getActivePlan(...a) }));
vi.mock('../repos/activities.ts', () => ({ listActivities: (...a: unknown[]) => listActivities(...a) }));

const { confirmPendingPlan } = await import('./plan-commit-flow.ts');

const USER = 'u1';

function activity(over: Partial<Activity> = {}): Activity {
  return {
    activity_id: 'a1',
    commitment_id: 'c1',
    plan_id: 'p1',
    title: 'Easy run',
    kind: 'user',
    schedule: { recurrence: 'FREQ=WEEKLY;BYDAY=TU', time_of_day: '07:00', duration_min: 30 },
    target: { metric: 'distance_km', value: 5 },
    completion_source: 'self_report',
    goal_id: 'g1',
    ...over,
  } as Activity;
}

function pendingActivity(over: Partial<PendingPlanActivity> = {}): PendingPlanActivity {
  return {
    title: 'Easy run',
    kind: 'user',
    cadence: 'Tuesdays',
    recurrence: 'FREQ=WEEKLY;BYDAY=TU',
    completion_source: 'self_report',
    ...over,
  };
}

function pendingPlan(activities: PendingPlanActivity[], over: Partial<PendingPlan> = {}): PendingPlan {
  return { activities, note: 'n', goal_ids: ['g1'], created_at: '2026-08-01T00:00:00.000Z', ...over };
}

const preview = vi.fn(); // never expected to run — pending_plan is always on file in these tests
const onCommitted = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  commitActivities.mockResolvedValue({ status: 'committed', planId: 'p2', version: 2, activities: 1, occurrences: 7 });
  onCommitted.mockResolvedValue(undefined);
});

describe('confirmPendingPlan — wire-compat when every item is enabled (today, unchanged)', () => {
  it('hands commitActivities the exact stored activities array, untouched', async () => {
    const pending = pendingPlan([pendingActivity()]);
    getUser.mockResolvedValue({ pending_plan: pending });

    const r = await confirmPendingPlan(USER, preview, onCommitted);

    expect(preview).not.toHaveBeenCalled();
    expect(getActivePlan).not.toHaveBeenCalled(); // no disabled items — never reads the active plan
    expect(commitActivities).toHaveBeenCalledTimes(1);
    const [userArg, opts] = commitActivities.mock.calls[0]!;
    expect(userArg).toBe(USER);
    expect(opts.activities).toBe(pending.activities); // same reference — zero transformation
    expect(opts.note).toBe('n');
    expect(opts.goalIds).toEqual(['g1']);
    expect(r.status).toBe('committed');
    expect(onCommitted).toHaveBeenCalledWith(pending);
  });
});

describe('confirmPendingPlan — the substitution (correctness requirement)', () => {
  it("reverts a disabled edit-with-commitment_id to the active plan's CURRENT version of that commitment", async () => {
    const pending = pendingPlan([
      // Proposed: retime to 06:00, shorten to 20 min — but the user left this toggle off.
      pendingActivity({ commitment_id: 'c1', time_of_day: '06:00', duration_min: 20, enabled: false }),
    ]);
    getUser.mockResolvedValue({ pending_plan: pending });
    getActivePlan.mockResolvedValue({ plan_id: 'p1' });
    listActivities.mockResolvedValue([activity()]); // still 07:00 / 30 min

    await confirmPendingPlan(USER, preview, onCommitted);

    expect(getActivePlan).toHaveBeenCalledWith(USER);
    expect(listActivities).toHaveBeenCalledWith('p1');
    const [, opts] = commitActivities.mock.calls[0]!;
    // The exact activity handed to commitActivities is the CURRENT version, not the declined edit.
    expect(opts.activities).toEqual([
      expect.objectContaining({ commitment_id: 'c1', time_of_day: '07:00', duration_min: 30 }),
    ]);
  });

  it('drops a disabled pure add (no commitment_id) instead of committing or reverting it', async () => {
    const pending = pendingPlan([
      pendingActivity({ title: 'Kept' }),
      pendingActivity({ title: 'Declined add', enabled: false }),
    ]);
    getUser.mockResolvedValue({ pending_plan: pending });
    getActivePlan.mockResolvedValue(null);

    await confirmPendingPlan(USER, preview, onCommitted);

    const [, opts] = commitActivities.mock.calls[0]!;
    expect(opts.activities).toHaveLength(1);
    expect(opts.activities[0].title).toBe('Kept');
  });

  it('still commits (does not vanish the whole plan) when the only enabled items follow disabled ones', async () => {
    const pending = pendingPlan([
      pendingActivity({ title: 'Declined add', enabled: false }),
      pendingActivity({ title: 'Kept', commitment_id: 'c2' }),
    ]);
    getUser.mockResolvedValue({ pending_plan: pending });
    getActivePlan.mockResolvedValue({ plan_id: 'p1' });
    listActivities.mockResolvedValue([]);

    const r = await confirmPendingPlan(USER, preview, onCommitted);

    const [, opts] = commitActivities.mock.calls[0]!;
    expect(opts.activities).toEqual([expect.objectContaining({ title: 'Kept', commitment_id: 'c2' })]);
    expect(r.status).toBe('committed');
    expect(onCommitted).toHaveBeenCalledTimes(1);
  });
});

describe('confirmPendingPlan — self-sufficiency is preserved (no pending on file)', () => {
  it('still runs preview first and resolves toggles on what preview stored, when nothing was on file', async () => {
    const stored = pendingPlan([pendingActivity()]);
    getUser.mockResolvedValueOnce({ pending_plan: null }).mockResolvedValueOnce({ pending_plan: stored });
    preview.mockResolvedValue({ status: 'proposed' });

    await confirmPendingPlan(USER, preview, onCommitted);

    expect(preview).toHaveBeenCalledTimes(1);
    const [, opts] = commitActivities.mock.calls[0]!;
    expect(opts.activities).toBe(stored.activities);
  });
});
