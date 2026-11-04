/**
 * `rearrange_session` — thin over `rearrangeSession` (rearrange-session.ts), so what is tested is
 * the translation contract: the session is addressed the way revise_session addresses one, the
 * person's words reach the job untouched, and every outcome answers in one of the three shapes
 * with the structure diff's own words on the changed line.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../repos/occurrence-sessions.ts', () => ({ listUpcomingForRevision: vi.fn() }));
vi.mock('../repos/users.ts', () => ({ getUser: vi.fn() }));
vi.mock('./rearrange-session.ts', () => ({ rearrangeSession: vi.fn() }));

import { listUpcomingForRevision } from '../repos/occurrence-sessions.ts';
import { getUser } from '../repos/users.ts';
import { rearrangeSession } from './rearrange-session.ts';
import { REARRANGE_SESSION } from './coach-action-rearrange-session.ts';
import { toolOutputShape } from './tool-response.ts';

const OCC = {
  occurrence_id: 'o1',
  date: '2026-11-04',
  title: 'Obstacle strength',
  status: 'pending',
  kind: 'user',
} as never;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-03T15:00:00Z'));
  vi.mocked(getUser)
    .mockReset()
    .mockResolvedValue({ timezone: 'UTC' } as never);
  vi.mocked(rearrangeSession).mockReset();
  vi.mocked(listUpcomingForRevision)
    .mockReset()
    .mockResolvedValue([
      { occurrence_id: 'o1', date: '2026-11-04', title: 'Obstacle strength' },
      { occurrence_id: 'o2', date: '2026-11-05', title: 'Easy run' },
    ]);
});
afterEach(() => vi.useRealTimers());

describe('rearrange_session', () => {
  it('hands their words to the rearrange untouched and answers with the changes as facts', async () => {
    vi.mocked(rearrangeSession).mockResolvedValue({
      status: 'rearranged',
      occ: OCC,
      session: { blocks: [], note: '', generated_at: '', version: 1 },
      changes: [
        {
          kind: 'spread',
          key: 'spread:s5',
          words: 'Dead hang, one set at a time',
          sentence: 'dead hang one set at a time',
        },
        {
          kind: 'alternate',
          key: 'alternate:s3+s4',
          words: 'Bench press + dumbbell row, alternating',
          sentence: 'alternate bench press and dumbbell row',
        },
      ],
      findings: [],
    });
    const out = await REARRANGE_SESSION.run('u1', {
      session: 'obstacle strength',
      steer: 'alternate the presses and rows, spread the hangs out',
    });
    expect(vi.mocked(rearrangeSession)).toHaveBeenCalledWith(
      'u1',
      'o1',
      'alternate the presses and rows, spread the hangs out',
    );
    expect(toolOutputShape(out)).toBe('changed');
    expect(out).toContain(
      'changed: Rearranged: Obstacle strength on 2026-11-04 — Dead hang, one set at a time; Bench press + dumbbell row, alternating.',
    );
    expect(out).toContain('unchanged: Every move and its numbers are as they were.');
  });

  it('the checker’s findings ride the answer as facts', async () => {
    vi.mocked(rearrangeSession).mockResolvedValue({
      status: 'rearranged',
      occ: OCC,
      session: { blocks: [], note: '', generated_at: '', version: 1 },
      changes: [],
      findings: [
        {
          rule: 'one_rep_sets',
          blockIndex: 0,
          itemIndex: 3,
          item: 'Dead hang',
          severity: 'question',
          fact: 'Dead hang is written as 3 sets of 1 rep.',
        },
      ],
    });
    const out = await REARRANGE_SESSION.run('u1', { session: 'Obstacle strength', steer: 'x' });
    expect(out).toContain('a new order, the same moves');
    expect(out).toContain(
      "unchanged: The session's own check found: - (question) Dead hang is written as 3 sets of 1 rep.",
    );
  });

  it.each([
    ['no session named', { steer: 'x' }, 'no session was named'],
    ['no arrangement described', { session: 'Obstacle strength' }, 'no arrangement was described'],
    ['no match', { session: 'Swim', steer: 'x' }, 'no upcoming session clearly matches "Swim"'],
    ['a date with nothing on it', { session: 'Obstacle strength', steer: 'x', date: '2026-11-09' }, 'on 2026-11-09'],
  ])('%s: nothing changed, and the rearrange is not called', async (_n, params, words) => {
    const out = await REARRANGE_SESSION.run('u1', params);
    expect(toolOutputShape(out)).toBe('nothing-changed');
    expect(out).toContain(words);
    expect(vi.mocked(rearrangeSession)).not.toHaveBeenCalled();
  });

  it.each([
    ['vanished', { status: 'not_found' }, 'nothing-changed', 'vanished'],
    [
      'a tracking row',
      { status: 'not_revisable', reason: 'system_row', occ: OCC },
      'nothing-changed',
      'tracking entry',
    ],
    ['in the past', { status: 'not_revisable', reason: 'past', occ: OCC }, 'nothing-changed', 'in the past'],
    [
      'not written yet',
      { status: 'not_revisable', reason: 'no_session', occ: OCC },
      'nothing-changed',
      'has not been written yet',
    ],
    [
      'already recorded',
      { status: 'not_revisable', reason: 'not_pending', occ: OCC },
      'nothing-changed',
      'already recorded',
    ],
    ['the moves changed', { status: 'items_changed', occ: OCC }, 'fault', 'did not hold the same moves'],
    ['the job failed', { status: 'failed', occ: OCC, error: 'provider 502' }, 'fault', 'provider 502'],
  ])('%s', async (_n, result, shape, words) => {
    vi.mocked(rearrangeSession).mockResolvedValue(result as never);
    const out = await REARRANGE_SESSION.run('u1', { session: 'Obstacle strength', steer: 'x' });
    expect(toolOutputShape(out)).toBe(shape);
    expect(out).toContain(words);
  });

  it('a throw is a fault, never a thrown error', async () => {
    vi.mocked(rearrangeSession).mockRejectedValue(new Error('down'));
    const out = await REARRANGE_SESSION.run('u1', { session: 'Obstacle strength', steer: 'x' });
    expect(toolOutputShape(out)).toBe('fault');
  });
});
