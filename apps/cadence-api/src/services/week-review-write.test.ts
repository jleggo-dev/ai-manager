import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Every write here is a read-then-write over a mocked `repos/occurrences.ts` — no real DB. The
 * thing worth pinning is the MERGE: `correctOccurrenceLog` overwrites whichever column it's given,
 * whole, so these tests assert the exact merged payload each call sends, not just that a call
 * happened (that's the bug class `correct_log`'s own comment names: a correction that names one
 * field erasing the rest).
 */
vi.mock('../repos/occurrences.ts', () => ({
  getOccurrenceWithActivity: vi.fn(),
  setOccurrenceStatus: vi.fn(),
  correctOccurrenceLog: vi.fn(),
  findMealOccurrence: vi.fn(),
}));

import {
  correctOccurrenceLog,
  findMealOccurrence,
  getOccurrenceWithActivity,
  setOccurrenceStatus,
} from '../repos/occurrences.ts';
import { confirmSession, toggleMealSlot, toggleMindStep } from './week-review-write.ts';

function occWithActivity(over: Record<string, unknown>) {
  return {
    occurrence_id: 'o1',
    activity_id: 'a1',
    date: '2026-08-24',
    status: 'pending',
    title: 'Easy run',
    kind: 'user',
    schedule: {},
    ...over,
  };
}

beforeEach(() => {
  vi.mocked(getOccurrenceWithActivity).mockReset();
  vi.mocked(setOccurrenceStatus).mockReset().mockResolvedValue(undefined);
  vi.mocked(correctOccurrenceLog).mockReset().mockResolvedValue(undefined);
  vi.mocked(findMealOccurrence).mockReset();
});

describe('confirmSession', () => {
  it("returns false without writing anything when the occurrence is not this user's", async () => {
    vi.mocked(getOccurrenceWithActivity).mockResolvedValue(null);
    const ok = await confirmSession('u1', 'o1', { done: true });
    expect(ok).toBe(false);
    expect(setOccurrenceStatus).not.toHaveBeenCalled();
    expect(correctOccurrenceLog).not.toHaveBeenCalled();
  });

  it('a fresh pending confirm with no minutes is a bare status write', async () => {
    vi.mocked(getOccurrenceWithActivity).mockResolvedValue(occWithActivity({ status: 'pending' }) as never);
    await confirmSession('u1', 'o1', { done: true });
    expect(setOccurrenceStatus).toHaveBeenCalledWith('u1', 'o1', 'done', undefined);
    expect(correctOccurrenceLog).not.toHaveBeenCalled();
  });

  it('a fresh pending confirm WITH minutes writes the whole value column directly (it is empty)', async () => {
    vi.mocked(getOccurrenceWithActivity).mockResolvedValue(occWithActivity({ status: 'pending' }) as never);
    await confirmSession('u1', 'o1', { done: true, minutes: 42 });
    expect(setOccurrenceStatus).toHaveBeenCalledWith('u1', 'o1', 'done', { duration_min: 42 });
    expect(correctOccurrenceLog).not.toHaveBeenCalled();
  });

  it('a fresh pending row marked not-done is skipped, not corrected', async () => {
    vi.mocked(getOccurrenceWithActivity).mockResolvedValue(occWithActivity({ status: 'pending' }) as never);
    await confirmSession('u1', 'o1', { done: false });
    expect(setOccurrenceStatus).toHaveBeenCalledWith('u1', 'o1', 'skipped');
    expect(correctOccurrenceLog).not.toHaveBeenCalled();
  });

  it("re-editing an already-done row's minutes merges into the stored value, never replaces it", async () => {
    vi.mocked(getOccurrenceWithActivity).mockResolvedValue(
      occWithActivity({
        status: 'done',
        value: { distance_km: 8, duration_min: 30 },
        log: { items: [], summary: '30 duration min, 8 distance km', raw_text: 'x', logged_at: 't' },
      }) as never,
    );
    await confirmSession('u1', 'o1', { done: true, minutes: 45 });
    expect(setOccurrenceStatus).not.toHaveBeenCalled();
    expect(correctOccurrenceLog).toHaveBeenCalledWith('u1', 'o1', {
      status: 'done',
      value: { distance_km: 8, duration_min: 45 },
      log: { items: [], summary: '8 distance km, 45 duration min', raw_text: 'x', logged_at: 't' },
    });
  });

  it('re-editing minutes on an already-done row with no log skips the log field entirely', async () => {
    vi.mocked(getOccurrenceWithActivity).mockResolvedValue(
      occWithActivity({ status: 'done', value: { duration_min: 30 }, log: null }) as never,
    );
    await confirmSession('u1', 'o1', { done: true, minutes: 45 });
    expect(correctOccurrenceLog).toHaveBeenCalledWith('u1', 'o1', {
      status: 'done',
      value: { duration_min: 45 },
    });
  });

  it('flipping an already-decided row to not-done is a status-only correction', async () => {
    vi.mocked(getOccurrenceWithActivity).mockResolvedValue(
      occWithActivity({ status: 'done', value: { duration_min: 30 } }) as never,
    );
    await confirmSession('u1', 'o1', { done: false });
    expect(correctOccurrenceLog).toHaveBeenCalledWith('u1', 'o1', { status: 'skipped' });
  });
});

describe('toggleMealSlot', () => {
  it('marks the found occurrence done', async () => {
    vi.mocked(findMealOccurrence).mockResolvedValue({ occurrence_id: 'meal-1', status: 'pending' });
    const ok = await toggleMealSlot('u1', '2026-08-24', 'lunch', true);
    expect(ok).toBe(true);
    expect(setOccurrenceStatus).toHaveBeenCalledWith('u1', 'meal-1', 'done');
  });

  it('marks the found occurrence pending when un-logged', async () => {
    vi.mocked(findMealOccurrence).mockResolvedValue({ occurrence_id: 'meal-1', status: 'done' });
    await toggleMealSlot('u1', '2026-08-24', 'lunch', false);
    expect(setOccurrenceStatus).toHaveBeenCalledWith('u1', 'meal-1', 'pending');
  });

  it('returns false and writes nothing when there is no per-meal row for that day', async () => {
    vi.mocked(findMealOccurrence).mockResolvedValue(null);
    const ok = await toggleMealSlot('u1', '2026-08-24', 'lunch', true);
    expect(ok).toBe(false);
    expect(setOccurrenceStatus).not.toHaveBeenCalled();
  });
});

describe('toggleMindStep', () => {
  const withSession = (over: Record<string, unknown> = {}) =>
    occWithActivity({
      status: 'pending',
      session: { blocks: [{ label: 'Practice', items: [{ name: 'Settle' }, { name: 'Breathe' }] }] },
      log: null,
      ...over,
    });

  it('seeds a fresh checklist from the session when there is no log yet', async () => {
    vi.mocked(getOccurrenceWithActivity).mockResolvedValue(withSession() as never);
    await toggleMindStep('u1', 'o1', 'Settle', true);
    expect(correctOccurrenceLog).toHaveBeenCalledWith(
      'u1',
      'o1',
      expect.objectContaining({
        log: expect.objectContaining({
          items: [
            { name: 'Settle', done: true },
            { name: 'Breathe', done: false },
          ],
        }),
        status: 'pending', // one of two steps done — not all-done yet
      }),
    );
  });

  it('sets status done once every named step is done', async () => {
    vi.mocked(getOccurrenceWithActivity).mockResolvedValue(
      withSession({
        log: {
          items: [
            { name: 'Settle', done: true },
            { name: 'Breathe', done: false },
          ],
          summary: '',
          raw_text: '',
          logged_at: 't',
        },
      }) as never,
    );
    await toggleMindStep('u1', 'o1', 'Breathe', true);
    const [, , payload] = vi.mocked(correctOccurrenceLog).mock.calls[0]!;
    expect(payload.status).toBe('done');
  });

  it('reverts status to pending when a step un-flips from all-done', async () => {
    vi.mocked(getOccurrenceWithActivity).mockResolvedValue(
      withSession({
        status: 'done',
        log: {
          items: [
            { name: 'Settle', done: true },
            { name: 'Breathe', done: true },
          ],
          summary: '',
          raw_text: '',
          logged_at: 't',
        },
      }) as never,
    );
    await toggleMindStep('u1', 'o1', 'Breathe', false);
    const [, , payload] = vi.mocked(correctOccurrenceLog).mock.calls[0]!;
    expect(payload.status).toBe('pending');
  });

  it('leaves a non-done, non-all-done status alone (e.g. skipped stays skipped)', async () => {
    vi.mocked(getOccurrenceWithActivity).mockResolvedValue(
      withSession({
        status: 'skipped',
        log: {
          items: [
            { name: 'Settle', done: false },
            { name: 'Breathe', done: false },
          ],
          summary: '',
          raw_text: '',
          logged_at: 't',
        },
      }) as never,
    );
    await toggleMindStep('u1', 'o1', 'Settle', true);
    const [, , payload] = vi.mocked(correctOccurrenceLog).mock.calls[0]!;
    expect(payload.status).toBe('skipped');
  });

  it('folds in a step the session names that the existing log never recorded', async () => {
    vi.mocked(getOccurrenceWithActivity).mockResolvedValue(
      withSession({
        session: {
          blocks: [{ label: 'Practice', items: [{ name: 'Settle' }, { name: 'Breathe' }, { name: 'New step' }] }],
        },
        log: {
          items: [
            { name: 'Settle', done: true },
            { name: 'Breathe', done: false },
          ],
          summary: '',
          raw_text: '',
          logged_at: 't',
        },
      }) as never,
    );
    await toggleMindStep('u1', 'o1', 'New step', true);
    const [, , payload] = vi.mocked(correctOccurrenceLog).mock.calls[0]!;
    expect(payload.log!.items).toEqual([
      { name: 'Settle', done: true },
      { name: 'Breathe', done: false },
      { name: 'New step', done: true },
    ]);
  });

  it('returns false without writing when the occurrence has no named session items', async () => {
    vi.mocked(getOccurrenceWithActivity).mockResolvedValue(occWithActivity({ session: null, log: null }) as never);
    const ok = await toggleMindStep('u1', 'o1', 'Settle', true);
    expect(ok).toBe(false);
    expect(correctOccurrenceLog).not.toHaveBeenCalled();
  });

  it('returns false without writing when the named step does not exist on this occurrence', async () => {
    vi.mocked(getOccurrenceWithActivity).mockResolvedValue(withSession() as never);
    const ok = await toggleMindStep('u1', 'o1', 'Nonexistent step', true);
    expect(ok).toBe(false);
    expect(correctOccurrenceLog).not.toHaveBeenCalled();
  });

  it("returns false when the occurrence is not this user's", async () => {
    vi.mocked(getOccurrenceWithActivity).mockResolvedValue(null);
    const ok = await toggleMindStep('u1', 'o1', 'Settle', true);
    expect(ok).toBe(false);
  });
});
