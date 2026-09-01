/**
 * `revise_session` — thin over `reviseSession` (session-generate.ts), so what's tested here is
 * the translation contract: the session is addressed exactly the way log_session/correct_log
 * address one (title as the plan lists it + optional date, one-or-nothing match), the person's
 * words reach the rebuild untouched, and every outcome gets words the coach can act on.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../repos/occurrence-sessions.ts', () => ({ listUpcomingForRevision: vi.fn() }));
vi.mock('./session-generate.ts', () => ({ reviseSession: vi.fn() }));

import { listUpcomingForRevision } from '../repos/occurrence-sessions.ts';
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

beforeEach(() => {
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
    expect(out).toContain('No upcoming session clearly matches "Swimming"');
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
    expect(out).toContain('Nothing happened');
    expect(out).toContain('get_active_plan');
  });
});
