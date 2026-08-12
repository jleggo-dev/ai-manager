/**
 * API-P2 — situation assess gate (weekly interval, pending proposal, tripwire→Broker).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const getUser = vi.fn();
const setPendingProposal = vi.fn();
const touchAssessedAt = vi.fn();
const getActivePlan = vi.fn();
const listOccurrences = vi.fn();
const getLastDoneOccurrenceDate = vi.fn();
const getActiveEpisode = vi.fn();
const getLastCheckInDate = vi.fn();
const runJobBySlug = vi.fn();
const detectTripwires = vi.fn();
const rollingConsistency = vi.fn();

vi.mock('../repos/users.ts', () => ({
  getUser: (...a: unknown[]) => getUser(...a),
  setPendingProposal: (...a: unknown[]) => setPendingProposal(...a),
  touchAssessedAt: (...a: unknown[]) => touchAssessedAt(...a),
}));
vi.mock('../repos/plans.ts', () => ({
  getActivePlan: (...a: unknown[]) => getActivePlan(...a),
}));
vi.mock('../repos/occurrences.ts', () => ({
  listOccurrences: (...a: unknown[]) => listOccurrences(...a),
  getLastDoneOccurrenceDate: (...a: unknown[]) => getLastDoneOccurrenceDate(...a),
}));
vi.mock('../repos/episodes.ts', () => ({
  getActiveEpisode: (...a: unknown[]) => getActiveEpisode(...a),
}));
vi.mock('../repos/check-ins.ts', () => ({
  getLastCheckInDate: (...a: unknown[]) => getLastCheckInDate(...a),
}));
vi.mock('../ai/aim.ts', () => ({
  runJobBySlug: (...a: unknown[]) => runJobBySlug(...a),
}));
vi.mock('../config.ts', () => ({
  // Minimal: the services no longer read config, but their repos' import chain reaches
  // db/sql.ts, whose module scope builds the DB URL and throws without CADENCE_* env (CI).
  cadenceConfig: {
    databaseUrl: 'postgresql://mock:mock@mock:5432/mock',
    supabase: { url: '', anonKey: '', serviceRoleKey: '' },
    aim: {},
  },
}));
vi.mock('./tripwires.ts', () => ({
  detectTripwires: (...a: unknown[]) => detectTripwires(...a),
}));
vi.mock('./metrics.ts', () => ({
  rollingConsistency: (...a: unknown[]) => rollingConsistency(...a),
}));
vi.mock('./weather/weather.ts', () => ({
  getWeatherForUser: vi.fn().mockResolvedValue(null),
}));

import { assessIfDue } from './situation.ts';
import { getWeatherForUser } from './weather/weather.ts';

// The missed-count block below runs against the REAL detector: what matters there is whether the
// coach decides someone is falling off, and asserting a bare missedCount number would still pass
// if the comparison against the threshold moved out from under it.
const { detectTripwires: realDetectTripwires } =
  await vi.importActual<typeof import('./tripwires.ts')>('./tripwires.ts');

const USER = '00000000-0000-4000-a000-00000000a201';
const getWeatherForUserMock = getWeatherForUser as unknown as ReturnType<typeof vi.fn>;

describe('assessIfDue', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
    rollingConsistency.mockReturnValue({ kept: 5, window: 7 });
    listOccurrences.mockResolvedValue([]);
    getActivePlan.mockResolvedValue({ plan_id: 'p1' });
    getActiveEpisode.mockResolvedValue(null);
    getLastDoneOccurrenceDate.mockResolvedValue(null);
    getLastCheckInDate.mockResolvedValue(null);
    touchAssessedAt.mockResolvedValue(undefined);
    setPendingProposal.mockResolvedValue(undefined);
    getWeatherForUserMock.mockResolvedValue(null);
  });

  it('no-ops when user missing, pending proposal outstanding, or no plan', async () => {
    getUser.mockResolvedValueOnce(null);
    await assessIfDue(USER);
    expect(touchAssessedAt).not.toHaveBeenCalled();

    getUser.mockResolvedValueOnce({ pending_proposal: { reason: 'x' }, last_assessed_at: null });
    await assessIfDue(USER);
    expect(getActivePlan).not.toHaveBeenCalled();

    getUser.mockResolvedValueOnce({ pending_proposal: null, last_assessed_at: null, steer_back: null });
    getActivePlan.mockResolvedValueOnce(null);
    await assessIfDue(USER);
    expect(touchAssessedAt).not.toHaveBeenCalled();
  });

  it('skips when last assessed within 7 days', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-20T12:00:00.000Z'));
    getUser.mockResolvedValue({
      pending_proposal: null,
      last_assessed_at: '2026-07-18T12:00:00.000Z',
      steer_back: null,
    });
    await assessIfDue(USER);
    expect(getActivePlan).not.toHaveBeenCalled();
    expect(touchAssessedAt).not.toHaveBeenCalled();
  });

  it('advances the gate without Broker when no tripwires fire', async () => {
    getUser.mockResolvedValue({ pending_proposal: null, last_assessed_at: null, steer_back: null });
    detectTripwires.mockReturnValue([]);
    await assessIfDue(USER);
    expect(touchAssessedAt).toHaveBeenCalledWith(USER);
    expect(runJobBySlug).not.toHaveBeenCalled();
    expect(setPendingProposal).not.toHaveBeenCalled();
  });

  it('stores a pending proposal when Broker recommends a re-plan', async () => {
    getUser.mockResolvedValue({ pending_proposal: null, last_assessed_at: null, steer_back: null });
    detectTripwires.mockReturnValue(['missed_streak']);
    runJobBySlug.mockResolvedValue({
      formatted: JSON.stringify({
        recommend_replan: true,
        reason: 'Missed several days',
        suggested_levers: ['ease volume', 42],
      }),
    });
    await assessIfDue(USER);
    expect(runJobBySlug).toHaveBeenCalledWith(USER, 'situation-assess', expect.any(Object));
    expect(setPendingProposal).toHaveBeenCalledWith(
      USER,
      expect.objectContaining({
        reason: 'Missed several days',
        suggested_levers: ['ease volume'],
      }),
    );
  });

  it('does not store a proposal when Broker says no re-plan', async () => {
    getUser.mockResolvedValue({ pending_proposal: null, last_assessed_at: null, steer_back: null });
    detectTripwires.mockReturnValue(['dip']);
    runJobBySlug.mockResolvedValue({ formatted: JSON.stringify({ recommend_replan: false }) });
    await assessIfDue(USER);
    expect(setPendingProposal).not.toHaveBeenCalled();
  });

  it('proposes a detour on return after a dark gap (Req 4 on-return), before touching the Broker', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-15T12:00:00.000Z'));
    getUser.mockResolvedValue({ pending_proposal: null, last_assessed_at: null, steer_back: null });
    getLastDoneOccurrenceDate.mockResolvedValue('2026-07-10'); // 5 dark days
    await assessIfDue(USER);
    expect(setPendingProposal).toHaveBeenCalledWith(
      USER,
      expect.objectContaining({ action: 'enter_disrupted', episode_type: 'custom' }),
    );
    expect(runJobBySlug).not.toHaveBeenCalled();
  });

  it('proposes a re-baseline (not a detour) on return after a LONG gap', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-15T12:00:00.000Z'));
    getUser.mockResolvedValue({ pending_proposal: null, last_assessed_at: null, steer_back: null });
    getLastDoneOccurrenceDate.mockResolvedValue('2026-07-05'); // 10 dark days
    await assessIfDue(USER);
    expect(setPendingProposal).toHaveBeenCalledWith(USER, expect.objectContaining({ action: 'rebaseline' }));
    expect(runJobBySlug).not.toHaveBeenCalled();
  });

  it('does not propose an on-return detour for a short gap', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-15T12:00:00.000Z'));
    getUser.mockResolvedValue({ pending_proposal: null, last_assessed_at: null, steer_back: null });
    getLastDoneOccurrenceDate.mockResolvedValue('2026-07-13'); // 2 days — not a gap
    detectTripwires.mockReturnValue([]);
    await assessIfDue(USER);
    expect(setPendingProposal).not.toHaveBeenCalled();
  });

  it('skips the on-return detour when already on a detour', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-15T12:00:00.000Z'));
    getUser.mockResolvedValue({ pending_proposal: null, last_assessed_at: null, steer_back: null });
    getActiveEpisode.mockResolvedValue({ episode_id: 'e1' });
    getLastDoneOccurrenceDate.mockResolvedValue('2026-07-01'); // long gap, but already detouring
    detectTripwires.mockReturnValue([]);
    await assessIfDue(USER);
    expect(setPendingProposal).not.toHaveBeenCalled();
  });

  it('proposes a travel detour when the Broker recommends enter_disrupted', async () => {
    getUser.mockResolvedValue({ pending_proposal: null, last_assessed_at: null, steer_back: null });
    detectTripwires.mockReturnValue(['timezone_shift']);
    runJobBySlug.mockResolvedValue({
      formatted: JSON.stringify({ enter_disrupted: true, reason: 'Looks like you are traveling' }),
    });
    await assessIfDue(USER);
    expect(setPendingProposal).toHaveBeenCalledWith(
      USER,
      expect.objectContaining({
        action: 'enter_disrupted',
        episode_type: 'travel',
        reason: 'Looks like you are traveling',
      }),
    );
  });

  it('passes weatherTempC into the tripwire snapshot when weather is available', async () => {
    getUser.mockResolvedValue({
      pending_proposal: null,
      last_assessed_at: null,
      steer_back: { missed_threshold: 3 },
      home_location: { lat: 40.7, lon: -74.0 },
      timezone: 'UTC',
    });
    getWeatherForUserMock.mockResolvedValue({
      tempC: 40,
      feelsLikeC: 42,
      windKph: 10,
      conditions: 'clear',
      precipMm: 0,
      precipChance: null,
      source: 'openweathermap',
      fetchedAt: '2026-07-25T12:00:00.000Z',
    });
    detectTripwires.mockReturnValue([]);
    await assessIfDue(USER);
    expect(detectTripwires).toHaveBeenCalledWith(expect.objectContaining({ weatherTempC: 40 }));
  });

  /**
   * missedCount — the derived "they're falling off" signal. Nothing writes status 'missed', so it
   * means past-due-and-still-pending, and it must only count EFFORTFUL work (kind 'user'). The food
   * log is four per-meal SYSTEM tasks a day; counting those made the tripwire fire for every
   * nutrition user after one forgetful day, and permanently for anyone who skips a meal on purpose.
   */
  describe('missedCount counts effortful work only', () => {
    const TODAY = '2026-07-20';
    const MEALS = ['Breakfast', 'Lunch', 'Dinner', 'Snack'];

    /** Every per-meal system task for the 13 past days in the window, all untapped: 52 rows. */
    const untappedMealTasks = () =>
      Array.from({ length: 13 }, (_, i) => `2026-07-${String(7 + i).padStart(2, '0')}`).flatMap((date) =>
        MEALS.map((title) => ({ date, title, kind: 'system' as const, status: 'pending' })),
      );

    /** `n` past-due effortful sessions the user did not do. */
    const skippedSessions = (n: number) =>
      Array.from({ length: n }, (_, i) => ({
        date: `2026-07-${String(7 + i).padStart(2, '0')}`,
        kind: 'user' as const,
        status: 'pending',
      }));

    const brokerCalled = () => runJobBySlug.mock.calls.length > 0;

    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date(`${TODAY}T12:00:00.000Z`));
      detectTripwires.mockImplementation(realDetectTripwires);
      getUser.mockResolvedValue({
        pending_proposal: null,
        last_assessed_at: null,
        steer_back: { missed_threshold: 3 },
      });
      runJobBySlug.mockResolvedValue({ formatted: JSON.stringify({ recommend_replan: false }) });
    });

    it('does not trip for a nutrition user who never taps their meal cards', async () => {
      listOccurrences.mockResolvedValue([
        ...untappedMealTasks(),
        { date: '2026-07-17', kind: 'user', status: 'done' },
        { date: '2026-07-19', kind: 'user', status: 'done' },
      ]);
      await assessIfDue(USER);
      expect(detectTripwires).toHaveBeenCalledWith(expect.objectContaining({ missedCount: 0 }));
      expect(brokerCalled()).toBe(false);
    });

    it('still trips when the user is genuinely skipping sessions', async () => {
      // The same 52 untapped meal cards ride along: system noise must neither add to the count nor
      // mask a real slip.
      listOccurrences.mockResolvedValue([...untappedMealTasks(), ...skippedSessions(4)]);
      await assessIfDue(USER);
      expect(detectTripwires).toHaveBeenCalledWith(expect.objectContaining({ missedCount: 4 }));
      expect(brokerCalled()).toBe(true);
    });

    it('holds at the threshold boundary — 2 skipped sessions stay quiet, 3 speak up', async () => {
      listOccurrences.mockResolvedValue(skippedSessions(2));
      await assessIfDue(USER);
      expect(detectTripwires).toHaveBeenCalledWith(expect.objectContaining({ missedCount: 2 }));
      expect(brokerCalled()).toBe(false);

      detectTripwires.mockClear();
      runJobBySlug.mockClear();
      listOccurrences.mockResolvedValue(skippedSessions(3));
      await assessIfDue(USER);
      expect(detectTripwires).toHaveBeenCalledWith(expect.objectContaining({ missedCount: 3 }));
      expect(brokerCalled()).toBe(true);
    });

    it("does not count today's still-open sessions — the day isn't over yet", async () => {
      listOccurrences.mockResolvedValue(
        Array.from({ length: 5 }, () => ({ date: TODAY, kind: 'user', status: 'pending' })),
      );
      await assessIfDue(USER);
      expect(detectTripwires).toHaveBeenCalledWith(expect.objectContaining({ missedCount: 0 }));
      expect(brokerCalled()).toBe(false);
    });
  });
});
