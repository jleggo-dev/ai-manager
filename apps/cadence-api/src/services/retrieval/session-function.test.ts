/**
 * `get_session` (session-function.ts) — every step of one dated session. The 2026-11-01 incident is
 * the first row: a 17-step "Obstacle strength" whose warm-up (the bike) is step 1, which the coach
 * told the owner she could not see. Then the matcher's positives and near-misses, the user's own
 * today (not UTC's), the budget, and the routine line whose "+9 more" she mistook for the session.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OccurrenceSession, SessionItem } from '@cadence/shared';

const getUser = vi.fn();
const listDatedSessions = vi.fn();
const getOccurrenceSessionById = vi.fn();
// plan-edit.ts (the shared title matcher) reaches the db module; the tool's own reads are mocked
// above it, so nothing here touches a database.
vi.mock('../../db/sql.ts', () => ({ sql: vi.fn(), json: vi.fn() }));
vi.mock('../../repos/users.ts', () => ({ getUser: (...a: unknown[]) => getUser(...a) }));
vi.mock('../../repos/occurrence-sessions.ts', () => ({
  listDatedSessions: (...a: unknown[]) => listDatedSessions(...a),
  getOccurrenceSessionById: (...a: unknown[]) => getOccurrenceSessionById(...a),
}));

const { GET_SESSION, SESSION_TEXT_BUDGET, pickSession, renderSession } = await import('./session-function.ts');
const { stepNames } = await import('./user-built-function.ts');
const { TOOL_RESPONSE_LIMIT } = await import('../tool-response.ts');

const item = (name: string, over: Partial<SessionItem> = {}): SessionItem => ({ name, ...over });
const session = (blocks: OccurrenceSession['blocks'], note = ''): OccurrenceSession => ({
  blocks,
  note,
  generated_at: '2026-11-01T12:00:00Z',
  version: 1,
});

/** The owner's session, shaped like the one on their Start sheet: 17 steps, the bike first. */
const OBSTACLE = session(
  [
    {
      label: 'Warm-up',
      items: [
        item('Bike', { duration_min: 5, detail: 'easy spin' }),
        item('Leg swings', { reps: 10, per_side: true }),
        item('Arm circles', { reps: 10 }),
        item('Inchworms', { reps: 5 }),
      ],
    },
    {
      label: 'Main',
      mode: 'circuit',
      rounds: 3,
      items: [
        item('Dead hang', { sets: 3, duration_min: 0.5 }),
        item('Goblet squat', { sets: 3, reps: 10, load: '35 lb' }),
        item('Farmer carry', { sets: 3, distance_km: 0.04, load: '50 lb' }),
        item('Box step-up', { sets: 3, reps: 8, per_side: true }),
        item('Bear crawl', { sets: 3, duration_min: 0.5 }),
        item('Push-up', { sets: 3, reps: 12 }),
        item('Inverted row', { sets: 3, reps: 10 }),
        item('Lateral bound', { sets: 3, reps: 6, per_side: true }),
        item('Plank', { sets: 3, duration_min: 0.75 }),
      ],
    },
    {
      label: 'Cool-down',
      items: [
        item('Couch stretch', { duration_min: 1, per_side: true }),
        item('Hang stretch'),
        item('Walk'),
        item('Breathing', { duration_min: 2 }),
      ],
    },
  ],
  'Grip and carries this week.',
);

const row = (date: string, title: string, status = 'pending') => ({
  occurrence_id: `o-${date}-${title}`,
  date,
  title,
  status,
});

describe('renderSession — every step, never the first eight', () => {
  it('lists all 17 steps of the incident session, the bike as step 1', () => {
    const text = renderSession(row('2026-11-01', 'Obstacle strength'), OBSTACLE, '2026-11-01');
    expect(text).toContain('Obstacle strength — 2026-11-01 (today), still to do.');
    expect(text).toContain('17 steps in 3 blocks — every step');
    expect(text).toContain('  1. Bike — 5 min — easy spin');
    expect(text).toContain('  9. Bear crawl');
    expect(text).toContain('  17. Breathing — 2 min');
    expect(text).toContain('Main (circuit, 3 rounds):');
    expect(text).toContain('The note written with it: "Grip and carries this week."');
    for (let n = 1; n <= 17; n += 1) expect(text).toMatch(new RegExp(`^  ${n}\\. `, 'm'));
  });

  it.each([
    ['sets × reps', item('Push-up', { sets: 3, reps: 12 }), '1. Push-up — 3 × 12'],
    [
      'each side + load',
      item('Step-up', { sets: 3, reps: 8, per_side: true, load: '20 lb' }),
      '1. Step-up — 3 × 8 · each side · 20 lb',
    ],
    ['reps alone', item('Arm circles', { reps: 10 }), '1. Arm circles — 10 reps'],
    [
      'intervals',
      item('Rower', { interval_work_sec: 30, interval_recover_sec: 30, interval_rounds: 8 }),
      '1. Rower — 8 rounds of 30s on / 30s easy',
    ],
    ['a bare name stays bare', item('Walk'), '1. Walk\n'],
  ])('amounts: %s', (_label, it_, line) => {
    const text = renderSession(row('2026-11-03', 'S'), session([{ label: 'Main', items: [it_] }]), '2026-11-01');
    expect(`${text}\n`).toContain(line);
  });

  it.each([
    ['done', 'done'],
    ['skipped', 'skipped'],
    ['pending', 'still to do'],
  ])('status %s reads as "%s"', (status, words) => {
    expect(renderSession(row('2026-11-02', 'S', status), OBSTACLE, '2026-11-01')).toContain(
      `2026-11-02 (tomorrow), ${words}.`,
    );
  });

  it('a session not written yet says so — never reads as an empty session', () => {
    const text = renderSession(row('2026-11-05', 'Obstacle strength'), null, '2026-11-01');
    expect(text).toContain('No steps are written for it yet');
    expect(text).not.toMatch(/^ {2}1\. /m);
  });

  it('over budget: the cue lines go, every step stays, and the answer says what it left out', () => {
    const long = 'x'.repeat(200);
    const big = session(
      Array.from({ length: 6 }, (_, b) => ({
        label: `Block ${b + 1}`,
        items: Array.from({ length: 12 }, (_, i) =>
          item(`Step ${b * 12 + i + 1}`, { sets: 3, reps: 10, detail: long }),
        ),
      })),
    );
    const text = renderSession(row('2026-11-01', 'Big'), big, '2026-11-01');
    expect(text.length).toBeLessThanOrEqual(SESSION_TEXT_BUDGET);
    expect(text.length).toBeLessThanOrEqual(TOOL_RESPONSE_LIMIT);
    expect(text).toContain('  72. Step 72 — 3 × 10');
    expect(text).not.toContain(long);
    expect(text).toContain('left out so all 72 steps fit here');
  });
});

describe('pickSession — one-or-nothing, but weeks of one session are not an ambiguity', () => {
  const rows = [
    row('2026-11-01', 'Obstacle strength'),
    row('2026-11-03', 'Easy run'),
    row('2026-11-08', 'Obstacle strength'),
    row('2026-11-10', 'Strength A'),
    row('2026-11-11', 'Strength B'),
  ];
  it.each([
    ['exact title, repeating weekly → the soonest', 'Obstacle strength', '2026-11-01'],
    ['case-folded', 'obstacle STRENGTH', '2026-11-01'],
    ['a part of the title', 'obstacle', '2026-11-01'],
    ['another session', 'easy run', '2026-11-03'],
  ])('%s', (_label, query, date) => {
    expect(pickSession(rows, query)?.date).toBe(date);
  });
  it.each([
    ['three different titles all contain it', 'strength', null],
    ['"weighted" is not "Strength A"', 'weighted strength', null],
    ['nothing like it', 'yoga', null],
  ])('near-miss: %s', (_label, query, want) => {
    expect(pickSession(rows, query)).toBe(want);
  });
});

describe('get_session — the tail tool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getUser.mockResolvedValue({ timezone: 'America/Los_Angeles' });
    listDatedSessions.mockResolvedValue([
      row('2026-11-01', 'Obstacle strength'),
      row('2026-11-08', 'Obstacle strength'),
    ]);
    getOccurrenceSessionById.mockResolvedValue(OBSTACLE);
  });
  afterEach(() => vi.useRealTimers());

  it("floors at the user's own today: 00:22 UTC on Nov 2 is still Nov 1 in Los Angeles", async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-02T00:22:00Z'));
    const result = await GET_SESSION.run('u1', { session: 'Obstacle strength' });
    expect(listDatedSessions).toHaveBeenCalledWith('u1', '2026-11-01', '2026-11-28');
    expect(getOccurrenceSessionById).toHaveBeenCalledWith('u1', 'o-2026-11-01-Obstacle strength');
    const text = GET_SESSION.render(result);
    expect(text).toContain('(today)');
    expect(text).toContain('  1. Bike');
    expect(GET_SESSION.rows(result)).toBe(17);
  });

  it('a date reads that one day, past or future', async () => {
    await GET_SESSION.run('u1', { session: 'Obstacle strength', date: '2026-10-25' });
    expect(listDatedSessions).toHaveBeenCalledWith('u1', '2026-10-25', '2026-10-25');
  });

  it('an unparseable date is ignored, not read as a window', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-01T18:00:00Z'));
    await GET_SESSION.run('u1', { session: 'Obstacle strength', date: 'today' });
    expect(listDatedSessions).toHaveBeenCalledWith('u1', '2026-11-01', '2026-11-28');
  });

  it('no match names what IS on the calendar', async () => {
    const text = GET_SESSION.render(await GET_SESSION.run('u1', { session: 'yoga' }));
    expect(text).toContain('clearly matches "yoga"');
    expect(text).toContain('2026-11-01 Obstacle strength');
    expect(getOccurrenceSessionById).not.toHaveBeenCalled();
  });

  it('no name asks which one', async () => {
    const result = await GET_SESSION.run('u1', {});
    expect(GET_SESSION.render(result)).toContain('No session was named');
    expect(listDatedSessions).not.toHaveBeenCalled();
  });
});

describe("the routine line's cut says where the rest are (the line she read as the session)", () => {
  it('a 17-step routine on the plan points at get_session for the other 9', () => {
    const text = stepNames(OBSTACLE, true);
    expect(text).toContain('+9 more (get_session reads every step');
    expect(text.startsWith('Bike, ')).toBe(true);
  });
  it('off the plan there is no dated session to read, and it says that instead', () => {
    expect(stepNames(OBSTACLE, false)).toContain('+9 more (not listed here');
  });
  it('eight or fewer steps: no cut, no note', () => {
    const short = session([{ label: 'Main', items: OBSTACLE.blocks[0]!.items }]);
    expect(stepNames(short, true)).toBe('Bike, Leg swings, Arm circles, Inchworms');
  });
});
