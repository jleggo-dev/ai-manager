/**
 * `buildPlanView` is the slowest thing the app does — and it had no test.
 *
 * Measured 2026-08-20: GET /plan spent 2.0–3.8s running ~11 database queries IN SERIES, and in
 * production the API (iad1) and the database (us-west-2) sit on opposite coasts, so each of those
 * is a cross-country round trip (~181ms through the pooler for a bare `select 1`). The owner's
 * complaint — "every time I click on any screen I get a '...' loading image" — is mostly this
 * function.
 *
 * These tests pin the two things a future edit could quietly undo: that the independent reads run
 * CONCURRENTLY (a serial re-write would still pass a behavioural test, which is exactly why the
 * timing assertion is here), and that one flaky read cannot take the whole screen down —
 * `Promise.all` rejects on first failure, so every batched call keeps its own catch.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const q = {
  evaluateStreak: vi.fn(),
  getActiveEpisode: vi.fn(),
  getActivePlan: vi.fn(),
  listGoals: vi.fn(),
  listActivities: vi.fn(),
  getUser: vi.fn(),
  listOccurrences: vi.fn(),
  listSessionStepCounts: vi.fn(),
  getLatestConversation: vi.fn(),
};

/** Every repo call takes this long, so serial vs parallel is unmistakable in the wall clock. */
const HOP = 60;
const slow =
  <T>(value: T) =>
  () =>
    new Promise<T>((r) => setTimeout(() => r(value), HOP));

vi.mock('./streak.ts', () => ({
  evaluateStreak: (...a: unknown[]) => q.evaluateStreak(...a),
  EMPTY_STREAK: { current: 0, best: 0, freezes: 0 },
}));
vi.mock('../repos/episodes.ts', () => ({ getActiveEpisode: (...a: unknown[]) => q.getActiveEpisode(...a) }));
vi.mock('../repos/plans.ts', () => ({ getActivePlan: (...a: unknown[]) => q.getActivePlan(...a) }));
vi.mock('../repos/goals.ts', () => ({ listGoals: (...a: unknown[]) => q.listGoals(...a) }));
vi.mock('../repos/activities.ts', () => ({ listActivities: (...a: unknown[]) => q.listActivities(...a) }));
vi.mock('../repos/users.ts', () => ({ getUser: (...a: unknown[]) => q.getUser(...a) }));
vi.mock('../repos/conversations.ts', () => ({
  getLatestConversation: (...a: unknown[]) => q.getLatestConversation(...a),
}));
vi.mock('../repos/occurrences.ts', () => ({
  listOccurrences: (...a: unknown[]) => q.listOccurrences(...a),
  listSessionStepCounts: (...a: unknown[]) => q.listSessionStepCounts(...a),
}));

const { buildPlanView, computeWeekState } = await import('./plan-view.ts');

const PLAN = { plan_id: 'p1', version: 3, generated_at: '2026-08-01', rationale: null };
const USER = 'u1';

beforeEach(() => {
  vi.clearAllMocks();
  q.evaluateStreak.mockImplementation(slow({ current: 4, best: 9, freezes: 1 }));
  q.getActiveEpisode.mockImplementation(slow(null));
  q.getActivePlan.mockImplementation(slow(PLAN));
  q.listGoals.mockImplementation(slow([]));
  q.listActivities.mockImplementation(slow([]));
  q.getUser.mockImplementation(slow({ timezone: 'America/Toronto', pending_proposal: null }));
  q.listOccurrences.mockImplementation(slow([]));
  q.listSessionStepCounts.mockImplementation(slow([]));
  q.getLatestConversation.mockImplementation(slow(null));
});

describe('buildPlanView', () => {
  it('reads what it can concurrently — the whole point of the batching', async () => {
    /**
     * Deterministic, not wall-clock. The first version asserted elapsed time and flaked the moment
     * other suites ran beside it — a timing assertion measures the machine as much as the code.
     * Peak in-flight count measures the thing itself: serial execution can never exceed 1.
     */
    let inflight = 0;
    let peak = 0;
    const tracked =
      <T>(value: T) =>
      () => {
        inflight += 1;
        peak = Math.max(peak, inflight);
        return new Promise<T>((r) =>
          setTimeout(() => {
            inflight -= 1;
            r(value);
          }, HOP),
        );
      };
    q.evaluateStreak.mockImplementation(tracked({ current: 4, best: 9, freezes: 1 }));
    q.getActiveEpisode.mockImplementation(tracked(null));
    q.getActivePlan.mockImplementation(tracked(PLAN));
    q.listGoals.mockImplementation(tracked([]));
    q.listOccurrences.mockImplementation(tracked([]));
    q.listSessionStepCounts.mockImplementation(tracked([]));

    await buildPlanView(USER, 7, 'America/Toronto');

    // Four reads open together after the horizon top-up; three more for the day window later.
    // Anything below 3 means a batch was re-serialized.
    expect(peak).toBeGreaterThanOrEqual(3);
  });

  it('runs the four horizon-unblocked reads in ONE hop, not four', async () => {
    const started: string[] = [];
    const at = (name: string) => () => {
      started.push(name);
      return new Promise((r) => setTimeout(() => r(name === 'plan' ? PLAN : name === 'goals' ? [] : null), HOP));
    };
    q.evaluateStreak.mockImplementation(at('streak'));
    q.getActiveEpisode.mockImplementation(at('episode'));
    q.getActivePlan.mockImplementation(at('plan'));
    q.listGoals.mockImplementation(at('goals'));

    const p = buildPlanView(USER, 7, 'America/Toronto');
    // All four must be IN FLIGHT together — distinct names, since a call may be re-entered.
    await vi.waitFor(() => expect(new Set(started).size).toBe(4));
    await p;
  });

  /** Promise.all rejects on first failure — so a missing episode must not cost the whole screen. */
  it('still renders when a batched read fails', async () => {
    q.getActiveEpisode.mockRejectedValue(new Error('episodes unavailable'));
    q.evaluateStreak.mockRejectedValue(new Error('streak unavailable'));
    q.listGoals.mockRejectedValue(new Error('goals unavailable'));

    const view = await buildPlanView(USER, 7, 'America/Toronto');
    expect(view.hasPlan).toBe(true);
    expect(view.activeEpisode).toBeNull();
    // The shape of EMPTY_STREAK belongs to streak.ts; what matters here is that the screen fell
    // back to a zeroed streak rather than failing.
    expect((view.streak as { current: number }).current).toBe(0);
  });

  /**
   * A pause and a detour are the same row; only the stored flag tells them apart, and the screens
   * read it to decide whether to ask a gear question that a cleared stretch has no answer to.
   */
  it('marks a paused stretch as paused, and an ordinary detour as not', async () => {
    const episode = (constraints: Record<string, unknown>) => ({
      type: 'custom',
      start: '2026-09-07',
      end: '2026-09-13',
      available_equipment: [],
      constraints,
    });

    q.getActiveEpisode.mockResolvedValue(episode({ paused: true }));
    expect((await buildPlanView(USER, 7, 'America/Toronto')).activeEpisode?.paused).toBe(true);

    q.getActiveEpisode.mockResolvedValue(episode({}));
    expect((await buildPlanView(USER, 7, 'America/Toronto')).activeEpisode?.paused).toBe(false);
  });

  it('fetches goals once, not twice', async () => {
    await buildPlanView(USER, 7, 'America/Toronto');
    expect(q.listGoals).toHaveBeenCalledTimes(1);
  });

  it('the no-plan branch reuses the batched goals instead of re-reading them', async () => {
    q.getActivePlan.mockImplementation(slow(null));
    const view = await buildPlanView(USER, 7, 'America/Toronto');
    expect(view.hasPlan).toBe(false);
    expect(q.listGoals).toHaveBeenCalledTimes(1);
  });

  /**
   * Gap 4 (PLAN-CHANGES.md): the wire used to carry only `steps`, so an occurrence whose session
   * hadn't been written yet was indistinguishable from an ordinary one — the ~34s wait was
   * discovered by tapping. `session_ready` is derived from the step-count read already in hand
   * (it only returns rows whose `session` is non-null), user-kind rows only: a system row (weigh-
   * in, meal log) never gets a session, so "not ready" there would be a permanent false alarm.
   */
  it('says which user occurrences still wait on their session, and stays silent on system rows', async () => {
    const { planDayBase } = await import('./plan-day.ts');
    const today = new Date(planDayBase(new Date(), 'America/Toronto', null)).toISOString().slice(0, 10);
    q.listActivities.mockImplementation(
      slow([
        { activity_id: 'a1', kind: 'user', title: 'Easy run', schedule: {} },
        { activity_id: 'a2', kind: 'user', title: 'Strength', schedule: {} },
        { activity_id: 'a3', kind: 'system', title: 'Weigh-in', schedule: {} },
      ]),
    );
    q.listOccurrences.mockImplementation(
      slow([
        { occurrence_id: 'o1', activity_id: 'a1', date: today, status: 'pending' },
        { occurrence_id: 'o2', activity_id: 'a2', date: today, status: 'pending' },
        { occurrence_id: 'o3', activity_id: 'a3', date: today, status: 'pending' },
      ]),
    );
    // Only o1 has a written session — the step-count query returns nothing for NULL sessions.
    q.listSessionStepCounts.mockImplementation(slow([{ occurrence_id: 'o1', steps: 3 }]));

    const view = await buildPlanView(USER, 7, 'America/Toronto');
    const byId = new Map(view.week.flatMap((d) => d.occurrences).map((o) => [o.occurrence_id, o]));
    expect(byId.get('o1')?.session_ready).toBe(true);
    expect(byId.get('o2')?.session_ready).toBe(false);
    expect(byId.get('o3') && 'session_ready' in byId.get('o3')!).toBe(false);
  });

  /**
   * Week state (check-in rebuild, step 6) — the pure half is tested directly below; this just
   * pins that `buildPlanView` actually wires `computeWeekState`'s result onto the payload.
   */
  it('carries weekState on the payload, and null when there is no active plan', async () => {
    const withPlan = await buildPlanView(USER, 7, 'America/Toronto');
    expect(withPlan.weekState).toEqual({ ends_on: expect.any(String), checkin_due: expect.any(Boolean) });

    q.getActivePlan.mockImplementation(slow(null));
    const noPlan = await buildPlanView(USER, 7, 'America/Toronto');
    expect(noPlan.weekState).toBeNull();
  });
});

describe('computeWeekState (the week ends where the horizon does — step 6)', () => {
  it('is null with no active plan', () => {
    expect(computeWeekState(null)).toBeNull();
  });

  it('is not due the day a plan commits', () => {
    const state = computeWeekState({ generated_at: new Date().toISOString() });
    expect(state?.checkin_due).toBe(false);
  });

  it('is not due at 6 days, 23 hours old — just under the line', () => {
    const generated_at = new Date(Date.now() - (7 * 86_400_000 - 3_600_000)).toISOString();
    expect(computeWeekState({ generated_at })?.checkin_due).toBe(false);
  });

  it('is due once the active plan is exactly 7 days old', () => {
    const generated_at = new Date(Date.now() - 7 * 86_400_000).toISOString();
    expect(computeWeekState({ generated_at })?.checkin_due).toBe(true);
  });

  it('is due for a plan well past 7 days old', () => {
    const generated_at = new Date(Date.now() - 14 * 86_400_000).toISOString();
    expect(computeWeekState({ generated_at })?.checkin_due).toBe(true);
  });

  it('ends_on is exactly 7 days after generated_at', () => {
    const state = computeWeekState({ generated_at: '2026-08-01T12:00:00.000Z' });
    expect(state?.ends_on).toBe('2026-08-08');
  });

  /** The plan's own horizon governs (0050) — a granted "two weeks ahead" moves the end with it. */
  it("honours the plan's own horizon_days: a 14-day week is not due at day 8", () => {
    const generated_at = new Date(Date.now() - 8 * 86_400_000).toISOString();
    const state = computeWeekState({ generated_at, horizon_days: 14 });
    expect(state?.checkin_due).toBe(false);
  });

  it('a 14-day week ends 14 days after generated_at, and is due there', () => {
    expect(computeWeekState({ generated_at: '2026-08-01T12:00:00.000Z', horizon_days: 14 })?.ends_on).toBe(
      '2026-08-15',
    );
    const generated_at = new Date(Date.now() - 14 * 86_400_000).toISOString();
    expect(computeWeekState({ generated_at, horizon_days: 14 })?.checkin_due).toBe(true);
  });
});
