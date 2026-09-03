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
  setOccurrenceWeatherIfEmpty: vi.fn().mockResolvedValue(true),
}));
vi.mock('../repos/occurrence-sessions.ts', () => ({
  clearOccurrenceSession: vi.fn().mockResolvedValue(true),
  setOccurrenceSessionIfEmpty: vi.fn().mockResolvedValue(true),
}));
// All three exports, not just the one this file drives: repertoire-practice.ts imports the other
// two, and a mock missing an export makes that import throw at load.
vi.mock('../repos/repertoire.ts', () => ({
  listRepertoire: vi.fn().mockResolvedValue([]),
  stampPracticed: vi.fn().mockResolvedValue(undefined),
  clearPendingSessionsForGoal: vi.fn().mockResolvedValue(0),
}));

import { runJobBySlug } from '../ai/aim.ts';
import { listGoalsByStatus } from '../repos/goals.ts';
import { getOccurrenceWithActivity, listRecentLogsByTitle } from '../repos/occurrences.ts';
import { clearOccurrenceSession, setOccurrenceSessionIfEmpty } from '../repos/occurrence-sessions.ts';
import { listOccurrences } from '../repos/occurrences.ts';
import { listRepertoire } from '../repos/repertoire.ts';
import { getOccurrenceDetail, prefetchImminentSessions, reviseSession } from './session-generate.ts';

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
 * A practice session is built from the shelf, so the prompt is handed the WHOLE shelf as facts and
 * she chooses (owner ruling 2026-09-03). Four variables used to name the picks for her —
 * `warmup_pick`, `next_rested`, `learning`, `up_next_top` — and they are gone; `repertoire` is the
 * one variable now. It is empty for a goal with no shelf of its own (an empty tag the template
 * ignores, so a gym session's prompt is unchanged) and carries the fault sentence, never an empty
 * string, when the read broke.
 */
describe('the prescribe prompt is handed the whole shelf', () => {
  const row = (label: string, status: string, extra: Record<string, unknown> = {}) => ({
    item_id: label,
    user_id: 'u1',
    goal_id: 'g-piano',
    label,
    status,
    kind: 'piece',
    meta: null,
    started_at: '2026-06-01T00:00:00.000Z',
    learned_at: null,
    last_practiced_at: null,
    ...extra,
  });

  const SHELF = [
    row('Arietta', 'known'), // never worked — a fact on its line, no longer a pick
    row('Écossaise (Hummel)', 'known', { last_practiced_at: '2026-08-20T18:00:00.000Z' }),
    row('Hungarian Folk Song', 'working'),
    row('Melody (Schumann)', 'queued'),
    row('Cradle Song', 'retired'),
  ];

  const varsOfLastCall = () => vi.mocked(runJobBySlug).mock.calls.at(-1)?.[2] as Record<string, string>;

  beforeEach(() => {
    vi.mocked(runJobBySlug).mockResolvedValue({ raw: GOOD } as never);
    vi.mocked(listRepertoire).mockResolvedValue([] as never);
  });

  it('sends every item on the shelf, whatever its standing', async () => {
    vi.mocked(listGoalsByStatus).mockResolvedValueOnce([{ goal_id: 'g-piano', area: 'practice' }] as never);
    vi.mocked(getOccurrenceWithActivity).mockResolvedValue({ ...pendingOccurrence(), goal_id: 'g-piano' } as never);
    vi.mocked(listRepertoire).mockResolvedValueOnce(SHELF as never);

    await getOccurrenceDetail('u1', 'o1');

    const vars = varsOfLastCall();
    for (const label of SHELF.map((r) => r.label)) expect(vars.repertoire).toContain(label);
  });

  /**
   * The near-miss, and the reason this test exists at all: the four variables it replaces would
   * still be BUILT if a merge put the old spread back, and nothing would throw — the prompt would
   * simply start naming picks again. Asserting their absence at the call boundary catches that.
   */
  it('sends ONE repertoire variable — no warm-up, swap, Learning or Up-next pick rides along', async () => {
    vi.mocked(listGoalsByStatus).mockResolvedValueOnce([{ goal_id: 'g-piano', area: 'practice' }] as never);
    vi.mocked(getOccurrenceWithActivity).mockResolvedValue({ ...pendingOccurrence(), goal_id: 'g-piano' } as never);
    vi.mocked(listRepertoire).mockResolvedValueOnce(SHELF as never);

    await getOccurrenceDetail('u1', 'o1');

    const vars = varsOfLastCall();
    for (const gone of ['warmup_pick', 'next_rested', 'learning', 'up_next_top']) {
      expect(vars, `${gone} names a pick and must not be sent`).not.toHaveProperty(gone);
    }
    expect(vars.repertoire).not.toMatch(/DUE NEXT|longest rest|rested longest/i);
  });

  it('sends it empty for a goal whose shelf holds nothing of its own', async () => {
    vi.mocked(listGoalsByStatus).mockResolvedValueOnce([{ goal_id: 'g-gym', area: 'movement' }] as never);
    vi.mocked(getOccurrenceWithActivity).mockResolvedValue({ ...pendingOccurrence(), goal_id: 'g-gym' } as never);
    // Unlinked items reach practice-area goals only; these are the piano goal's.
    vi.mocked(listRepertoire).mockResolvedValueOnce(SHELF as never);

    await getOccurrenceDetail('u1', 'o1');

    expect(varsOfLastCall().repertoire).toBe('');
  });

  it('says the shelf could not be read, rather than sending an empty one', async () => {
    vi.mocked(listGoalsByStatus).mockResolvedValueOnce([{ goal_id: 'g-piano', area: 'practice' }] as never);
    vi.mocked(getOccurrenceWithActivity).mockResolvedValue({ ...pendingOccurrence(), goal_id: 'g-piano' } as never);
    vi.mocked(listRepertoire).mockRejectedValueOnce(new Error('db down'));

    await getOccurrenceDetail('u1', 'o1');

    expect(varsOfLastCall().repertoire).toContain('NOT an empty record');
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

/**
 * Rung 1 of the plan-change ladder (docs/cadence/PLAN-CHANGES.md): "add chest and abs to today's
 * workout" is one prescription with the user's words as steer, never a plan re-synthesis. The
 * contract under test: clear BEFORE generate (the write is compare-and-set on empty), the steer
 * reaches the job, the single-flight map is shared with first-open generation, and the same gates
 * hold (user-kind, still pending, today or later).
 */
describe('reviseSession', () => {
  beforeEach(() => {
    // Counts accumulate across tests (no clearMocks in config) — start each test from zero.
    vi.mocked(clearOccurrenceSession).mockClear().mockResolvedValue(true);
    vi.mocked(setOccurrenceSessionIfEmpty).mockClear().mockResolvedValue(true);
  });

  it('clears the stored session BEFORE generating — the write only lands into empty', async () => {
    const order: string[] = [];
    vi.mocked(clearOccurrenceSession).mockImplementation((async () => {
      order.push('clear');
      return true;
    }) as never);
    vi.mocked(runJobBySlug).mockImplementation((async () => {
      order.push('generate');
      return { raw: GOOD };
    }) as never);

    const result = await reviseSession('u1', 'o1', 'add chest and abs');
    expect(order).toEqual(['clear', 'generate']);
    expect(result.status).toBe('revised');
    expect(setOccurrenceSessionIfEmpty).toHaveBeenCalledWith('u1', 'o1', expect.objectContaining({ note: 'ok' }));
  });

  it('hands the steer to the job, in their words', async () => {
    vi.mocked(runJobBySlug).mockResolvedValue({ raw: GOOD } as never);
    await reviseSession('u1', 'o1', '  add chest and abs  ');
    expect(runJobBySlug).toHaveBeenCalledWith(
      'u1',
      'prescribe-session',
      expect.objectContaining({ user_steer: 'add chest and abs' }),
    );
  });

  it('leaves every existing caller unsteered — a first-open generation sends an empty steer', async () => {
    vi.mocked(runJobBySlug).mockResolvedValue({ raw: GOOD } as never);
    await getOccurrenceDetail('u1', 'o1');
    expect(runJobBySlug).toHaveBeenCalledWith('u1', 'prescribe-session', expect.objectContaining({ user_steer: '' }));
  });

  it('goes to the coach call even for a goal in template mode — arithmetic cannot hear the steer', async () => {
    vi.mocked(listGoalsByStatus).mockResolvedValueOnce([
      { goal_id: 'g1', plan_mode: 'deterministic', title: 'Get strong', area: 'movement' },
    ] as never);
    vi.mocked(listRecentLogsByTitle).mockResolvedValueOnce([
      { date: '2026-08-20', log: { summary: 'done', items: [] } },
    ] as never);
    vi.mocked(getOccurrenceWithActivity).mockResolvedValue({
      ...pendingOccurrence(),
      goal_id: 'g1',
      target: { scheme: 'linear' },
    } as never);
    vi.mocked(runJobBySlug).mockResolvedValue({ raw: GOOD } as never);

    const result = await reviseSession('u1', 'o1', 'add chest and abs');
    expect(result.status).toBe('revised');
    expect(runJobBySlug).toHaveBeenCalledTimes(1);
  });

  it('shares the single-flight map — a tap racing the revise joins the steered generation', async () => {
    let release: (v: { raw: string }) => void = () => {};
    vi.mocked(runJobBySlug).mockReturnValue(new Promise((r) => (release = r)) as never);

    const revising = reviseSession('u1', 'o1', 'add chest and abs');
    await vi.waitFor(() => expect(runJobBySlug).toHaveBeenCalledTimes(1));
    const tapped = getOccurrenceDetail('u1', 'o1');

    release({ raw: GOOD });
    const [revised, detail] = await Promise.all([revising, tapped]);
    expect(runJobBySlug).toHaveBeenCalledTimes(1); // one coach call, both callers served
    expect(revised.status).toBe('revised');
    expect(detail?.session?.note).toBe('ok');
  });

  it('waits out a generation already in flight instead of clearing under it', async () => {
    const order: string[] = [];
    let release: (v: { raw: string }) => void = () => {};
    vi.mocked(runJobBySlug)
      .mockReturnValueOnce(
        new Promise((r) => {
          release = (v) => {
            order.push('first-generation-landed');
            r(v);
          };
        }) as never,
      )
      .mockImplementationOnce((async () => {
        order.push('steered-generation');
        return { raw: GOOD };
      }) as never);
    vi.mocked(clearOccurrenceSession).mockImplementation((async () => {
      order.push('clear');
      return true;
    }) as never);

    const opening = getOccurrenceDetail('u1', 'o1'); // a first-open generation, mid-flight
    await vi.waitFor(() => expect(runJobBySlug).toHaveBeenCalledTimes(1));
    const revising = reviseSession('u1', 'o1', 'add chest and abs');

    release({ raw: GOOD });
    await Promise.all([opening, revising]);
    expect(order).toEqual(['first-generation-landed', 'clear', 'steered-generation']);
  });

  it('enforces the same gates as first-open generation, spending nothing on refused rows', async () => {
    const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
    const cases = [
      { occ: null, status: 'not_found' },
      { occ: { ...pendingOccurrence(), kind: 'system' }, status: 'not_revisable', reason: 'system_row' },
      { occ: { ...pendingOccurrence(), status: 'done' }, status: 'not_revisable', reason: 'not_pending' },
      { occ: { ...pendingOccurrence(), date: yesterday }, status: 'not_revisable', reason: 'past' },
    ] as const;
    for (const c of cases) {
      vi.mocked(getOccurrenceWithActivity).mockResolvedValueOnce(c.occ as never);
      const result = await reviseSession('u1', 'o1', 'add chest and abs');
      expect(result.status).toBe(c.status);
      if ('reason' in c && result.status === 'not_revisable') expect(result.reason).toBe(c.reason);
    }
    expect(clearOccurrenceSession).not.toHaveBeenCalled();
    expect(runJobBySlug).not.toHaveBeenCalled();
  });

  it('a clear refused in SQL (logged done under the race) reports, never generates into a wall', async () => {
    vi.mocked(clearOccurrenceSession).mockResolvedValueOnce(false);
    vi.mocked(getOccurrenceWithActivity)
      .mockResolvedValueOnce(pendingOccurrence() as never) // the gate read
      .mockResolvedValueOnce({ ...pendingOccurrence(), status: 'done' } as never); // the re-read
    const result = await reviseSession('u1', 'o1', 'add chest and abs');
    expect(result.status).toBe('not_revisable');
    expect(runJobBySlug).not.toHaveBeenCalled();
  });

  it('an unusable rebuild says failed and writes nothing', async () => {
    vi.mocked(runJobBySlug).mockResolvedValue({ raw: 'not json' } as never);
    const result = await reviseSession('u1', 'o1', 'add chest and abs');
    expect(result.status).toBe('failed');
    expect(setOccurrenceSessionIfEmpty).not.toHaveBeenCalled();
  });

  it('a lost write race returns what actually landed, one consistent session', async () => {
    vi.mocked(runJobBySlug).mockResolvedValue({ raw: GOOD } as never);
    vi.mocked(setOccurrenceSessionIfEmpty).mockResolvedValueOnce(false);
    const landed = { blocks: [], note: 'what landed', generated_at: 'x', version: 1 };
    vi.mocked(getOccurrenceWithActivity)
      .mockResolvedValueOnce(pendingOccurrence() as never)
      .mockResolvedValueOnce({ ...pendingOccurrence(), session: landed } as never);
    const result = await reviseSession('u1', 'o1', 'add chest and abs');
    expect(result.status).toBe('revised');
    if (result.status === 'revised') expect(result.session.note).toBe('what landed');
  });
});
