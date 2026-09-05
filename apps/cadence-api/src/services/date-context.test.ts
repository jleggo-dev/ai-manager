import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * The check-in fact this file adds to the daily date/time stamp (feat/coach-food-sources-tool's
 * sibling work, the late/empty check-in protocol): `computeWeekState` (plan-view.ts) already tells
 * the APP a check-in is due; before this, it never reached the COACH herself, so a session that was
 * merely restored — not reopened — carried no way to learn its plan week had ended, let alone that
 * it had ended a while ago or that nobody logged anything against it.
 *
 * These tests pin the new fact's shape rather than the pre-existing date/weather stamp (untouched,
 * and not worth re-testing here): silent with no plan, silent while the week still has days left,
 * and — once due — a day count for her own reasoning plus a second line exactly when the plan
 * week's own window has nothing done in it.
 */

const getUser = vi.fn();
const getActivePlan = vi.fn();
const listOccurrences = vi.fn();
const injectCoachContext = vi.fn();
const getWeatherForUser = vi.fn();

vi.mock('../repos/users.ts', () => ({ getUser: (...a: unknown[]) => getUser(...a) }));
vi.mock('../repos/plans.ts', () => ({ getActivePlan: (...a: unknown[]) => getActivePlan(...a) }));
vi.mock('../repos/occurrences.ts', () => ({ listOccurrences: (...a: unknown[]) => listOccurrences(...a) }));
vi.mock('../ai/aim.ts', () => ({ injectCoachContext: (...a: unknown[]) => injectCoachContext(...a) }));
// Weather is its own concern (untested here) — stubbed to the "no home location" branch so every
// test gets one predictable extra sentence instead of a network-shaped call.
vi.mock('./weather/weather.ts', () => ({
  getWeatherForUser: (...a: unknown[]) => getWeatherForUser(...a),
  formatWeatherLine: () => '(weather)',
  localDateIso: () => '2026-08-26',
  localTimeLabel: () => 'Wed 26 Aug, 12:00pm',
}));

const { ensureDateStamped, __clearDateStampForTests } = await import('./date-context.ts');

/** The one block this module ever injects, as plain text (or '' if nothing was injected). */
const injectedText = (): string => String(injectCoachContext.mock.calls[0]?.[2] ?? '');

const NOW = '2026-08-26T12:00:00.000Z'; // matches the session's "today" per currentDate context

/** A plan row shaped just enough for `computeWeekState` + the window query — `generated_at` is
 *  the only field either reads. */
const planGeneratedAt = (iso: string) => ({ plan_id: 'p1', generated_at: iso });

beforeEach(() => {
  vi.clearAllMocks();
  __clearDateStampForTests();
  vi.useFakeTimers();
  vi.setSystemTime(new Date(NOW));
  getUser.mockResolvedValue({ timezone: null, home_location: null });
  getWeatherForUser.mockResolvedValue(null);
  injectCoachContext.mockResolvedValue(undefined);
  listOccurrences.mockResolvedValue([]);
});

afterEach(() => {
  vi.useRealTimers();
});

/**
 * Facts, not picks (owner 2026-09-03): the no-home-location line used to be "ask once, warmly, if
 * outdoor plans come up" — it decided that she asks, when, and how. #382 replaced it with the fact
 * and the tool that closes it; this pins the replacement so the nudge cannot come back.
 */
describe('the no-home-location line', () => {
  it('states the fact and names the tool, and never tells her to ask', async () => {
    getActivePlan.mockResolvedValue(null);

    await ensureDateStamped('u1', 's1');

    const said = injectedText();
    expect(said).toMatch(/Home location is not set, so no weather is available/);
    expect(said).toMatch(/set_home_location/);
    expect(said).not.toMatch(/ask once/i);
    expect(said).not.toMatch(/warmly/i);
  });
});

describe('the check-in fact — absent when it does not apply', () => {
  it('says nothing about a check-in when the user has no active plan', async () => {
    getActivePlan.mockResolvedValue(null);

    await ensureDateStamped('u1', 's1');

    expect(injectCoachContext).toHaveBeenCalledTimes(1);
    expect(injectedText()).not.toMatch(/plan week|check-in|logged activity/i);
    expect(listOccurrences).not.toHaveBeenCalled();
  });

  it('says nothing while the plan week still has days left to run', async () => {
    // generated 2 days ago; a 7-day week still has 5 days on the clock.
    getActivePlan.mockResolvedValue(planGeneratedAt('2026-08-24T00:00:00.000Z'));

    await ensureDateStamped('u1', 's1');

    expect(injectedText()).not.toMatch(/plan week|check-in|logged activity/i);
    expect(listOccurrences).not.toHaveBeenCalled();
  });
});

describe('the check-in fact — once the week is due', () => {
  it('says the week ended "today" (never a count of zero) the day it becomes due', async () => {
    // generated 19 Aug → ends_on 26 Aug, exactly "now".
    getActivePlan.mockResolvedValue(planGeneratedAt('2026-08-19T00:00:00.000Z'));
    listOccurrences.mockResolvedValue([{ status: 'done' }]);

    await ensureDateStamped('u1', 's1');

    expect(injectedText()).toContain('Their plan week ended today; check-in not yet done.');
  });

  it('carries the exact day count once several days have passed — for her reasoning, never her mouth', async () => {
    // generated 9 Aug → ends_on 16 Aug → 10 days before "now" (26 Aug).
    getActivePlan.mockResolvedValue(planGeneratedAt('2026-08-09T00:00:00.000Z'));
    listOccurrences.mockResolvedValue([{ status: 'done' }]);

    await ensureDateStamped('u1', 's1');

    expect(injectedText()).toContain('Their plan week ended 10 days ago; check-in not yet done.');
  });

  it('singularizes exactly one day late', async () => {
    // ends_on 25 Aug → 1 day before "now".
    getActivePlan.mockResolvedValue(planGeneratedAt('2026-08-18T00:00:00.000Z'));
    listOccurrences.mockResolvedValue([{ status: 'done' }]);

    await ensureDateStamped('u1', 's1');

    expect(injectedText()).toContain('Their plan week ended 1 day ago; check-in not yet done.');
    expect(injectedText()).not.toContain('1 days ago');
  });

  it("queries exactly the plan week's own window, not some other range", async () => {
    getActivePlan.mockResolvedValue(planGeneratedAt('2026-08-09T00:00:00.000Z'));
    listOccurrences.mockResolvedValue([{ status: 'done' }]);

    await ensureDateStamped('u1', 's1');

    expect(listOccurrences).toHaveBeenCalledWith('u1', '2026-08-09', '2026-08-16');
  });
});

describe('the check-in fact — the empty week', () => {
  it('adds the empty-week line when nothing in the plan week is done', async () => {
    getActivePlan.mockResolvedValue(planGeneratedAt('2026-08-09T00:00:00.000Z'));
    listOccurrences.mockResolvedValue([{ status: 'pending' }, { status: 'pending' }, { status: 'missed' }]);

    await ensureDateStamped('u1', 's1');

    expect(injectedText()).toContain('Their plan week ended 10 days ago; check-in not yet done.');
    expect(injectedText()).toContain('Last week has no logged activity.');
  });

  it('omits the empty-week line the moment anything in the window is done', async () => {
    getActivePlan.mockResolvedValue(planGeneratedAt('2026-08-09T00:00:00.000Z'));
    listOccurrences.mockResolvedValue([{ status: 'pending' }, { status: 'done' }]);

    await ensureDateStamped('u1', 's1');

    expect(injectedText()).not.toContain('Last week has no logged activity.');
  });

  it('treats a plan with literally no occurrences yet as empty, not as an error', async () => {
    getActivePlan.mockResolvedValue(planGeneratedAt('2026-08-09T00:00:00.000Z'));
    listOccurrences.mockResolvedValue([]);

    await ensureDateStamped('u1', 's1');

    expect(injectedText()).toContain('Last week has no logged activity.');
  });
});

describe('the check-in fact — failure and re-stamp behaviour', () => {
  it('never blocks the date/weather stamp when the plan lookup fails', async () => {
    getActivePlan.mockRejectedValue(new Error('db down'));

    await ensureDateStamped('u1', 's1');

    expect(injectCoachContext).toHaveBeenCalledTimes(1);
    expect(injectedText()).toContain('Calendar day: 2026-08-26.');
    expect(injectedText()).not.toMatch(/check-in|logged activity/i);
  });

  it('re-stamps at most once per calendar day per session — the plan is not re-fetched on a second turn today', async () => {
    getActivePlan.mockResolvedValue(planGeneratedAt('2026-08-09T00:00:00.000Z'));
    listOccurrences.mockResolvedValue([{ status: 'done' }]);

    await ensureDateStamped('u1', 's1');
    await ensureDateStamped('u1', 's1');

    expect(injectCoachContext).toHaveBeenCalledTimes(1);
    expect(getActivePlan).toHaveBeenCalledTimes(1);
  });
});
