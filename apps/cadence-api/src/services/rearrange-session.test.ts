/**
 * The coach rearranging one session in place (walkthrough v3 Phase 6, R2), with the job and the
 * database faked. What is pinned: only the structure is the job's — every item's numbers are the
 * original's; a changed item set is a fault and nothing is written; the gates that keep history
 * history; and the changes come back in the Recap's own words.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const job = vi.fn();
const getOccurrenceWithActivity = vi.fn();
const replaceOccurrenceSession = vi.fn();
const logged: unknown[] = [];

vi.mock('../ai/aim.ts', () => ({ runJobBySlug: (...a: unknown[]) => job(...a) }));
vi.mock('../repos/occurrences.ts', () => ({
  getOccurrenceWithActivity: (...a: unknown[]) => getOccurrenceWithActivity(...a),
}));
vi.mock('../repos/occurrence-sessions.ts', () => ({
  replaceOccurrenceSession: (...a: unknown[]) => replaceOccurrenceSession(...a),
}));
vi.mock('../repos/users.ts', () => ({ getUser: async () => ({ timezone: 'UTC' }) }));
vi.mock('./ai-log.ts', () => ({ logAi: async (_u: string, row: unknown) => void logged.push(row) }));

const { rearrangeSession } = await import('./rearrange-session.ts');

const SESSION = {
  blocks: [
    {
      label: 'Main',
      items: [
        { name: 'Pull-ups', sets: 3, reps: 5 },
        { name: 'Bench press', sets: 3, reps: 8, load: '95 lb' },
        { name: 'Dumbbell row', sets: 3, reps: 10, load: '40 lb' },
        { name: 'Dead hang', sets: 3, duration_min: 0.75, tool: 'timer' },
      ],
    },
  ],
  note: 'Pull, push, carry.',
  generated_at: '2026-11-02T00:00:00.000Z',
  version: 1,
};
const OCC = {
  occurrence_id: 'o1',
  activity_id: 'a1',
  date: '2026-11-04',
  status: 'pending',
  kind: 'user',
  title: 'Obstacle strength',
  session: SESSION,
};
const answer = (o: unknown) => ({ formatted: JSON.stringify(o) });
const REARRANGED = {
  blocks: [
    { label: 'Hang', items: [{ name: 'Dead hang', sets: 1 }] },
    { label: 'Pull', items: [{ name: 'Pull-ups', sets: 3, reps: 5 }] },
    { label: 'Hang', items: [{ name: 'Dead hang', sets: 1 }] },
    {
      label: 'Push and pull',
      mode: 'circuit',
      rounds: 3,
      items: [
        { name: 'Bench press', sets: 3, reps: 12, load: '200 lb' },
        { name: 'Dumbbell row', sets: 3 },
      ],
    },
    { label: 'Hang', items: [{ name: 'Dead hang', sets: 1 }] },
  ],
  note: 'Presses and rows alternate; the hangs are spread out.',
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-03T15:00:00Z'));
  job.mockReset();
  logged.length = 0;
  getOccurrenceWithActivity.mockReset().mockResolvedValue(OCC);
  replaceOccurrenceSession.mockReset().mockResolvedValue(true);
});

describe('rearrangeSession', () => {
  it('hands the session and their words to the job, writes the same items in the new structure, and says what changed in the Recap’s words', async () => {
    job.mockResolvedValue(answer(REARRANGED));
    const r = await rearrangeSession('u1', 'o1', 'alternate the presses and rows, spread the hangs out');
    expect(r.status).toBe('rearranged');
    if (r.status !== 'rearranged') return;
    const [, slug, vars] = job.mock.calls[0] as [string, string, Record<string, string>];
    expect(slug).toBe('rearrange-session');
    expect(vars.activity).toBe('Obstacle strength');
    expect(JSON.parse(vars.session!)).toEqual({ blocks: SESSION.blocks, note: SESSION.note });
    expect(vars.words).toBe('alternate the presses and rows, spread the hangs out');
    // Only the structure is the job's: the bench press keeps 8 reps at 95 lb, not 12 at 200.
    const pair = r.session.blocks[3]!;
    expect(pair).toMatchObject({ mode: 'circuit', rounds: 3 });
    expect(pair.items[0]).toEqual({ name: 'Bench press', sets: 3, reps: 8, load: '95 lb' });
    expect(pair.items[1]).toEqual({ name: 'Dumbbell row', sets: 3, reps: 10, load: '40 lb' });
    expect(r.session.blocks[0]!.items[0]).toEqual({ name: 'Dead hang', sets: 1, duration_min: 0.75, tool: 'timer' });
    expect(r.session.version).toBe(1);
    expect(replaceOccurrenceSession).toHaveBeenCalledWith('u1', 'o1', r.session);
    expect(r.changes.map((c) => c.words)).toEqual([
      'Dead hang, one set at a time',
      'Bench press + dumbbell row, alternating',
    ]);
    expect(r.findings).toEqual([]);
    expect(logged[0]).toMatchObject({ kind: 'rearrange_session', meta: { status: 'rearranged', findings: 0 } });
  });

  it.each([
    ['a move dropped', { blocks: [REARRANGED.blocks[1]], note: '' }],
    ['a move added', { blocks: [...SESSION.blocks, { label: 'x', items: [{ name: 'Burpees', sets: 2 }] }], note: '' }],
    [
      'a move renamed',
      {
        blocks: [
          {
            label: 'Main',
            items: SESSION.blocks[0]!.items.map((i) => (i.name === 'Pull-ups' ? { ...i, name: 'Chin-ups' } : i)),
          },
        ],
        note: '',
      },
    ],
    ['a set lost', { blocks: REARRANGED.blocks.slice(0, 4), note: '' }],
  ])('%s is items_changed, and nothing is written', async (_n, bad) => {
    job.mockResolvedValue(answer(bad));
    const r = await rearrangeSession('u1', 'o1', 'alternate them');
    expect(r.status).toBe('items_changed');
    expect(replaceOccurrenceSession).not.toHaveBeenCalled();
    expect(logged[0]).toMatchObject({ meta: { status: 'items_changed' } });
  });

  it('an answer that is not a session, or a job that fails, is failed and nothing is written', async () => {
    job.mockResolvedValue({ formatted: 'not json' });
    expect((await rearrangeSession('u1', 'o1', 'x')).status).toBe('failed');
    job.mockRejectedValue(new Error('provider 502'));
    expect(await rearrangeSession('u1', 'o1', 'x')).toMatchObject({ status: 'failed', error: 'provider 502' });
    expect(replaceOccurrenceSession).not.toHaveBeenCalled();
  });

  it.each([
    ['not this user’s', null, 'not_found', undefined],
    ['a tracking row', { ...OCC, kind: 'system' }, 'not_revisable', 'system_row'],
    ['already recorded', { ...OCC, status: 'done' }, 'not_revisable', 'not_pending'],
    ['yesterday', { ...OCC, date: '2026-11-02' }, 'not_revisable', 'past'],
    ['no session written yet', { ...OCC, session: null }, 'not_revisable', 'no_session'],
  ])('%s: nothing is asked and nothing written', async (_n, occ, status, reason) => {
    getOccurrenceWithActivity.mockResolvedValue(occ);
    const r = await rearrangeSession('u1', 'o1', 'x');
    expect(r.status).toBe(status);
    if (reason) expect(r).toMatchObject({ reason });
    expect(job).not.toHaveBeenCalled();
  });

  it('a row logged done between the read and the write is not_pending, and the answer is not forced in', async () => {
    job.mockResolvedValue(answer(REARRANGED));
    replaceOccurrenceSession.mockResolvedValue(false);
    getOccurrenceWithActivity.mockResolvedValueOnce(OCC).mockResolvedValueOnce({ ...OCC, status: 'done' });
    expect(await rearrangeSession('u1', 'o1', 'x')).toMatchObject({ status: 'not_revisable', reason: 'not_pending' });
  });

  it('the checker’s findings travel back as facts', async () => {
    job.mockResolvedValue(
      answer({
        blocks: [{ label: 'Main', items: SESSION.blocks[0]!.items.map((i) => ({ name: i.name, sets: i.sets })) }],
        note: '',
      }),
    );
    getOccurrenceWithActivity.mockResolvedValue({
      ...OCC,
      session: {
        ...SESSION,
        blocks: [
          { label: 'Main', items: [...SESSION.blocks[0]!.items.slice(0, 3), { name: 'Dead hang', sets: 3, reps: 1 }] },
        ],
      },
    });
    const r = await rearrangeSession('u1', 'o1', 'x');
    expect(r.status).toBe('rearranged');
    if (r.status === 'rearranged') expect(r.findings.map((f) => f.rule)).toEqual(['one_rep_sets']);
  });
});
