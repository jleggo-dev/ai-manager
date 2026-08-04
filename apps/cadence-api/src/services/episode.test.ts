import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const getActivePlan = vi.fn();
const listActivities = vi.fn();
const insertActivities = vi.fn();
const getActiveEpisode = vi.fn();
const insertEpisode = vi.fn();
const endActiveEpisode = vi.fn();
const pauseUserOccurrencesInWindow = vi.fn();
const restorePausedOccurrencesFrom = vi.fn();
const insertTempOccurrences = vi.fn();
const deleteFutureTempOccurrences = vi.fn();
const getUser = vi.fn();
const setPendingProposal = vi.fn();
const runJobBySlug = vi.fn();

vi.mock('../repos/plans.ts', () => ({ getActivePlan: (...a: unknown[]) => getActivePlan(...a) }));
vi.mock('../repos/users.ts', () => ({
  getUser: (...a: unknown[]) => getUser(...a),
  setPendingProposal: (...a: unknown[]) => setPendingProposal(...a),
}));
vi.mock('../repos/activities.ts', () => ({
  EPISODE_CATEGORY: 'episode',
  listActivities: (...a: unknown[]) => listActivities(...a),
  insertActivities: (...a: unknown[]) => insertActivities(...a),
}));
vi.mock('../repos/episodes.ts', () => ({
  getActiveEpisode: (...a: unknown[]) => getActiveEpisode(...a),
  insertEpisode: (...a: unknown[]) => insertEpisode(...a),
  endActiveEpisode: (...a: unknown[]) => endActiveEpisode(...a),
}));
vi.mock('../repos/occurrences.ts', () => ({
  pauseUserOccurrencesInWindow: (...a: unknown[]) => pauseUserOccurrencesInWindow(...a),
  restorePausedOccurrencesFrom: (...a: unknown[]) => restorePausedOccurrencesFrom(...a),
  insertTempOccurrences: (...a: unknown[]) => insertTempOccurrences(...a),
  deleteFutureTempOccurrences: (...a: unknown[]) => deleteFutureTempOccurrences(...a),
}));
vi.mock('../ai/aim.ts', () => ({ runJobBySlug: (...a: unknown[]) => runJobBySlug(...a) }));

import { enterEpisode, endEpisode } from './episode.ts';

const USER = '00000000-0000-4000-a000-00000000c101';

describe('enterEpisode', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-15T09:00:00.000Z'));
    getActiveEpisode.mockResolvedValue(null);
    getActivePlan.mockResolvedValue({ plan_id: 'p1' });
    listActivities.mockResolvedValue([]);
    runJobBySlug.mockResolvedValue({
      formatted: JSON.stringify({
        temp_activities: [{ title: 'Hotel circuit', kind: 'user', schedule: { recurrence: 'FREQ=DAILY' } }],
        note: 'Keep it light.',
      }),
    });
    insertEpisode.mockResolvedValue({ episode_id: 'e1', type: 'travel', start: '2026-07-15', end: '2026-07-22' });
    insertActivities.mockResolvedValue([{ activity_id: 'ta1', schedule: { recurrence: 'FREQ=DAILY' } }]);
    pauseUserOccurrencesInWindow.mockResolvedValue(3);
    insertTempOccurrences.mockResolvedValue(undefined);
  });
  afterEach(() => vi.useRealTimers());

  it('returns the existing active episode without entering a second', async () => {
    getActiveEpisode.mockResolvedValue({ episode_id: 'old', type: 'illness', start: 'x', end: 'y' });
    const r = await enterEpisode(USER, { type: 'travel' });
    expect(r?.episode.episode_id).toBe('old');
    expect(insertEpisode).not.toHaveBeenCalled();
    expect(pauseUserOccurrencesInWindow).not.toHaveBeenCalled();
  });

  it('returns null when there is no committed plan to overlay', async () => {
    getActivePlan.mockResolvedValue(null);
    expect(await enterEpisode(USER, { type: 'travel' })).toBeNull();
    expect(insertEpisode).not.toHaveBeenCalled();
  });

  it('pauses the base window and materializes the episode-tagged temp options', async () => {
    const r = await enterEpisode(USER, { type: 'travel', days: 7 });
    expect(pauseUserOccurrencesInWindow).toHaveBeenCalledWith(USER, '2026-07-15', '2026-07-22');
    expect(insertActivities).toHaveBeenCalledWith(
      USER,
      'p1',
      expect.arrayContaining([expect.objectContaining({ title: 'Hotel circuit', category: 'episode' })]),
    );
    // Every materialized temp occurrence is tagged with the episode id.
    const rows = insertTempOccurrences.mock.calls[0]![0] as Array<Record<string, unknown>>;
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((row) => row.episode_id === 'e1' && row.activity_id === 'ta1')).toBe(true);
    expect(r?.episode.episode_id).toBe('e1');
  });

  it('still enters (base paused, no options) when the disrupted_plan job fails', async () => {
    runJobBySlug.mockRejectedValue(new Error('broker down'));
    const r = await enterEpisode(USER, { type: 'custom' });
    expect(r?.episode.episode_id).toBe('e1');
    expect(pauseUserOccurrencesInWindow).toHaveBeenCalled();
    expect(insertActivities).not.toHaveBeenCalled(); // no temp activities to insert
  });
});

describe('endEpisode', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-18T09:00:00.000Z'));
    getUser.mockResolvedValue({ pending_proposal: null });
    setPendingProposal.mockResolvedValue(undefined);
  });
  afterEach(() => vi.useRealTimers());

  it('restores the base plan from today, drops future temp options, and marks ended', async () => {
    getActiveEpisode.mockResolvedValue({ episode_id: 'e1', start: '2026-07-16' }); // short detour
    const r = await endEpisode(USER);
    expect(deleteFutureTempOccurrences).toHaveBeenCalledWith(USER, 'e1', '2026-07-18');
    expect(restorePausedOccurrencesFrom).toHaveBeenCalledWith(USER, '2026-07-18');
    expect(endActiveEpisode).toHaveBeenCalledWith(USER, 'e1');
    expect(r).toEqual({ ended: true });
  });

  it('is a no-op when there is no active episode', async () => {
    getActiveEpisode.mockResolvedValue(null);
    expect(await endEpisode(USER)).toEqual({ ended: false });
    expect(endActiveEpisode).not.toHaveBeenCalled();
  });

  it('offers a re-baseline after a long detour (Req 4 Phase E)', async () => {
    getActiveEpisode.mockResolvedValue({ episode_id: 'e1', start: '2026-07-01' }); // 17 days out
    const r = await endEpisode(USER);
    expect(setPendingProposal).toHaveBeenCalledWith(USER, expect.objectContaining({ action: 'rebaseline' }));
    expect(r).toEqual({ ended: true, rebaselineSuggested: true });
  });

  it('does not offer a re-baseline for a short detour, or when a proposal is already pending', async () => {
    getActiveEpisode.mockResolvedValue({ episode_id: 'e1', start: '2026-07-16' }); // 2 days
    await endEpisode(USER);
    expect(setPendingProposal).not.toHaveBeenCalled();

    getActiveEpisode.mockResolvedValue({ episode_id: 'e2', start: '2026-07-01' }); // long, but…
    getUser.mockResolvedValue({ pending_proposal: { reason: 'x' } }); // …already something pending
    await endEpisode(USER);
    expect(setPendingProposal).not.toHaveBeenCalled();
  });
});
