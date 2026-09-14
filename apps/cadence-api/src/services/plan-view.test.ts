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
vi.mock('../repos/activities.ts', () => ({
  listActivities: (...a: unknown[]) => q.listActivities(...a),
  // Mirrors activities.ts's real values — kept in sync by hand since this mock replaces the module.
  NON_PLAN_CATEGORIES: new Set(['adhoc', 'episode', 'menu']),
}));
vi.mock('../repos/users.ts', () => ({ getUser: (...a: unknown[]) => q.getUser(...a) }));
vi.mock('../repos/conversations.ts', () => ({
  getLatestConversation: (...a: unknown[]) => q.getLatestConversation(...a),
}));
vi.mock('../repos/occurrences.ts', () => ({
  listOccurrences: (...a: unknown[]) => q.listOccurrences(...a),
  listSessionStepCounts: (...a: unknown[]) => q.listSessionStepCounts(...a),
}));
// The top-up (2026-09-14) is the one write this view makes; the pure helpers beside it stay real.
const ensureHorizon = vi.fn();
vi.mock('./plan-horizon.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./plan-horizon.ts')>()),
  ensureHorizon: (...a: unknown[]) => ensureHorizon(...a),
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
  ensureHorizon.mockResolvedValue(0);
});

/** Today in the fixtures' zone, shifted by whole days — the same arithmetic the view does. */
async function todayPlus(days: number): Promise<string> {
  const { planDayBase } = await import('./plan-day.ts');
  return new Date(planDayBase(new Date(), 'America/Toronto', null) + days * 86_400_000).toISOString().slice(0, 10);
}

/**
 * The calendar is always written past the view (owner, 2026-09-14: "we should always have the
 * 2nd week loaded"). The hole this closes: a week wrote 7 days at its commit, the check-in day was
 * day 7, and "Confirm my week" reset the clock without committing — the owner confirmed at 07:26
 * and opened a plan with nothing on today or any day after. The view now reads a week past what
 * it shows and writes the missing days itself, quietly: only when the far week is empty.
 */
describe('buildPlanView — the calendar is always written past the view', () => {
  const DAILY = {
    activity_id: 'a1',
    kind: 'system',
    title: 'Log breakfast',
    schedule: { recurrence: 'FREQ=DAILY', time_of_day: '08:00' },
  };
  const row = (date: string) => ({ occurrence_id: `o-${date}`, activity_id: 'a1', date, status: 'pending' });

  it('reads through the view plus a week, and writes the missing days when the far week is empty', async () => {
    q.listActivities.mockImplementation(slow([DAILY]));
    // Written only through the day after tomorrow — the confirm-day shape.
    q.listOccurrences.mockImplementation(
      slow([row(await todayPlus(0)), row(await todayPlus(1)), row(await todayPlus(2))]),
    );
    ensureHorizon.mockResolvedValue(11);

    await buildPlanView(USER, 7, 'America/Toronto');

    expect(q.listOccurrences).toHaveBeenCalledWith(USER, await todayPlus(0), await todayPlus(14));
    expect(ensureHorizon).toHaveBeenCalledWith(USER, 14);
    // The window read, the trailing week, and the re-read after the write.
    expect(q.listOccurrences).toHaveBeenCalledTimes(3);
  });

  it('stays quiet when the far week already holds a row — the ordinary load costs no write', async () => {
    q.listActivities.mockImplementation(slow([DAILY]));
    q.listOccurrences.mockImplementation(slow([row(await todayPlus(0)), row(await todayPlus(10))]));

    await buildPlanView(USER, 7, 'America/Toronto');

    expect(ensureHorizon).not.toHaveBeenCalled();
    expect(q.listOccurrences).toHaveBeenCalledTimes(2);
  });

  it('never asks a plan with nothing that repeats to write — it would only ask again next load', async () => {
    q.listActivities.mockImplementation(slow([{ ...DAILY, schedule: { time_of_day: '08:00' } }]));

    await buildPlanView(USER, 7, 'America/Toronto');

    expect(ensureHorizon).not.toHaveBeenCalled();
  });

  it("renders what was written when the write fails — a top-up is never the screen's own risk", async () => {
    q.listActivities.mockImplementation(slow([DAILY]));
    q.listOccurrences.mockImplementation(slow([row(await todayPlus(0))]));
    ensureHorizon.mockRejectedValue(new Error('db down'));

    const view = await buildPlanView(USER, 7, 'America/Toronto');

    expect(view.hasPlan).toBe(true);
    expect(view.week[0]?.occurrences).toHaveLength(1);
  });

  it('only the ACTIVE plan’s rows count as "written" — a superseded version’s leftovers do not', async () => {
    q.listActivities.mockImplementation(slow([DAILY]));
    q.listOccurrences.mockImplementation(
      slow([row(await todayPlus(0)), { ...row(await todayPlus(10)), activity_id: 'old-version-row' }]),
    );

    await buildPlanView(USER, 7, 'America/Toronto');

    expect(ensureHorizon).toHaveBeenCalledWith(USER, 14);
  });
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
    expect(withPlan.weekState).toEqual({
      ends_on: expect.any(String),
      checkin_due: expect.any(Boolean),
      started_on: expect.any(String),
      built_through: null,
    });

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

  /**
   * Due by DAY, in the user's zone (2026-09-14). It used to be due at the exact instant — clock +
   * 7×24h — while the trail puts the check-in node and the "wraps up today" card on `ends_on` the
   * moment that day dawns; a week that began at 09:00 spent the check-in's whole morning with the
   * screen saying "check in today" and the server saying "still running".
   */
  describe('is due from the first moment of ends_on in their zone, not from the clock’s own hour', () => {
    const TZ = 'America/Toronto';
    // Mon 7 Sep, 09:00 in Montréal.
    const WEEK = { week_started_at: '2026-09-07T13:00:00.000Z', generated_at: '2026-09-07T13:00:00.000Z' };

    it.each([
      // [label, now (UTC instant), due?]
      ['23:00 local the evening before → not due', '2026-09-14T03:00:00.000Z', false],
      ['07:26 local on the due day, hours before the clock’s own 09:00 → due', '2026-09-14T11:26:00.000Z', true],
      ['the clock’s own hour on the due day → due', '2026-09-14T13:00:00.000Z', true],
      ['a week later, still unhandled → due', '2026-09-21T11:00:00.000Z', true],
    ])('%s', (_label, nowIso, want) => {
      const state = computeWeekState(WEEK, TZ, new Date(nowIso));
      expect(state?.ends_on).toBe('2026-09-14');
      expect(state?.checkin_due).toBe(want);
    });

    it('names the week’s days in THEIR zone: a 20:52 Montréal start began that evening, not the UTC morning after', () => {
      const state = computeWeekState(
        { generated_at: '2026-09-02T00:52:00.000Z' },
        TZ,
        new Date('2026-09-02T12:00:00.000Z'),
      );
      expect(state?.started_on).toBe('2026-09-01');
      expect(state?.ends_on).toBe('2026-09-08');
    });

    it('with no zone falls back to UTC days — the behaviour every caller had', () => {
      const state = computeWeekState(
        { generated_at: '2026-09-02T00:52:00.000Z' },
        null,
        new Date('2026-09-09T00:00:00.000Z'),
      );
      expect(state?.started_on).toBe('2026-09-02');
      expect(state?.ends_on).toBe('2026-09-09');
      expect(state?.checkin_due).toBe(true);
    });
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

/**
 * The week clock (0058, owner 2026-09-07: "I still have never been prompted for a weekly
 * check-in"). Every commit refreshes `generated_at`, so a plan the user keeps editing was never
 * 7 days old. `week_started_at` is what the commit carries forward; it — not `generated_at` —
 * is the clock. Each row: the two columns disagree, and the state must follow the clock.
 */
describe('computeWeekState — the week clock beats generated_at', () => {
  const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();

  it.each([
    // [week_started_at, generated_at, horizon, due?] — the case that was broken: edited today, week began 8 days ago
    ['carried clock 8 days old, plan re-generated today → due', daysAgo(8), daysAgo(0), 7, true],
    ['carried clock exactly 7 days old → due', daysAgo(7), daysAgo(0), 7, true],
    [
      'carried clock 6 days old, generated 20 days ago → not due (the clock, not the row, decides)',
      daysAgo(6),
      daysAgo(20),
      7,
      false,
    ],
    ['fresh clock (a check-in exit just reset it) → not due even on an old row', daysAgo(0), daysAgo(30), 7, false],
    ['extended week: clock 10 days old on a 14-day horizon → not due', daysAgo(10), daysAgo(0), 14, false],
    ['extended week: clock 14 days old on a 14-day horizon → due', daysAgo(14), daysAgo(0), 14, true],
  ])('%s', (_label, week_started_at, generated_at, horizon_days, due) => {
    expect(computeWeekState({ week_started_at, generated_at, horizon_days })?.checkin_due).toBe(due);
  });

  it('ends_on counts from the week clock, never from generated_at', () => {
    const state = computeWeekState({
      week_started_at: '2026-08-01T12:00:00.000Z',
      generated_at: '2026-08-05T09:00:00.000Z',
    });
    expect(state?.ends_on).toBe('2026-08-08');
  });

  it.each([
    ['null (a row from before 0058) falls back to generated_at', null],
    ['undefined (a partial plan object) falls back to generated_at', undefined],
  ])('%s', (_label, week_started_at) => {
    const state = computeWeekState({ week_started_at, generated_at: '2026-08-01T12:00:00.000Z' });
    expect(state?.ends_on).toBe('2026-08-08');
  });

  it('survives the clock arriving as a Date rather than the string the type promises', () => {
    const state = computeWeekState({
      week_started_at: new Date('2026-08-01T12:00:00.000Z') as unknown as string,
      generated_at: '2026-08-05T09:00:00.000Z',
    });
    expect(state?.ends_on).toBe('2026-08-08');
  });
});

/**
 * The days behind the wall carry the rhythm as a preview (plan-preview.ts, owner 2026-09-09):
 * a week materializes once at its commit, so from day two the seven-day view runs past what was
 * written. Those days are locked on the trail and must show what they would hold — never as rows
 * with ids, never on an open day, never on a day that already has its own rows.
 */
describe('buildPlanView — the preview behind the wall', () => {
  const DAILY = {
    activity_id: 'a1',
    commitment_id: 'c1',
    plan_id: 'p1',
    title: 'Morning sit',
    kind: 'user',
    schedule: { recurrence: 'FREQ=DAILY', time_of_day: '07:00' },
    goal_id: 'g1',
  };
  const OFF_PLAN = { ...DAILY, activity_id: 'a2', commitment_id: 'c2', title: 'Off-plan', category: 'adhoc' };
  /** A week that began three days ago: `ends_on` is four days out, so a 7-day view has two days past it. */
  const MID_WEEK = { ...PLAN, generated_at: new Date(Date.now() - 3 * 86_400_000).toISOString() };

  it('projects the rhythm onto the days after ends_on, and nowhere before it', async () => {
    q.getActivePlan.mockImplementation(slow(MID_WEEK));
    q.listActivities.mockImplementation(slow([DAILY, OFF_PLAN]));
    q.listGoals.mockImplementation(slow([{ goal_id: 'g1', area: 'mind' }]));

    const view = await buildPlanView(USER, 7, 'America/Toronto');
    const endsOn = view.weekState!.ends_on;
    const behind = view.week.filter((d) => d.date > endsOn);
    const open = view.week.filter((d) => d.date <= endsOn);

    expect(behind.length).toBeGreaterThan(0);
    for (const day of behind) {
      expect(day.preview).toEqual([{ title: 'Morning sit', time_of_day: '07:00', area: 'mind' }]);
      expect(day.occurrences).toEqual([]);
    }
    for (const day of open) expect(day.preview).toBeUndefined();
  });

  it('leaves a day alone when it already carries rows of its own', async () => {
    q.getActivePlan.mockImplementation(slow(MID_WEEK));
    q.listActivities.mockImplementation(slow([DAILY]));
    const lastDate = new Date(Date.now() + 6 * 86_400_000).toISOString().slice(0, 10);
    q.listOccurrences.mockImplementation(
      slow([{ occurrence_id: 'o9', activity_id: 'a1', date: lastDate, status: 'pending', kind: 'user' }]),
    );

    const view = await buildPlanView(USER, 7, 'America/Toronto');
    const last = view.week.find((d) => d.date === lastDate);

    expect(last?.occurrences.map((o) => o.occurrence_id)).toEqual(['o9']);
    expect(last?.preview).toBeUndefined();
  });

  it('a week built early (built_through) pushes the wall out — nothing projected through that date', async () => {
    q.listActivities.mockImplementation(slow([DAILY]));
    const builtThrough = new Date(Date.now() + 5 * 86_400_000).toISOString().slice(0, 10);
    q.getActivePlan.mockImplementation(slow({ ...MID_WEEK, built_through: builtThrough }));

    const view = await buildPlanView(USER, 7, 'America/Toronto');

    expect(view.weekState?.built_through).toBe(builtThrough);
    for (const day of view.week) {
      if (day.date <= builtThrough) expect(day.preview).toBeUndefined();
      else expect(day.preview).toHaveLength(1);
    }
  });

  it('projects nothing on a week that began today — every day in view is still open', async () => {
    q.listActivities.mockImplementation(slow([DAILY]));
    q.getActivePlan.mockImplementation(slow({ ...PLAN, generated_at: new Date().toISOString() }));

    const view = await buildPlanView(USER, 7, 'America/Toronto');

    expect(view.week.every((d) => d.preview === undefined)).toBe(true);
  });
});
