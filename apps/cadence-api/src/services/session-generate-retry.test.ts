/**
 * The transport-retry decision, as a table: which failures earn a second try, which fail at once,
 * how many tries there are, and the cap that stops the sheet spinning. A retry decision fails
 * silently in both directions — a retried 400 spends money on the same wrong call, an unretried
 * 503 is the outage reading as "broken" — so every row here is a positive OR a near-miss.
 */
import { describe, expect, it, vi } from 'vitest';
import { AimError } from '../ai/aim-errors.ts';
import {
  COACH_RETRY_DEFAULTS,
  CoachUnreachableError,
  isTransientCoachFailure,
  withCoachRetry,
} from './session-generate-retry.ts';

const FAILOVER_LINE =
  'Primary model "claude-sonnet-5" failed and failover "gemini-3.5-flash" on provider "Devs.ai" also failed: 400 model not found';

describe('isTransientCoachFailure — the decision table', () => {
  it.each<[string, unknown, boolean]>([
    // ── retry ──
    ['a provider 503 on the error object', Object.assign(new Error('down'), { status: 503 }), true],
    ['a 500 via statusCode', Object.assign(new Error('down'), { statusCode: 500 }), true],
    ['a 429', Object.assign(new Error('slow down'), { status: 429 }), true],
    [
      'a remote-path 502 folded into the message',
      new Error('AI Admin POST /api/processing-jobs/x/test → 502: Bad Gateway'),
      true,
    ],
    [
      'a remote-path 429 in the message',
      new Error('AI Admin POST /api/processing-jobs/x/test → 429: rate limited'),
      true,
    ],
    [
      'the remote-path timeout line',
      new Error('AI Admin POST /api/processing-jobs/x/test → timed out after 660s'),
      true,
    ],
    ['a bare timeout', new Error('Request timeout'), true],
    ['AI Admin’s failover-also-failed line', new Error(FAILOVER_LINE), true],
    ['the same line wrapped as an AimError (kind unknown)', AimError.fromUnknown(new Error(FAILOVER_LINE)), true],
    ['an AimError classified upstream', new AimError('upstream', 'provider unavailable'), true],
    ['a dropped socket', new Error('fetch failed'), true],
    ['ECONNRESET', new Error('read ECONNRESET'), true],
    ['a rate-limit code', new Error('MODEL_REQUEST_RATE_LIMIT_EXCEEDED'), true],
    ['an overloaded provider', new Error('Overloaded'), true],
    // ── do not retry ──
    ['our own 400 (bad payload)', Object.assign(new Error('bad request'), { status: 400 }), false],
    ['a 401', Object.assign(new Error('unauthorized'), { status: 401 }), false],
    ['a 404', Object.assign(new Error('not found'), { status: 404 }), false],
    ['a 422', Object.assign(new Error('unprocessable'), { status: 422 }), false],
    [
      'a remote-path 400 in the message',
      new Error('AI Admin POST /api/processing-jobs/x/test → 400: variables invalid'),
      false,
    ],
    [
      'an unsynced job',
      new AimError('not_found', 'AI Admin has no job with slug "prescribe-session" (is it synced?)'),
      false,
    ],
    ['a config fault', new AimError('config', 'AI_MANAGER_SUPABASE_URL missing'), false],
    ['a config AimError even when the text says timeout', new AimError('config', 'workspace missing (timeout)'), false],
    ['a bare 502 with no context (the old test’s shape)', new Error('502'), false],
    ['an unknown fault', new Error('something else'), false],
    ['a non-error throw', 'nope', false],
    ['null', null, false],
  ])('%s → %s', (_name, err, expected) => {
    expect(isTransientCoachFailure(err)).toBe(expected);
  });
});

/** A clock and a sleep that agree with each other, so the elapsed cap can be driven in a test. */
function fakeClock(start = 1_000_000) {
  let t = start;
  const sleeps: number[] = [];
  return {
    now: () => t,
    sleep: async (ms: number) => {
      sleeps.push(ms);
      t += ms;
    },
    advance: (ms: number) => {
      t += ms;
    },
    sleeps,
  };
}

const transient = () => Object.assign(new Error('AI Admin POST /x → 503: down'), { status: 503 });

describe('withCoachRetry — attempts, backoff and the cap', () => {
  it('returns the first success without sleeping', async () => {
    const clock = fakeClock();
    const fn = vi.fn().mockResolvedValue('ok');
    await expect(withCoachRetry(fn, clock)).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
    expect(clock.sleeps).toEqual([]);
  });

  it('a transient failure then a success opens without the person doing anything', async () => {
    const clock = fakeClock();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const fn = vi.fn().mockRejectedValueOnce(transient()).mockResolvedValue('ok');
    await expect(withCoachRetry(fn, { ...clock, label: 'prescribe-session' })).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
    expect(clock.sleeps).toEqual([COACH_RETRY_DEFAULTS.baseDelayMs]);
    // One line per failed attempt, numbered.
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toMatch(/^\[prescribe-session\] attempt 1\/3 failed/);
    warn.mockRestore();
  });

  it('backs off by doubling and gives up after the configured attempts', async () => {
    const clock = fakeClock();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const fn = vi.fn().mockRejectedValue(transient());
    const err = await withCoachRetry(fn, clock).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CoachUnreachableError);
    expect((err as CoachUnreachableError).attempts).toBe(COACH_RETRY_DEFAULTS.attempts);
    expect(fn).toHaveBeenCalledTimes(COACH_RETRY_DEFAULTS.attempts);
    expect(clock.sleeps).toEqual([1_500, 3_000]);
    vi.restoreAllMocks();
  });

  it('keeps the original fault as the cause, so the log says what actually happened', async () => {
    const clock = fakeClock();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const err = await withCoachRetry(() => Promise.reject(new Error(FAILOVER_LINE)), { ...clock, attempts: 1 }).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(CoachUnreachableError);
    expect((err as Error).message).toContain('also failed');
    vi.restoreAllMocks();
  });

  it('does not retry our own 4xx — the error passes through untouched on the first failure', async () => {
    const clock = fakeClock();
    const bad = Object.assign(new Error('AI Admin POST /x → 400: variables invalid'), { status: 400 });
    const fn = vi.fn().mockRejectedValue(bad);
    await expect(withCoachRetry(fn, clock)).rejects.toBe(bad);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(clock.sleeps).toEqual([]);
  });

  it('does not retry an unknown fault either', async () => {
    const clock = fakeClock();
    const fn = vi.fn().mockRejectedValue(new Error('something else'));
    await expect(withCoachRetry(fn, clock)).rejects.toThrow('something else');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('stops scheduling retries once the cap would be passed — a slow failure is not retried', async () => {
    const clock = fakeClock();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    // The first attempt itself took 19s (a long timeout) before failing transiently.
    const fn = vi.fn().mockImplementation(async () => {
      clock.advance(19_000);
      throw transient();
    });
    const err = await withCoachRetry(fn, clock).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CoachUnreachableError);
    expect((err as CoachUnreachableError).attempts).toBe(1);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(clock.sleeps).toEqual([]);
    vi.restoreAllMocks();
  });

  it('a fast failure well inside the cap still gets its retries', async () => {
    const clock = fakeClock();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const fn = vi.fn().mockImplementation(async () => {
      clock.advance(500);
      throw transient();
    });
    await withCoachRetry(fn, clock).catch(() => undefined);
    // 0.5s + 1.5s + 0.5s + 3s + 0.5s = 6s, all inside the 20s cap.
    expect(fn).toHaveBeenCalledTimes(3);
    vi.restoreAllMocks();
  });

  it('the defaults are the ones the owner was promised: 3 tries, under ~20s of waiting', () => {
    expect(COACH_RETRY_DEFAULTS).toEqual({ attempts: 3, baseDelayMs: 1_500, maxElapsedMs: 20_000 });
  });
});
