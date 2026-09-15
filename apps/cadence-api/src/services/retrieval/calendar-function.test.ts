/**
 * The calendar as written (calendar-function.ts; owner 2026-09-15, "Shouldn't Cadence be able to
 * see the calendar?"). Table tests for the renderer — a line per day that has to be read cold by a
 * model, so every status mark, the meal fold and the empty-day wording get a row — and for the
 * tail tool's own contract: the `days` clamp, `from`, and the no-plan answer.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const getUser = vi.fn();
const getActivePlan = vi.fn();
const listActivities = vi.fn();
const listActivitiesByIds = vi.fn();
const listOccurrences = vi.fn();
vi.mock('../../repos/users.ts', () => ({ getUser: (...a: unknown[]) => getUser(...a) }));
vi.mock('../../repos/plans.ts', () => ({ getActivePlan: (...a: unknown[]) => getActivePlan(...a) }));
vi.mock('../../repos/activities.ts', () => ({
  listActivities: (...a: unknown[]) => listActivities(...a),
  listActivitiesByIds: (...a: unknown[]) => listActivitiesByIds(...a),
}));
vi.mock('../../repos/occurrences.ts', () => ({ listOccurrences: (...a: unknown[]) => listOccurrences(...a) }));

const { addDays, GET_CALENDAR, renderWrittenDay, renderWrittenDays, shapeWrittenDays, titlesFor } =
  await import('./calendar-function.ts');

const TODAY = '2026-09-14'; // a Monday
const act = (activity_id: string, title: string, over: Record<string, unknown> = {}) => ({
  activity_id,
  title,
  kind: 'user',
  category: 'strength',
  schedule: { time_of_day: '06:00' },
  ...over,
});
const titles = (list: ReturnType<typeof act>[]) => new Map(list.map((a) => [a.activity_id, a as never]));
const row = (activity_id: string, date: string, status = 'pending') => ({ activity_id, date, status: status as never });

describe('addDays', () => {
  it.each([
    ['2026-09-14', 1, '2026-09-15'],
    ['2026-09-14', -1, '2026-09-13'],
    ['2026-09-30', 1, '2026-10-01'],
    ['2026-12-31', 1, '2027-01-01'],
    ['2026-09-14', 0, '2026-09-14'],
  ])('%s + %i → %s', (iso, n, want) => {
    expect(addDays(iso, n)).toBe(want);
  });
});

describe('renderWrittenDay — one line a model reads cold', () => {
  const day = (rows: Array<Partial<Parameters<typeof renderWrittenDay>[0]['rows'][number]>>, date = TODAY) => ({
    date,
    rows: rows.map((r) => ({
      title: 'Easy run',
      kind: 'user' as const,
      meal: false,
      time_of_day: '06:00',
      status: 'pending' as const,
      ...r,
    })),
  });

  it.each([
    // [label, day, want]
    ['a pending row carries no mark', day([{}]), '  Mon 14 (today): 06:00 Easy run'],
    ['done → ✓', day([{ status: 'done' }]), '  Mon 14 (today): 06:00 Easy run ✓'],
    ['skipped → ✗', day([{ status: 'skipped' }]), '  Mon 14 (today): 06:00 Easy run ✗'],
    ['missed is spelled out', day([{ status: 'missed' }]), '  Mon 14 (today): 06:00 Easy run (missed)'],
    ['no time → "any time"', day([{ time_of_day: null }]), '  Mon 14 (today): any time Easy run'],
    ['a future day has no (today) mark', day([{}], '2026-09-16'), '  Wed 16: 06:00 Easy run'],
    ['an empty day is said out loud', day([]), '  Mon 14 (today): — nothing written'],
    [
      'rows are separated by a middle dot, in the order given',
      day([{ time_of_day: '06:00' }, { title: 'Piano practice', time_of_day: '20:00' }]),
      '  Mon 14 (today): 06:00 Easy run · 20:00 Piano practice',
    ],
    [
      'a long title is cut with an ellipsis — the full one is on the plan list',
      day([{ title: 'Obstacle strength - pull, carry, grip (knee + elbow prehab built in)' }]),
      '  Mon 14 (today): 06:00 Obstacle strength - pull, carry…',
    ],
    [
      'meal logs fold to a count — today says how many were logged',
      day([
        { title: 'Log breakfast', meal: true, status: 'done', time_of_day: '08:00' },
        { title: 'Log lunch', meal: true, time_of_day: '12:30' },
        {},
      ]),
      '  Mon 14 (today): 06:00 Easy run · meals 1/2 logged',
    ],
    [
      'a future day counts its meal logs without a logged fraction',
      day([{ title: 'Log breakfast', meal: true, time_of_day: '08:00' }], '2026-09-16'),
      '  Wed 16: 1 meal logs',
    ],
  ])('%s', (_label, d, want) => {
    expect(renderWrittenDay(d, TODAY)).toBe(want);
  });
});

describe('shapeWrittenDays + renderWrittenDays — the block', () => {
  it('lists every day in the span, sorted by time within a day, and drops rows it cannot name', () => {
    const list = [act('a1', 'Easy run'), act('a2', 'Piano practice', { schedule: { time_of_day: '20:00' } })];
    const cal = shapeWrittenDays(
      [row('a2', '2026-09-14'), row('a1', '2026-09-14', 'done'), row('a1', '2026-09-16'), row('ghost', '2026-09-15')],
      titles(list),
      { from: '2026-09-14', to: '2026-09-16', today: TODAY },
    );
    expect(cal.days.map((d) => d.date)).toEqual(['2026-09-14', '2026-09-15', '2026-09-16']);
    expect(renderWrittenDays(cal, 'Their calendar as written, next 3 days')).toBe(
      [
        'Their calendar as written, next 3 days (✓ done · ✗ skipped · otherwise still to do):',
        '  Mon 14 (today): 06:00 Easy run ✓ · 20:00 Piano practice',
        '  Tue 15: — nothing written',
        '  Wed 16: 06:00 Easy run',
      ].join('\n'),
    );
  });

  it('reads a Date-typed row date the way the driver hands it back', () => {
    const cal = shapeWrittenDays(
      [{ activity_id: 'a1', date: new Date('2026-09-15T00:00:00Z') as never, status: 'pending' as never }],
      titles([act('a1', 'Easy run')]),
      {
        from: '2026-09-14',
        to: '2026-09-15',
        today: TODAY,
      },
    );
    expect(cal.days[1]?.rows).toHaveLength(1);
  });

  it('a span with nothing on it is one sentence that says what that means', () => {
    const cal = shapeWrittenDays([], titles([]), { from: '2026-09-14', to: '2026-09-20', today: TODAY });
    const text = renderWrittenDays(cal, 'Their calendar as written, next 7 days');
    expect(text).toBe(
      'Their calendar as written, next 7 days: NOTHING is written from Mon 14 (today) to Sun 20 — no session sits on any of those days, so their plan screen shows nothing there. Say so plainly rather than assuming the sessions are on it.',
    );
  });
});

describe('titlesFor — rows from a superseded version still get their name', () => {
  beforeEach(() => vi.clearAllMocks());

  it('looks up only the ids the active plan does not carry, and only when there are any', async () => {
    listActivitiesByIds.mockResolvedValue([act('old', 'Yesterday’s ruck')]);
    const map = await titlesFor(
      'u1',
      [{ activity_id: 'a1' }, { activity_id: 'old' }, { activity_id: 'old' }],
      [act('a1', 'Easy run') as never],
    );
    expect(listActivitiesByIds).toHaveBeenCalledWith('u1', ['old']);
    expect(map.get('old')?.title).toBe('Yesterday’s ruck');

    listActivitiesByIds.mockClear();
    await titlesFor('u1', [{ activity_id: 'a1' }], [act('a1', 'Easy run') as never]);
    expect(listActivitiesByIds).not.toHaveBeenCalled();
  });
});

describe('get_calendar — the tail tool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getUser.mockResolvedValue({ timezone: null });
    getActivePlan.mockResolvedValue({ plan_id: 'p1', version: 24 });
    listActivities.mockResolvedValue([act('a1', 'Easy run')]);
    listOccurrences.mockResolvedValue([]);
  });

  const utcToday = new Date().toISOString().slice(0, 10);

  it.each([
    // [label, params, from, to]
    ['default: 14 days from today', undefined, utcToday, addDays(utcToday, 13)],
    ['{"days": 7}', { days: 7 }, utcToday, addDays(utcToday, 6)],
    ['days above the cap are clamped to 28', { days: 100 }, utcToday, addDays(utcToday, 27)],
    ['days below 1 become 1', { days: 0 }, utcToday, utcToday],
    ['a nonsense days falls back to the default', { days: 'soon' }, utcToday, addDays(utcToday, 13)],
    [
      '{"from": "2026-10-01", "days": 7} starts on the date',
      { from: '2026-10-01', days: 7 },
      '2026-10-01',
      '2026-10-07',
    ],
    ['an unparseable from is ignored', { from: 'next tuesday', days: 2 }, utcToday, addDays(utcToday, 1)],
  ])('%s', async (_label, params, from, to) => {
    await GET_CALENDAR.run('u1', params as never);
    expect(listOccurrences).toHaveBeenCalledWith('u1', from, to);
  });

  it('names the span it read, and counts rows for provenance', async () => {
    listOccurrences.mockResolvedValue([row('a1', '2026-10-02', 'done'), row('a1', '2026-10-04')]);
    const result = await GET_CALENDAR.run('u1', { from: '2026-10-01', days: 4 });
    const text = GET_CALENDAR.render(result);
    expect(text).toContain('Their calendar as written, 2026-10-01 to 2026-10-04 (✓ done');
    expect(text).toContain('  Fri 2: 06:00 Easy run ✓');
    expect(text).toContain('  Sat 3: — nothing written');
    expect(GET_CALENDAR.rows(result)).toBe(2);
  });

  it('with no active plan reads nothing else and says so — never an empty calendar', async () => {
    getActivePlan.mockResolvedValue(null);
    const result = await GET_CALENDAR.run('u1', {});
    expect(listOccurrences).not.toHaveBeenCalled();
    expect(GET_CALENDAR.render(result)).toMatch(/no active plan/);
    expect(GET_CALENDAR.render(result)).toMatch(/build one/);
    expect(GET_CALENDAR.rows(result)).toBe(0);
  });
});
