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
import { getOccurrenceDetail } from './session-generate.ts';

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
