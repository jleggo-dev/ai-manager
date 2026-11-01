/**
 * The end-of-week buttons against the REAL routes they call — both sides at once (the shape and
 * the reason: src/test/client-route.ts).
 *
 * "Just build my week" and "Build next week" (EndOfTrailCard, useWeekGate) decide success by the
 * `status` word in the body, and the weekly check-in sheet (useWeekReview, WeekReviewSheet) reverts
 * a row when its write comes back false. Those are the readings pinned here, against routes/week.ts
 * and routes/week-review.ts mounted where app.ts mounts them. Faked: the services behind them.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import type { PendingWeekReview } from '@cadence/shared';
import { serveRoutesToWebClient, type ClientAgainstRoutes } from '../test/client-route.ts';

/** The account behind the routes. */
const account: {
  plan: boolean;
  checkin_due: boolean;
  built_through: string | null;
  pending_week_review: PendingWeekReview | null;
  recaps: { line?: string }[];
  occurrences: Map<string, { done: boolean; minutes?: number; steps?: Record<string, boolean> }>;
  meals: Set<string>;
} = {
  plan: true,
  checkin_due: true,
  built_through: null,
  pending_week_review: null,
  recaps: [],
  occurrences: new Map(),
  meals: new Set(),
};

vi.mock('../auth/middleware.ts', () => ({
  requireCadenceUser: (req: { cadenceUserId?: string }, _res: unknown, next: () => void) => {
    req.cadenceUserId = 'u1';
    next();
  },
}));
vi.mock('../services/week-build.ts', () => ({
  buildNextWeek: async () => {
    if (!account.plan) return { status: 'no_plan' };
    if (!account.checkin_due) return { status: 'not_due' };
    account.checkin_due = false;
    return { status: 'committed', version: 5, activities: 4, occurrences: 12 };
  },
  buildWeekAhead: async () => {
    if (!account.plan) return { status: 'no_plan' };
    if (account.checkin_due) return { status: 'due' };
    if (account.built_through) return { status: 'already_built', builtThrough: account.built_through };
    account.built_through = '2026-11-15';
    return { status: 'built', builtThrough: account.built_through, occurrences: 9 };
  },
}));
vi.mock('../repos/users.ts', () => ({
  getUser: async () => ({ pending_week_review: account.pending_week_review, baseline: { weight_unit: 'kg' } }),
  setPendingWeekReview: async (_u: string, r: PendingWeekReview | null) => {
    account.pending_week_review = r;
  },
}));
vi.mock('../repos/plans.ts', () => ({ restartActiveWeek: async () => {} }));
vi.mock('../services/week-review-facts.ts', () => ({ buildWeekReviewFacts: async () => ({ days: [] }) }));
vi.mock('../services/week-review-write.ts', () => ({
  confirmSession: async (_u: string, id: string, v: { done: boolean; minutes?: number }) => {
    const occ = account.occurrences.get(id);
    if (!occ) return false;
    Object.assign(occ, v);
    return true;
  },
  toggleMealSlot: async (_u: string, date: string, meal: string, logged: boolean) => {
    if (date < '2026-10-26') return false; // no meal occurrence that far back
    if (logged) account.meals.add(`${date}:${meal}`);
    else account.meals.delete(`${date}:${meal}`);
    return true;
  },
  toggleMindStep: async (_u: string, id: string, step: string, done: boolean) => {
    const steps = account.occurrences.get(id)?.steps;
    if (!steps || !(step in steps)) return false;
    steps[step] = done;
    return true;
  },
}));
vi.mock('../services/recap-write.ts', () => ({
  writeRecapForReview: async (_u: string, review: PendingWeekReview, _unit: string, line?: string) => {
    account.recaps.push({ line });
    return { week_start: review.from };
  },
}));
vi.mock('../services/fact-review-trigger.ts', () => ({ maybeRunFactReview: async () => {} }));
vi.mock('../services/background.ts', () => ({ runInBackground: () => {} }));
// Only the ?week= read uses these, and no button here sends it; the real module drags in the db.
vi.mock('../services/progress-rhythm.ts', () => ({ addDaysIso: () => '', mondayOnOrBefore: () => '' }));
vi.mock('../services/plan-horizon.ts', () => ({
  DEFAULT_HORIZON_DAYS: 14,
  writtenAheadDays: (n: number) => n,
  ensureHorizon: async () => {},
}));

/** The slice of the web client's lib/api/plan.ts these screens use. */
interface WebPlanApi {
  buildNextWeek(): Promise<{ status: string }>;
  buildWeekAhead(): Promise<{ status: string; builtThrough?: string }>;
  dismissPendingWeekReview(): Promise<boolean>;
  confirmWeekReviewSession(occurrenceId: string, done: boolean, minutes?: number): Promise<boolean>;
  toggleWeekReviewMeal(date: string, meal: 'breakfast' | 'lunch' | 'dinner', logged: boolean): Promise<boolean>;
  toggleWeekReviewMindStep(occurrenceId: string, step: string, done: boolean): Promise<boolean>;
}
/** …and lib/api/recaps.ts, which "Confirm my week" calls first. */
interface WebRecapsApi {
  postWeekReviewRecap(line?: string): Promise<boolean>;
}

const { default: weekRoutes } = await import('./week.ts');
const { default: weekReviewRoutes } = await import('./week-review.ts');
let served: ClientAgainstRoutes<WebPlanApi>;
let web: WebPlanApi;
let recaps: WebRecapsApi;

beforeAll(async () => {
  served = await serveRoutesToWebClient<WebPlanApi>('plan.ts', (app) => {
    app.use('/plan', weekReviewRoutes);
    app.use('/plan/week', weekRoutes);
  });
  web = served.web;
  recaps = await served.load<WebRecapsApi>('recaps.ts');
});
afterAll(() => served.close());

beforeEach(() => {
  account.plan = true;
  account.checkin_due = true;
  account.built_through = null;
  account.pending_week_review = { from: '2026-10-26', to: '2026-11-01', built_at: '2026-11-01T18:00:00.000Z' };
  account.recaps = [];
  account.occurrences = new Map([
    ['run-1', { done: false }],
    ['med-1', { done: false, steps: { Breathe: false, 'Body scan': false } }],
  ]);
  account.meals = new Set();
});

describe('the end-of-week build buttons against routes/week.ts', () => {
  // EndOfTrailCard + useWeekGate: `(await buildNextWeek()).status === 'committed'` is success.
  it('"Just build my week" that lands reads as committed', async () => {
    expect(await web.buildNextWeek()).toMatchObject({ status: 'committed' });
  });

  it('a week that is not over yet comes back as not_due (a 409), not committed', async () => {
    account.checkin_due = false;
    expect((await web.buildNextWeek()).status).toBe('not_due');
  });

  it('with no plan, both builds say no_plan', async () => {
    account.plan = false;
    expect((await web.buildNextWeek()).status).toBe('no_plan');
    expect((await web.buildWeekAhead()).status).toBe('no_plan');
  });

  // Both screens read `built` OR `already_built` as success.
  it('"Build next week" ahead of the check-in reads as built, and a second tap as already_built', async () => {
    account.checkin_due = false;
    expect(await web.buildWeekAhead()).toMatchObject({ status: 'built', builtThrough: '2026-11-15' });
    expect(await web.buildWeekAhead()).toMatchObject({ status: 'already_built', builtThrough: '2026-11-15' });
  });

  it('building ahead once the week is over says due — that tap belongs to "Just build my week"', async () => {
    expect((await web.buildWeekAhead()).status).toBe('due');
  });
});

describe('the weekly check-in sheet against routes/week-review.ts', () => {
  it('a session confirmed with minutes lands and reads as landed', async () => {
    expect(await web.confirmWeekReviewSession('run-1', true, 35)).toBe(true);
    expect(account.occurrences.get('run-1')).toEqual({ done: true, minutes: 35 });
  });

  it('a session that is gone reads as not landed, so the sheet puts the row back', async () => {
    expect(await web.confirmWeekReviewSession('gone', true)).toBe(false);
  });

  it('a meal slot flips both ways, and a day with no meal row reads as not landed', async () => {
    expect(await web.toggleWeekReviewMeal('2026-10-28', 'lunch', true)).toBe(true);
    expect(account.meals.has('2026-10-28:lunch')).toBe(true);
    expect(await web.toggleWeekReviewMeal('2026-10-28', 'lunch', false)).toBe(true);
    expect(account.meals.size).toBe(0);
    expect(await web.toggleWeekReviewMeal('2026-10-01', 'lunch', true)).toBe(false);
  });

  it('a practice step flips, and a step that is not there reads as not landed', async () => {
    expect(await web.toggleWeekReviewMindStep('med-1', 'Body scan', true)).toBe(true);
    expect(account.occurrences.get('med-1')!.steps!['Body scan']).toBe(true);
    expect(await web.toggleWeekReviewMindStep('med-1', 'Chanting', true)).toBe(false);
  });

  it('"Confirm my week": the recap is written against the pending week, then the card is dismissed', async () => {
    expect(await recaps.postWeekReviewRecap('A steady week.')).toBe(true);
    expect(account.recaps).toEqual([{ line: 'A steady week.' }]);
    expect(await web.dismissPendingWeekReview()).toBe(true);
    expect(account.pending_week_review).toBeNull();
  });

  it('the recap after the card was dismissed reads as not landed — that is why it goes first', async () => {
    await web.dismissPendingWeekReview();
    expect(await recaps.postWeekReviewRecap()).toBe(false);
    expect(account.recaps).toEqual([]);
  });
});
