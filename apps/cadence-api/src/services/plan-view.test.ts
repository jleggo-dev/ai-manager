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
  ensureHorizon: vi.fn(),
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

vi.mock('./horizon.ts', () => ({ ensureHorizon: (...a: unknown[]) => q.ensureHorizon(...a) }));
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

const { buildPlanView } = await import('./plan-view.ts');

const PLAN = { plan_id: 'p1', version: 3, generated_at: '2026-08-01', rationale: null };
const USER = 'u1';

beforeEach(() => {
  vi.clearAllMocks();
  q.ensureHorizon.mockResolvedValue(undefined);
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
      <T,>(value: T) =>
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
});
