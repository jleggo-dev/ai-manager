import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const getActivePlan = vi.fn();
const setPendingWeekReview = vi.fn();

vi.mock('../repos/plans.ts', () => ({ getActivePlan: (...a: unknown[]) => getActivePlan(...a) }));
vi.mock('../repos/users.ts', () => ({
  setPendingWeekReview: (...a: unknown[]) => setPendingWeekReview(...a),
}));

const { OPEN_WEEK_REVIEW } = await import('./coach-action-week-review.ts');

/**
 * `open_week_review` must be complete in one call (TOOL-HARNESS.md §5): calling it is what makes
 * "the user now has a card" true, so these tests pin that `setPendingWeekReview` is the ONE write,
 * happens synchronously inside `run()`, and the plan-week arithmetic survives the exact type
 * mismatch the harness doc is written around (`generated_at` arriving as a Date, not the string the
 * type promises).
 */
describe('open_week_review', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-26T12:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('tells the coach plainly when there is no active plan, and writes nothing', async () => {
    getActivePlan.mockResolvedValue(null);
    const out = await OPEN_WEEK_REVIEW.run('u1', {});
    expect(setPendingWeekReview).not.toHaveBeenCalled();
    expect(out).toMatch(/no active plan|no week to review/i);
    expect(out).toMatch(/build one/i);
  });

  it('caps the window at today for a week still in progress', async () => {
    getActivePlan.mockResolvedValue({ generated_at: '2026-08-24T00:00:00.000Z' });
    const out = await OPEN_WEEK_REVIEW.run('u1', {});

    expect(setPendingWeekReview).toHaveBeenCalledTimes(1);
    const [userId, review] = setPendingWeekReview.mock.calls[0]!;
    expect(userId).toBe('u1');
    expect(review.from).toBe('2026-08-24');
    // Naive +7 would land on 2026-08-31 — a week not yet lived. Capped at "today" instead.
    expect(review.to).toBe('2026-08-26');
    expect(typeof review.built_at).toBe('string');

    // The model must not recite figures — the card is the app's, not hers.
    expect(out).toMatch(/2026-08-24/);
    expect(out).toMatch(/2026-08-26/);
    expect(out).toMatch(/do not (describe|recite)/i);
  });

  it('runs the full 7 days for a week that has already finished', async () => {
    getActivePlan.mockResolvedValue({ generated_at: '2026-08-01T00:00:00.000Z' });
    await OPEN_WEEK_REVIEW.run('u1', {});

    const [, review] = setPendingWeekReview.mock.calls[0]!;
    expect(review.from).toBe('2026-08-01');
    expect(review.to).toBe('2026-08-08');
  });

  /**
   * The exact bug TOOL-HARNESS.md is written around: a row type declared `generated_at: string`,
   * postgres handed back a `Date`, and a direct `.slice()` threw — read as "nothing on file" by
   * the tool path that swallowed it. Routing through `new Date(...)` first must survive either shape.
   */
  it('survives generated_at arriving as a Date rather than the string the type promises', async () => {
    getActivePlan.mockResolvedValue({ generated_at: new Date('2026-08-24T00:00:00.000Z') });
    const out = await OPEN_WEEK_REVIEW.run('u1', {});

    expect(setPendingWeekReview).toHaveBeenCalledTimes(1);
    const [, review] = setPendingWeekReview.mock.calls[0]!;
    expect(review.from).toBe('2026-08-24');
    expect(out).not.toMatch(/could not|something went wrong/i);
  });
});
