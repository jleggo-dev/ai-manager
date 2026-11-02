import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { Activity, PendingPlan, PendingPlanActivity } from '@cadence/shared';

/**
 * The Changes sheet's one read, composed from two independent sources: the stored `pending_plan`
 * (title/reason/enabled/the NEXT schedule) and the still-active plan's CURRENT activities (the NOW
 * schedule, looked up by `commitment_id`). Mocking both lets these tests hold the composition to
 * account without a database — no clearMocks in vitest config, so every mock gets a fresh default
 * in `beforeEach` rather than relying on call-count resets.
 */

const getUser = vi.fn();
const getActivePlan = vi.fn();
const listActivities = vi.fn();

vi.mock('../repos/users.ts', () => ({ getUser: (...a: unknown[]) => getUser(...a) }));
vi.mock('../repos/plans.ts', () => ({ getActivePlan: (...a: unknown[]) => getActivePlan(...a) }));
vi.mock('../repos/activities.ts', () => ({ listActivities: (...a: unknown[]) => listActivities(...a) }));

const { buildPendingChangeDetail, scheduleLine } = await import('./plan-change-detail.ts');

const RUN_COMMITMENT = 'c-run-1111-4111-8111-111111111111';

const CURRENT_RUN: Activity = {
  activity_id: 'a-run-old',
  commitment_id: RUN_COMMITMENT,
  plan_id: 'p1',
  title: 'Easy run',
  kind: 'user',
  schedule: { recurrence: 'FREQ=WEEKLY;BYDAY=TH', time_of_day: '18:30', duration_min: 40 },
  completion_source: 'self_report',
};

function pendingPlan(overrides: Partial<PendingPlan> = {}): PendingPlan {
  return {
    activities: [],
    note: '',
    goal_ids: [],
    created_at: '2026-08-26T09:00:00.000Z',
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  getActivePlan.mockResolvedValue({ plan_id: 'p1', version: 4 });
  listActivities.mockResolvedValue([CURRENT_RUN]);
});

describe('buildPendingChangeDetail', () => {
  it('returns an empty list rather than erroring when nothing is pending', async () => {
    getUser.mockResolvedValue({ pending_plan: null });
    const r = await buildPendingChangeDetail('u1');
    expect(r).toEqual({ plan_version: null, items: [], removed: [] });
    expect(getActivePlan).not.toHaveBeenCalled();
  });

  it('also collapses to empty when the user record itself is gone', async () => {
    getUser.mockResolvedValue(null);
    const r = await buildPendingChangeDetail('u1');
    expect(r).toEqual({ plan_version: null, items: [], removed: [] });
  });

  it('composes NOW from the active plan and NEXT from the proposal, for an edited commitment', async () => {
    getUser.mockResolvedValue({
      pending_plan: pendingPlan({
        activities: [
          {
            commitment_id: RUN_COMMITMENT,
            title: 'Easy run',
            kind: 'user',
            cadence: 'Friday',
            recurrence: 'FREQ=WEEKLY;BYDAY=FR',
            time_of_day: '06:15',
            completion_source: 'self_report',
            change_reason: "You've made 4 of 4 morning sessions this month and 1 of 4 evening ones.",
          },
        ],
      }),
    });

    const r = await buildPendingChangeDetail('u1');
    expect(r.plan_version).toBe(4);
    expect(r.items).toEqual([
      {
        index: 0,
        title: 'Easy run',
        change_reason: "You've made 4 of 4 morning sessions this month and 1 of 4 evening ones.",
        enabled: true,
        now: 'Thu · 6:30 pm · 40 min',
        next: 'Fri · 6:15 am',
      },
    ]);
  });

  it('gives a pure add no NOW at all — there is nothing to look up', async () => {
    getUser.mockResolvedValue({
      pending_plan: pendingPlan({
        activities: [
          {
            title: 'Sauna',
            kind: 'user',
            cadence: 'Sunday',
            recurrence: 'FREQ=WEEKLY;BYDAY=SU',
            time_of_day: '19:00',
            completion_source: 'self_report',
            enabled: false,
          },
        ],
      }),
    });

    const r = await buildPendingChangeDetail('u1');
    expect(r.items[0]!.now).toBeNull();
    expect(r.items[0]!.next).toBe('Sun · 7 pm');
    expect(r.items[0]!.enabled).toBe(false);
    expect(r.items[0]).not.toHaveProperty('change_reason');
  });

  it('resolves an absent `enabled` to true, same default the commit funnel already uses', async () => {
    getUser.mockResolvedValue({
      pending_plan: pendingPlan({
        activities: [
          {
            title: 'Box breathing',
            kind: 'user',
            cadence: 'Daily',
            recurrence: 'FREQ=DAILY',
            completion_source: 'self_report',
            // no `enabled` field at all
          },
        ],
      }),
    });

    const r = await buildPendingChangeDetail('u1');
    expect(r.items[0]!.enabled).toBe(true);
  });

  it('numbers items by their position in the stored array — the same index the toggles route uses', async () => {
    getUser.mockResolvedValue({
      pending_plan: pendingPlan({
        activities: [
          { title: 'A', kind: 'user', cadence: '', recurrence: 'FREQ=DAILY', completion_source: 'self_report' },
          { title: 'B', kind: 'user', cadence: '', recurrence: 'FREQ=DAILY', completion_source: 'self_report' },
        ],
      }),
    });

    const r = await buildPendingChangeDetail('u1');
    expect(r.items.map((i) => i.index)).toEqual([0, 1]);
  });

  it('drops NOW rather than guessing when the active plan has gone missing since the proposal', async () => {
    getUser.mockResolvedValue({
      pending_plan: pendingPlan({
        activities: [
          {
            commitment_id: RUN_COMMITMENT,
            title: 'Easy run',
            kind: 'user',
            cadence: 'Friday',
            recurrence: 'FREQ=WEEKLY;BYDAY=FR',
            completion_source: 'self_report',
          },
        ],
      }),
    });
    getActivePlan.mockResolvedValue(null);

    const r = await buildPendingChangeDetail('u1');
    expect(r.plan_version).toBeNull();
    expect(r.items[0]!.now).toBeNull();
    expect(listActivities).not.toHaveBeenCalled();
  });
});

/** The current run as the proposal stores it — the row propose_plan_change leaves alone. */
function runAsProposed(overrides: Partial<PendingPlanActivity> = {}): PendingPlanActivity {
  return {
    commitment_id: RUN_COMMITMENT,
    title: 'Easy run',
    kind: 'user',
    cadence: 'Thursday',
    recurrence: 'FREQ=WEEKLY;BYDAY=TH',
    time_of_day: '18:30',
    duration_min: 40,
    completion_source: 'self_report',
    ...overrides,
  };
}

const STRENGTH: Activity = {
  activity_id: 'a-str-old',
  commitment_id: 'c-str-2222-4222-8222-222222222222',
  plan_id: 'p1',
  title: 'Obstacle strength',
  kind: 'user',
  schedule: { recurrence: 'FREQ=WEEKLY;BYDAY=SU', time_of_day: '16:30', duration_min: 45 },
  how_to: 'Bike warm-up, then pull, carry, grip.',
  completion_source: 'self_report',
};

describe('buildPendingChangeDetail — only what the proposal changes', () => {
  /**
   * 2026-11-01: swapping the bike warm-up for step-ups put up "Apply 18 changes and build next
   * week" — the proposal stores the whole next plan, and the sheet listed all of it. Positives
   * (a real change shows) AND near-misses (a row that merely round-tripped does not).
   */
  it.each([
    ['the same row, untouched', {}, false],
    ['no time stored as "" against undefined', { time_of_day: '' }, true], // differs: current has 18:30
    ['a new time', { time_of_day: '06:15' }, true],
    ['new days', { recurrence: 'FREQ=WEEKLY;BYDAY=FR' }, true],
    ['new minutes', { duration_min: 30 }, true],
    ['new contents', { how_to: 'Strides at the end.' }, true],
    ['a new name', { title: 'Recovery run' }, true],
    ['a new target', { target: { metric: 'distance', value: 3, unit: 'km' } }, true],
    ['the same name with a stray space', { title: 'Easy run ' }, false],
    ['a display-only field reworded', { why: 'Keeps the aerobic base.', cadence: 'Every Thursday' }, false],
  ] as const)('%s → listed: %s', async (_label, overrides, listed) => {
    getUser.mockResolvedValue({ pending_plan: pendingPlan({ activities: [runAsProposed(overrides)] }) });
    const r = await buildPendingChangeDetail('u1');
    expect(r.items.length).toBe(listed ? 1 : 0);
  });

  it('a one-session swap in a full plan lists that one session, keeping its stored index', async () => {
    listActivities.mockResolvedValue([CURRENT_RUN, STRENGTH]);
    getUser.mockResolvedValue({
      pending_plan: pendingPlan({
        activities: [
          runAsProposed(),
          {
            commitment_id: STRENGTH.commitment_id,
            title: 'Obstacle strength',
            kind: 'user',
            cadence: 'Sunday',
            recurrence: 'FREQ=WEEKLY;BYDAY=SU',
            time_of_day: '16:30',
            duration_min: 45,
            how_to: 'Replace the bike warm-up with 5 minutes of easy step-ups.',
            completion_source: 'self_report',
          },
        ],
      }),
    });

    const r = await buildPendingChangeDetail('u1');
    expect(r.items).toEqual([
      {
        index: 1,
        title: 'Obstacle strength',
        enabled: true,
        now: 'Sun · 4:30 pm · 45 min',
        next: 'Sun · 4:30 pm · 45 min',
        how_to: 'Replace the bike warm-up with 5 minutes of easy step-ups.',
      },
    ]);
    expect(r.removed).toEqual([]);
  });

  it('leaves how_to off a row whose contents did not change', async () => {
    listActivities.mockResolvedValue([STRENGTH]);
    getUser.mockResolvedValue({
      pending_plan: pendingPlan({
        activities: [
          {
            commitment_id: STRENGTH.commitment_id,
            title: 'Obstacle strength',
            kind: 'user',
            cadence: 'Sunday',
            recurrence: 'FREQ=WEEKLY;BYDAY=SU',
            time_of_day: '06:00',
            duration_min: 45,
            how_to: STRENGTH.how_to!,
            completion_source: 'self_report',
          },
        ],
      }),
    });

    const r = await buildPendingChangeDetail('u1');
    expect(r.items[0]!.next).toBe('Sun · 6 am · 45 min');
    expect(r.items[0]).not.toHaveProperty('how_to');
  });

  it('names what the proposal drops, since a dropped commitment has no row of its own', async () => {
    listActivities.mockResolvedValue([CURRENT_RUN, STRENGTH]);
    getUser.mockResolvedValue({ pending_plan: pendingPlan({ activities: [runAsProposed()] }) });

    const r = await buildPendingChangeDetail('u1');
    expect(r.items).toEqual([]);
    expect(r.removed).toEqual(['Obstacle strength']);
  });

  it("matches a rebuild's rows by name, as the commit does — a kept row is neither new nor removed", async () => {
    getUser.mockResolvedValue({
      pending_plan: pendingPlan({ activities: [runAsProposed({ commitment_id: undefined })] }),
    });

    const r = await buildPendingChangeDetail('u1');
    expect(r.items).toEqual([]);
    expect(r.removed).toEqual([]);
  });
});

describe('scheduleLine', () => {
  it('adds the minutes when they are set, so a resize reads as one', () => {
    expect(scheduleLine('FREQ=WEEKLY;BYDAY=TH', '18:30', 40)).toBe('Thu · 6:30 pm · 40 min');
    expect(scheduleLine('FREQ=WEEKLY;BYDAY=TH', undefined, 40)).toBe('Thu · 40 min');
  });

  it('joins the cadence and a 12-hour clock with a middle dot', () => {
    expect(scheduleLine('FREQ=WEEKLY;BYDAY=TH', '18:30')).toBe('Thu · 6:30 pm');
  });

  it('drops the minutes on the hour', () => {
    expect(scheduleLine('FREQ=WEEKLY;BYDAY=MO', '07:00')).toBe('Mon · 7 am');
  });

  it('reads noon and midnight correctly, the classic 12-hour off-by-one', () => {
    expect(scheduleLine('FREQ=DAILY', '00:00')).toBe('Every day · 12 am');
    expect(scheduleLine('FREQ=DAILY', '12:00')).toBe('Every day · 12 pm');
  });

  it('omits the time half entirely when none is set', () => {
    expect(scheduleLine('FREQ=WEEKLY;BYDAY=SA')).toBe('Sat');
  });

  it('spells out "any time" for the stored anytime marker, matching the card\'s own wording', () => {
    expect(scheduleLine('FREQ=WEEKLY;BYDAY=SU', 'anytime')).toBe('Sun · any time');
  });

  it('passes through a free-text time of day untouched', () => {
    expect(scheduleLine('FREQ=WEEKLY;BYDAY=SA', 'morning')).toBe('Sat · morning');
  });
});
