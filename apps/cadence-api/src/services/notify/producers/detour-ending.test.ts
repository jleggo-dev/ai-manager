/**
 * The cases worth pinning are the ones where "tomorrow" stops being true: a user in another zone,
 * an episode ending today, and an episode ending the day after next.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const listCandidates = vi.fn();
vi.mock('../../../repos/notify-candidates.ts', () => ({
  listDetourEndingCandidates: (...a: unknown[]) => listCandidates(...a),
}));

const { detourEndingProducer } = await import('./detour-ending.ts');

const row = (over: Record<string, unknown> = {}) => ({
  user_id: 'u1',
  timezone: 'Europe/London',
  episode_id: 'ep-1',
  end_date: '2026-08-11',
  ...over,
});

/** Midday London on 2026-08-10 — the day before the episode ends. */
const MIDDAY = new Date('2026-08-10T11:00:00Z');

beforeEach(() => {
  vi.clearAllMocks();
  listCandidates.mockResolvedValue([row()]);
});

describe('detour_ending', () => {
  it('proposes exactly one day ahead, targeted on the episode', async () => {
    const [req] = await detourEndingProducer.produce(MIDDAY);
    expect(req).toMatchObject({ userId: 'u1', kind: 'detour_ending', target: 'ep-1' });
    expect(req?.title).toBe('Your detour ends tomorrow');
  });

  it('offers both options as equals, and asks', async () => {
    const [req] = await detourEndingProducer.produce(MIDDAY);
    expect(req?.body.toLowerCase()).toMatch(/ease back in/);
    expect(req?.body.toLowerCase()).toMatch(/(more time|longer|keep the detour)/);
    // Never framed as the detour expiring on its own with returning as the unmarked default.
    expect(req?.body).not.toMatch(/\b(back to normal|resumes|as usual|expires|over now)\b/i);
  });

  it('says nothing on the day the detour actually ends', async () => {
    expect(await detourEndingProducer.produce(new Date('2026-08-11T11:00:00Z'))).toEqual([]);
  });

  it('says nothing two days out — a week’s notice is a decision made too early', async () => {
    expect(await detourEndingProducer.produce(new Date('2026-08-09T11:00:00Z'))).toEqual([]);
  });

  it('reads "tomorrow" on the user’s calendar, not the server’s', async () => {
    // 23:00Z on the 10th is already the 11th in Tokyo, so the end date is TODAY there.
    listCandidates.mockResolvedValue([row({ timezone: 'Asia/Tokyo' })]);
    expect(await detourEndingProducer.produce(new Date('2026-08-10T23:00:00Z'))).toEqual([]);
    expect(await detourEndingProducer.produce(new Date('2026-08-09T23:00:00Z'))).toHaveLength(1);
  });

  it('holds when the timezone is unknown — "tomorrow" cannot be said truthfully', async () => {
    listCandidates.mockResolvedValue([row({ timezone: null })]);
    expect(await detourEndingProducer.produce(MIDDAY)).toEqual([]);
  });

  it('handles several users in one pass', async () => {
    listCandidates.mockResolvedValue([row(), row({ user_id: 'u2', episode_id: 'ep-2' })]);
    const reqs = await detourEndingProducer.produce(MIDDAY);
    expect(reqs.map((r) => r.target)).toEqual(['ep-1', 'ep-2']);
  });
});
