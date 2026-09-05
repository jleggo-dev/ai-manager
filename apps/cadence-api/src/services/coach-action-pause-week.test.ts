import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const getActiveEpisode = vi.fn();
const getActivePlan = vi.fn();
const enterEpisode = vi.fn();

vi.mock('../repos/episodes.ts', () => ({ getActiveEpisode: (...a: unknown[]) => getActiveEpisode(...a) }));
vi.mock('../repos/plans.ts', () => ({ getActivePlan: (...a: unknown[]) => getActivePlan(...a) }));
vi.mock('./episode.ts', () => ({ enterEpisode: (...a: unknown[]) => enterEpisode(...a) }));

import { PAUSE_WEEK } from './coach-action-pause-week.ts';

const USER = '00000000-0000-4000-a000-00000000c777';
/** Everything below is read against this day, so the dates in the table mean what they say. */
const TODAY = '2026-09-03';

/** The stored episode `enterEpisode` hands back for the happy path. */
const entered = (start: string, end: string) => ({
  episode: { episode_id: 'e1', type: 'custom', start, end },
  note: '',
});

describe('pause_week', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date(`${TODAY}T09:00:00.000Z`));
    getActiveEpisode.mockResolvedValue(null);
    getActivePlan.mockResolvedValue({ plan_id: 'p1' });
    enterEpisode.mockImplementation((_u: string, i: { start: string; end: string }) => entered(i.start, i.end));
  });
  afterEach(() => vi.useRealTimers());

  it('pauses the named stretch and says what is now true', async () => {
    const out = await PAUSE_WEEK.run(USER, { start: '2026-09-07', end: '2026-09-13', reason: 'funeral' });

    expect(enterEpisode).toHaveBeenCalledWith(USER, {
      type: 'custom',
      start: '2026-09-07',
      end: '2026-09-13',
      skipTempActivities: true,
      constraints: { paused: true, reason: 'funeral' },
    });
    expect(out).toBe(
      'Paused from 2026-09-07 to 2026-09-13: their scheduled sessions in that window are paused, nothing is ' +
        'deleted, and the rhythm resumes on 2026-09-14. Their plan is otherwise unchanged.',
    );
  });

  /** A pause is a detour with nothing overlaid — drafting lighter options would hand back the very
   *  thing the person asked not to have. */
  it('enters with NO temporary activities', async () => {
    await PAUSE_WEEK.run(USER, { end: '2026-09-09' });
    expect(enterEpisode.mock.calls[0]![1]).toMatchObject({ skipTempActivities: true });
  });

  it('starts today when no start is given, and stores no reason when none was said', async () => {
    await PAUSE_WEEK.run(USER, { end: '2026-09-09' });
    expect(enterEpisode).toHaveBeenCalledWith(
      USER,
      expect.objectContaining({ start: TODAY, constraints: { paused: true } }),
    );
  });

  /** enterEpisode reads a past start as today, so the sentence describes the stretch that EXISTS
   *  rather than the one that was asked for. */
  it('reports the stored dates, not the arguments', async () => {
    enterEpisode.mockResolvedValue(entered(TODAY, '2026-09-09'));
    const out = await PAUSE_WEEK.run(USER, { start: '2026-08-01', end: '2026-09-09' });
    expect(out).toContain(`Paused from ${TODAY} to 2026-09-09`);
    expect(out).not.toContain('2026-08-01');
  });

  it('does not delete anything — it never touches the plan editor', async () => {
    const out = await PAUSE_WEEK.run(USER, { end: '2026-09-09' });
    expect(out).toContain('nothing is deleted');
    expect(out).toContain('Their plan is otherwise unchanged');
  });

  /**
   * The table the router needs: a date that decides behaviour fails silently otherwise — the wrong
   * stretch gets paused and nothing throws. Positives AND near-misses, per the repo rule.
   */
  const REJECTIONS: Array<[name: string, params: Record<string, unknown>, expected: RegExp]> = [
    ['no end at all', {}, /no last paused day was given/],
    ['an end that is not a date', { end: 'next friday' }, /"next friday" is not a last paused day/],
    ['an end in the wrong shape', { end: '09/13/2026' }, /is not a last paused day/],
    ['a start that is not a date', { start: 'monday', end: '2026-09-09' }, /"monday" is not a start date/],
    ['an end before the start', { start: '2026-09-10', end: '2026-09-08' }, /is before the first paused day/],
    ['an end already past', { end: '2026-08-30' }, /has already passed/],
    ['a stretch over eight weeks', { end: '2026-11-30' }, /89 days, and this pauses at most 56 days/],
  ];

  for (const [name, params, expected] of REJECTIONS) {
    it(`refuses ${name}, and nothing is entered`, async () => {
      const out = await PAUSE_WEEK.run(USER, params);
      expect(out).toMatch(expected);
      expect(out).toMatch(/^Nothing was paused:/);
      expect(out).toContain('Their plan is unchanged.');
      expect(enterEpisode).not.toHaveBeenCalled();
    });
  }

  /** The near-misses on the same boundary: eight weeks exactly, and a one-day pause, both stand. */
  const ACCEPTED: Array<[name: string, params: Record<string, unknown>]> = [
    ['exactly eight weeks', { end: '2026-10-28' }],
    ['a single day', { start: TODAY, end: TODAY }],
    ['a start in the future', { start: '2026-10-01', end: '2026-10-07' }],
  ];

  for (const [name, params] of ACCEPTED) {
    it(`pauses ${name}`, async () => {
      const out = await PAUSE_WEEK.run(USER, params);
      expect(enterEpisode).toHaveBeenCalled();
      expect(out).toMatch(/^Paused from /);
    });
  }

  it('refuses while a detour is already running, and says which and when', async () => {
    getActiveEpisode.mockResolvedValue({ type: 'travel', start: '2026-09-01', end: '2026-09-06', constraints: {} });
    const out = await PAUSE_WEEK.run(USER, { end: '2026-09-09' });
    expect(out).toContain('a detour (travel) is already running from 2026-09-01 to 2026-09-06');
    expect(enterEpisode).not.toHaveBeenCalled();
  });

  it('names an open PAUSE as a pause, not as a detour', async () => {
    getActiveEpisode.mockResolvedValue({
      type: 'custom',
      start: '2026-09-01',
      end: '2026-09-06',
      constraints: { paused: true },
    });
    const out = await PAUSE_WEEK.run(USER, { end: '2026-09-09' });
    expect(out).toContain('a pause is already running from 2026-09-01 to 2026-09-06');
    expect(out).not.toContain('detour');
  });

  it('refuses when there is no committed plan to pause', async () => {
    getActivePlan.mockResolvedValue(null);
    const out = await PAUSE_WEEK.run(USER, { end: '2026-09-09' });
    expect(out).toContain('they have no committed plan');
    expect(enterEpisode).not.toHaveBeenCalled();
  });

  /** An honesty guard, not advice: a write that did not land must never read as one that did. */
  it('says the pause did not save when entering came back with nothing', async () => {
    enterEpisode.mockResolvedValue(null);
    const out = await PAUSE_WEEK.run(USER, { end: '2026-09-09' });
    expect(out).toContain('did not save');
    expect(out).toContain('Do not tell them it is done');
  });

  it('trims a very long reason rather than storing it whole', async () => {
    await PAUSE_WEEK.run(USER, { end: '2026-09-09', reason: 'x'.repeat(400) });
    const constraints = (enterEpisode.mock.calls[0]![1] as { constraints: { reason: string } }).constraints;
    expect(constraints.reason.length).toBe(200);
  });
});

describe('what pause_week tells the model about itself', () => {
  it('states its gate, teaches every parameter, and stays inside the action bound', () => {
    expect(PAUSE_WEEK.description).toMatch(/Takes effect immediately/);
    expect(PAUSE_WEEK.description).toMatch(/\bUse\b/);
    expect(PAUSE_WEEK.description.length).toBeLessThanOrEqual(800);
    for (const key of Object.keys(PAUSE_WEEK.parameters.properties)) {
      expect(PAUSE_WEEK.description, `"${key}" is never taught in the prose`).toContain(`"${key}"`);
    }
    expect(PAUSE_WEEK.parameters.required).toEqual(['end']);
  });

  /** Facts, not picks (owner red line): it may say what is true, never what she should offer. */
  it('never tells her what to say or suggest', () => {
    const prose = `${PAUSE_WEEK.description} ${Object.values(PAUSE_WEEK.parameters.properties)
      .map((p) => (p as { description?: string }).description ?? '')
      .join(' ')}`;
    expect(prose).not.toMatch(/suggest|offer them|tell them to|remind them to/i);
  });
});
