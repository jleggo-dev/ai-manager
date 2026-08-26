import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The retry-on-normalize-null contract (REQ10 §11's named gap, closed): a provider blip that
 * produces unusable output gets exactly ONE re-roll — enough to hide truncation and refusal
 * preambles, never enough to mask a real regression. Everything below the seam is mocked; these
 * tests are about the loop, not the model.
 */
vi.mock('../ai/aim.ts', () => ({ runJobBySlug: vi.fn() }));
vi.mock('./ai-log.ts', () => ({ logAi: vi.fn() }));
vi.mock('../repos/goals.ts', () => ({ listGoalsByStatus: vi.fn().mockResolvedValue([]) }));
vi.mock('../repos/equipment.ts', () => ({ listEquipment: vi.fn().mockResolvedValue([]) }));
vi.mock('../repos/users.ts', () => ({ getUser: vi.fn().mockResolvedValue(null) }));
vi.mock('./weather/weather.ts', () => ({
  getWeatherForUser: vi.fn().mockResolvedValue(null),
  isOutdoorActivity: () => false,
}));
vi.mock('../repos/occurrences.ts', () => ({
  getOccurrenceWithActivity: vi.fn(),
  listOccurrences: vi.fn().mockResolvedValue([]),
  listRecentLogsByTitle: vi.fn().mockResolvedValue([]),
  getAnchorSessionByTitle: vi.fn().mockResolvedValue(null),
  setOccurrenceSessionIfEmpty: vi.fn().mockResolvedValue(true),
  setOccurrenceWeatherIfEmpty: vi.fn().mockResolvedValue(true),
}));

import { runJobBySlug } from '../ai/aim.ts';
import { getOccurrenceWithActivity } from '../repos/occurrences.ts';
import { listOccurrences } from '../repos/occurrences.ts';
import { getOccurrenceDetail, prefetchImminentSessions } from './session-generate.ts';

const GOOD = JSON.stringify({
  blocks: [{ label: 'Practice', items: [{ name: 'Settle', tool: 'breathing', breath_pattern: 'box' }] }],
  note: 'ok',
});

const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);

function pendingOccurrence() {
  return {
    occurrence_id: 'o1',
    activity_id: 'a1',
    date: tomorrow,
    status: 'pending',
    kind: 'user',
    title: 'Morning practice',
    category: 'mind',
    schedule: null,
    target: null,
    how_to: null,
    goal_id: null,
    session: null,
    log: null,
    weather: null,
  };
}

beforeEach(() => {
  vi.mocked(runJobBySlug).mockReset();
  vi.mocked(getOccurrenceWithActivity).mockResolvedValue(pendingOccurrence() as never);
});

describe('prescribe retry-on-normalize-null', () => {
  it('does not retry when the first output is usable', async () => {
    vi.mocked(runJobBySlug).mockResolvedValue({ raw: GOOD } as never);
    const occ = await getOccurrenceDetail('u1', 'o1');
    expect(occ?.session?.blocks).toHaveLength(1);
    expect(runJobBySlug).toHaveBeenCalledTimes(1);
  });

  it('re-rolls exactly once when the first output does not survive normalization', async () => {
    vi.mocked(runJobBySlug)
      .mockResolvedValueOnce({ raw: 'Sure! Here is a session for you…' } as never)
      .mockResolvedValueOnce({ raw: GOOD } as never);
    const occ = await getOccurrenceDetail('u1', 'o1');
    expect(occ?.session?.blocks).toHaveLength(1);
    expect(runJobBySlug).toHaveBeenCalledTimes(2);
  });

  it('stops after two rejections — the regenerate-on-next-open path owns persistent failure', async () => {
    vi.mocked(runJobBySlug).mockResolvedValue({ raw: 'not json' } as never);
    const occ = await getOccurrenceDetail('u1', 'o1');
    expect(occ?.session ?? null).toBeNull();
    expect(runJobBySlug).toHaveBeenCalledTimes(2);
  });

  it('a provider error still propagates — the retry is for bad output, not for transport', async () => {
    vi.mocked(runJobBySlug).mockRejectedValue(new Error('502'));
    await expect(getOccurrenceDetail('u1', 'o1')).rejects.toThrow('502');
    expect(runJobBySlug).toHaveBeenCalledTimes(1);
  });
});

/**
 * The prefetch has to WIN A RACE, and it was built so that losing was inevitable.
 *
 * `prefetchImminentSessions` is void-fired from `GET /plan` so a generating session is already warm
 * when the user taps it. Each generation is one coach call — 34s measured 2026-08-20, the longest
 * wait left in the app — and the loop awaited them one at a time, so every occurrence it warmed
 * made it later for the next. With three pending, the last was not warm for a minute and a half.
 *
 * Asserted as PEAK IN-FLIGHT, never elapsed time. A wall-clock assertion measures the machine as
 * much as the code and flakes the moment another suite runs beside it — a lesson `plan-view.test.ts`
 * already paid for once.
 */
describe('prefetchImminentSessions', () => {
  const occ = (n: number, status = 'pending', kind = 'user', has_session = false) =>
    Array.from({ length: n }, (_, i) => ({ occurrence_id: `o${i}`, status, kind, has_session, date: tomorrow }));

  /** Counts concurrency at the only place real work happens: the coach call. */
  function trackingJob() {
    const state = { inflight: 0, peak: 0 };
    vi.mocked(runJobBySlug).mockImplementation((() => {
      state.inflight += 1;
      state.peak = Math.max(state.peak, state.inflight);
      return new Promise((r) =>
        setTimeout(() => {
          state.inflight -= 1;
          r({ raw: GOOD });
        }, 15),
      );
    }) as never);
    return state;
  }

  beforeEach(() => {
    vi.mocked(getOccurrenceWithActivity).mockImplementation((async (_u: string, id: string) => ({
      ...pendingOccurrence(),
      occurrence_id: id,
    })) as never);
  });

  it('warms several sessions at once instead of one after another', async () => {
    const state = trackingJob();
    vi.mocked(listOccurrences).mockResolvedValue(occ(6) as never);

    await prefetchImminentSessions('u1');

    // Serial execution can never exceed 1. Above it proves the batch opened together.
    expect(state.peak).toBeGreaterThan(1);
    expect(runJobBySlug).toHaveBeenCalledTimes(6);
  });

  /**
   * Bounded, not unbounded. Every slot is a real provider call, and the entire gemini family was
   * rate-limited at once on 2026-08-20 — an unbounded fan-out from every GET /plan is how you do
   * that to the coach.
   */
  it('never opens more than the cap at once', async () => {
    const state = trackingJob();
    vi.mocked(listOccurrences).mockResolvedValue(occ(12) as never);

    await prefetchImminentSessions('u1');
    expect(state.peak).toBeLessThanOrEqual(3);
  });

  it('leaves occurrences that are not pending alone', async () => {
    trackingJob();
    vi.mocked(listOccurrences).mockResolvedValue([...occ(2), ...occ(3, 'done')] as never);

    await prefetchImminentSessions('u1');
    expect(runJobBySlug).toHaveBeenCalledTimes(2);
  });

  /**
   * A `system` row (Log breakfast, weigh-in) never generates — getOccurrenceDetail's own gate
   * rejects it — but before this filter it still occupied a batch slot, delaying the real
   * generations behind it for nothing.
   */
  it('never spends a batch slot on a system row', async () => {
    trackingJob();
    vi.mocked(listOccurrences).mockResolvedValue([...occ(2), ...occ(3, 'pending', 'system')] as never);

    await prefetchImminentSessions('u1');
    expect(runJobBySlug).toHaveBeenCalledTimes(2);
  });

  /**
   * `has_session` makes re-running the prefetch on every plan load affordable: a fully-warm week
   * is one list query and zero per-row reads — which is what lets the window cover the whole
   * visible week instead of two days.
   */
  it('skips rows whose session is already cached without reading them', async () => {
    trackingJob();
    vi.mocked(getOccurrenceWithActivity).mockClear(); // counts accumulate — no clearMocks in config
    vi.mocked(listOccurrences).mockResolvedValue([...occ(2), ...occ(4, 'pending', 'user', true)] as never);

    await prefetchImminentSessions('u1');
    expect(runJobBySlug).toHaveBeenCalledTimes(2);
    expect(getOccurrenceWithActivity).toHaveBeenCalledTimes(2);
  });

  /** Best-effort: one failed generation must not stop the rest from warming. */
  it('keeps going when one generation fails', async () => {
    let n = 0;
    vi.mocked(runJobBySlug).mockImplementation((() => {
      n += 1;
      return n === 2 ? Promise.reject(new Error('502')) : Promise.resolve({ raw: GOOD });
    }) as never);
    vi.mocked(listOccurrences).mockResolvedValue(occ(5) as never);

    await expect(prefetchImminentSessions('u1')).resolves.toBeUndefined();
    expect(runJobBySlug).toHaveBeenCalledTimes(5);
  });
});
