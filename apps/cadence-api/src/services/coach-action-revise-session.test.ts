/**
 * `revise_session` — thin over `reviseSession` (session-generate.ts), so what's tested here is
 * the translation contract: the session is addressed exactly the way log_session/correct_log
 * address one (title as the plan lists it + optional date, one-or-nothing match), the person's
 * words reach the rebuild untouched, and every outcome gets words the coach can act on.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../repos/occurrence-sessions.ts', () => ({ listUpcomingForRevision: vi.fn() }));
vi.mock('../repos/users.ts', () => ({ getUser: vi.fn() }));
vi.mock('./session-generate.ts', () => ({ reviseSession: vi.fn() }));

import { listUpcomingForRevision } from '../repos/occurrence-sessions.ts';
import { getUser } from '../repos/users.ts';
import { reviseSession } from './session-generate.ts';
import { REVISE_SESSION } from './coach-action-revise-session.ts';

const SESSION = {
  blocks: [
    { label: 'Main', items: [{ name: 'Bench press' }, { name: 'Hanging leg raise' }] },
    { label: 'Finisher', items: [{ name: 'Plank' }] },
  ],
  note: 'I folded chest and abs into the main block.',
  generated_at: '2026-08-31T00:00:00.000Z',
  version: 1,
};

afterEach(() => vi.useRealTimers());

beforeEach(() => {
  vi.mocked(getUser)
    .mockReset()
    .mockResolvedValue({ timezone: 'America/Los_Angeles' } as never);
  vi.mocked(reviseSession).mockReset();
  vi.mocked(listUpcomingForRevision)
    .mockReset()
    .mockResolvedValue([
      { occurrence_id: 'o1', date: '2026-08-31', title: 'Strength' },
      { occurrence_id: 'o2', date: '2026-09-01', title: 'Easy run' },
      { occurrence_id: 'o3', date: '2026-09-03', title: 'Strength' },
    ]);
});

describe('revise_session', () => {
  /**
   * The 2026-11-01 incident: at 00:22 UTC on Nov 2 the owner (evening of Nov 1 at home) asked to
   * change today's session. The list floored at the UTC date, so today's row was not in it and
   * the rebuild could not be aimed. The window is the user's own days now.
   */
  it.each([
    [
      'evening in Los Angeles, already tomorrow in UTC',
      'America/Los_Angeles',
      '2026-11-02T00:22:00Z',
      '2026-11-01',
      '2026-11-29',
    ],
    [
      'morning in Auckland, still yesterday in UTC',
      'Pacific/Auckland',
      '2026-11-01T20:00:00Z',
      '2026-11-02',
      '2026-11-30',
    ],
    ['no timezone on file falls back to UTC', null, '2026-11-02T00:22:00Z', '2026-11-02', '2026-11-30'],
  ])("the list floors at the user's own today: %s", async (_label, timezone, now, from, to) => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(now));
    vi.mocked(getUser).mockResolvedValue({ timezone } as never);
    vi.mocked(reviseSession).mockResolvedValue({ status: 'revised', occ: {} as never, session: SESSION as never });
    await REVISE_SESSION.run('u1', { session: 'Easy run', steer: 'easier' });
    expect(listUpcomingForRevision).toHaveBeenCalledWith('u1', from, to);
  });

  it('a failed user read still aims the rebuild (UTC days), never throws', async () => {
    vi.mocked(getUser).mockRejectedValue(new Error('db down'));
    vi.mocked(reviseSession).mockResolvedValue({ status: 'revised', occ: {} as never, session: SESSION as never });
    await REVISE_SESSION.run('u1', { session: 'Easy run', steer: 'easier' });
    expect(reviseSession).toHaveBeenCalledWith('u1', 'o2', 'easier');
  });

  it('refuses a missing session name or missing steer without touching anything', async () => {
    expect(await REVISE_SESSION.run('u1', { steer: 'add abs' })).toContain('nothing changed');
    expect(await REVISE_SESSION.run('u1', { session: 'Strength' })).toContain('nothing changed');
    expect(listUpcomingForRevision).not.toHaveBeenCalled();
    expect(reviseSession).not.toHaveBeenCalled();
  });

  it('addresses by title + date the way logging does, and hands the steer through untouched', async () => {
    vi.mocked(reviseSession).mockResolvedValue({ status: 'revised', occ: {} as never, session: SESSION as never });
    const out = await REVISE_SESSION.run('u1', {
      session: 'Strength',
      steer: 'add chest and abs',
      date: '2026-09-03',
    });
    expect(reviseSession).toHaveBeenCalledWith('u1', 'o3', 'add chest and abs');
    expect(out).toContain('Strength on 2026-09-03');
    expect(out).toContain('2 block(s), 3 step(s)');
    expect(out).toContain(SESSION.note);
    // No length mandate on the explanation (TR-1).
    expect(out).toContain('Say what changed and why it fits.');
    expect(out).not.toMatch(/in one short line/);
  });

  it('takes the soonest matching session when no date is given', async () => {
    vi.mocked(reviseSession).mockResolvedValue({ status: 'revised', occ: {} as never, session: SESSION as never });
    await REVISE_SESSION.run('u1', { session: 'Easy run', steer: 'easier on the knee' });
    expect(reviseSession).toHaveBeenCalledWith('u1', 'o2', 'easier on the knee');
  });

  it('two sessions with the same title and no date is a rejection, never a coin flip', async () => {
    const out = await REVISE_SESSION.run('u1', { session: 'Strength', steer: 'add abs' });
    expect(out).toContain('nothing changed');
    expect(out).toContain('Ask which they mean');
    expect(reviseSession).not.toHaveBeenCalled();
  });

  it('a miss lists what IS coming up, so the next call can be right', async () => {
    const out = await REVISE_SESSION.run('u1', { session: 'Swimming', steer: 'add abs' });
    expect(out).toContain('no upcoming session clearly matches "Swimming"');
    expect(out).toContain('2026-08-31 Strength');
    expect(reviseSession).not.toHaveBeenCalled();
  });

  it('a session recorded under the race points at correct_log, not at a retry', async () => {
    vi.mocked(reviseSession).mockResolvedValue({
      status: 'not_revisable',
      reason: 'not_pending',
      occ: {} as never,
    });
    const out = await REVISE_SESSION.run('u1', { session: 'Easy run', steer: 'easier' });
    expect(out).toContain('already recorded');
    expect(out).toContain('correct_log');
  });

  it('a failed rebuild says so honestly — nothing written, fresh on next open', async () => {
    vi.mocked(reviseSession).mockResolvedValue({ status: 'failed', occ: {} as never });
    const out = await REVISE_SESSION.run('u1', { session: 'Easy run', steer: 'easier' });
    expect(out).toContain('did not come back usable');
    expect(out).toContain('offer to try again');
  });

  it('a vanished session points back at the plan instead of claiming anything happened', async () => {
    vi.mocked(reviseSession).mockResolvedValue({ status: 'not_found' });
    const out = await REVISE_SESSION.run('u1', { session: 'Easy run', steer: 'easier' });
    expect(out).toMatch(/^nothing changed: that session vanished/);
    expect(out).toContain('get_active_plan');
  });
});
