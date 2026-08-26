/**
 * Per-item toggleable plan changes (Step 7): `commitActivities` treats its `activities` array as
 * the COMPLETE next plan version, so a toggled-OFF item can never simply be filtered out — it has
 * to be substituted with the commitment's current version (an edit declined) or dropped (an add
 * declined). These tests pin `toPendingPlanActivity` (the shared Activity → PendingPlanActivity
 * mapping, extracted from week-build.ts — one mapping, two callers) and `resolveToggledActivities`
 * (the substitution rule itself) in isolation, before plan-commit-flow.test.ts proves the funnel
 * actually wires it in.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Activity, PendingPlanActivity } from '@cadence/shared';

const getActivePlan = vi.fn();
const listActivities = vi.fn();

vi.mock('../repos/plans.ts', () => ({ getActivePlan: (...a: unknown[]) => getActivePlan(...a) }));
vi.mock('../repos/activities.ts', () => ({ listActivities: (...a: unknown[]) => listActivities(...a) }));

const { toPendingPlanActivity, resolveToggledActivities } = await import('./plan-partial-apply.ts');

const USER = 'u1';

/** A committed Activity — nested `schedule`, exactly the repo's own shape (mirrors week-build's
 *  own fixture, since both files map from the same source type). */
function activity(over: Partial<Activity> = {}): Activity {
  return {
    activity_id: 'a1',
    commitment_id: 'c1',
    plan_id: 'p1',
    title: 'Easy run',
    kind: 'user',
    category: undefined,
    schedule: { recurrence: 'FREQ=WEEKLY;BYDAY=TU', time_of_day: '07:00', duration_min: 30 },
    target: { metric: 'distance_km', value: 5 },
    completion_source: 'self_report',
    why: 'Builds the base.',
    goal_id: 'g1',
    ...over,
  } as Activity;
}

/** A minimal PendingPlanActivity — the preview/proposal shape. */
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

beforeEach(() => {
  vi.clearAllMocks();
});

describe('toPendingPlanActivity — Activity (nested schedule) → PendingPlanActivity (flat)', () => {
  it('unpacks schedule.recurrence/time_of_day/duration_min onto flat fields commitActivities reads', () => {
    const p = toPendingPlanActivity(activity());

    expect(p.commitment_id).toBe('c1');
    expect(p.title).toBe('Easy run');
    expect(p.kind).toBe('user');
    expect(p.recurrence).toBe('FREQ=WEEKLY;BYDAY=TU');
    expect(p.time_of_day).toBe('07:00');
    expect(p.duration_min).toBe(30);
    expect(p.target).toEqual({ metric: 'distance_km', value: 5 });
    expect(p.completion_source).toBe('self_report');
    expect(p.goal_id).toBe('g1');
    expect(p.why).toBe('Builds the base.');
    // `cadence` is required on the type even though commitActivities never reads it.
    expect(p.cadence).toEqual(expect.any(String));
  });

  it('carries how_to and suggested through, and turns null why/how_to into undefined', () => {
    const p = toPendingPlanActivity(
      activity({ why: null, how_to: 'Dead hangs, not farmers carries.', suggested: true }),
    );

    expect(p.why).toBeUndefined();
    expect(p.how_to).toBe('Dead hangs, not farmers carries.');
    expect(p.suggested).toBe(true);
  });

  it('never sets enabled or change_reason — a committed Activity carries neither', () => {
    const p = toPendingPlanActivity(activity());

    expect(p.enabled).toBeUndefined();
    expect(p.change_reason).toBeUndefined();
  });
});

describe('resolveToggledActivities — the substitution rule', () => {
  it('passes through byte-identical (same array reference) when every item is enabled', async () => {
    const activities = [pendingActivity(), pendingActivity({ title: 'Meditate', enabled: true })];

    const resolved = await resolveToggledActivities(USER, activities);

    expect(resolved).toBe(activities); // same reference — zero transformation
    expect(getActivePlan).not.toHaveBeenCalled(); // the common case never reads the active plan
    expect(listActivities).not.toHaveBeenCalled();
  });

  it('treats an absent `enabled` as true, even alongside a sibling that IS disabled', async () => {
    const untouched = pendingActivity({ title: 'Meditate' }); // no `enabled` key at all
    getActivePlan.mockResolvedValue({ plan_id: 'p1' });
    listActivities.mockResolvedValue([activity({ commitment_id: 'c1' })]);

    const resolved = await resolveToggledActivities(USER, [
      pendingActivity({ commitment_id: 'c1', enabled: false, time_of_day: '06:00' }),
      untouched,
    ]);

    expect(resolved).toContainEqual(untouched);
  });

  it('reverts a disabled edit-with-commitment_id to the CURRENT activity in the still-active plan', async () => {
    getActivePlan.mockResolvedValue({ plan_id: 'p1' });
    listActivities.mockResolvedValue([
      activity({
        commitment_id: 'c1',
        schedule: { recurrence: 'FREQ=WEEKLY;BYDAY=TU', time_of_day: '07:00', duration_min: 30 },
      }),
    ]);
    // The proposed (declined) edit retimed + shortened it.
    const declinedEdit = pendingActivity({
      commitment_id: 'c1',
      time_of_day: '06:00',
      duration_min: 20,
      enabled: false,
    });

    const [reverted] = await resolveToggledActivities(USER, [declinedEdit]);

    expect(getActivePlan).toHaveBeenCalledWith(USER);
    expect(listActivities).toHaveBeenCalledWith('p1');
    // The CURRENT values win, not the declined edit's.
    expect(reverted).toEqual(toPendingPlanActivity(activity({ commitment_id: 'c1' })));
    expect(reverted!.time_of_day).toBe('07:00');
    expect(reverted!.duration_min).toBe(30);
  });

  it('drops a disabled pure add (no commitment_id) rather than reverting or keeping it', async () => {
    getActivePlan.mockResolvedValue(null);

    const resolved = await resolveToggledActivities(USER, [
      pendingActivity({ title: 'Kept' }),
      pendingActivity({ title: 'Declined add', commitment_id: undefined, enabled: false }),
    ]);

    expect(resolved).toHaveLength(1);
    expect(resolved[0]!.title).toBe('Kept');
  });

  it('drops a disabled edit whose commitment no longer exists in the active plan (nothing to revert to)', async () => {
    getActivePlan.mockResolvedValue({ plan_id: 'p1' });
    listActivities.mockResolvedValue([]); // the commitment is gone

    const resolved = await resolveToggledActivities(USER, [
      pendingActivity({ commitment_id: 'stale-id', enabled: false }),
    ]);

    expect(resolved).toHaveLength(0);
  });

  it('preserves original order across a mix of kept, reverted, and dropped items', async () => {
    getActivePlan.mockResolvedValue({ plan_id: 'p1' });
    listActivities.mockResolvedValue([activity({ commitment_id: 'c1' })]);

    const resolved = await resolveToggledActivities(USER, [
      pendingActivity({ title: 'First (kept)' }),
      pendingActivity({ title: 'Second (declined add)', enabled: false }),
      pendingActivity({ title: 'Third (declined edit)', commitment_id: 'c1', enabled: false }),
      pendingActivity({ title: 'Fourth (kept)' }),
    ]);

    expect(resolved.map((a) => a.title)).toEqual(['First (kept)', 'Easy run', 'Fourth (kept)']);
  });
});
