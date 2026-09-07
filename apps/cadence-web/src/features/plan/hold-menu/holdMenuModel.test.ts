/**
 * The hold menu's routers, as tables — positives AND near-misses, because the wrong door opens
 * silently: "do it now" showing on a done row, a skipped row losing it, a fortnightly rule read
 * as daily, or a future breakfast moved without the second ask.
 */
import { describe, it, expect } from 'vitest';
import type { PlanDay, PlanOccurrence } from '../../../lib/api.ts';
import {
  dayChoices,
  dayName,
  dayRelation,
  doNowStep,
  holdActions,
  isEveryDay,
  isEveryDayTask,
} from './holdMenuModel.ts';

const TODAY = '2026-09-07';
const WEEK_DATES = ['2026-09-07', '2026-09-08', '2026-09-09', '2026-09-10', '2026-09-11', '2026-09-12', '2026-09-13'];

const occ = (over: Partial<PlanOccurrence> = {}): PlanOccurrence => ({
  occurrence_id: 'o1',
  activity_id: 'a1',
  title: 'Easy run',
  kind: 'user',
  status: 'pending',
  ...over,
});

const day = (date: string, weekday: string, dayNum: number, occurrences: PlanOccurrence[] = []): PlanDay => ({
  date,
  weekday,
  dayNum,
  isToday: date === TODAY,
  occurrences,
});

describe('dayRelation', () => {
  it.each([
    ['2026-09-06', 'past'],
    ['2026-09-07', 'today'],
    ['2026-09-08', 'future'],
    ['2026-08-31', 'past'],
  ])('%s → %s', (date, rel) => {
    expect(dayRelation(date, TODAY)).toBe(rel);
  });
});

describe('holdActions', () => {
  it.each([
    ['pending, today', 'pending', '2026-09-07', ['do_now', 'move', 'duplicate', 'delete']],
    ['pending, later this week', 'pending', '2026-09-10', ['do_now', 'move', 'duplicate', 'delete']],
    [
      'skipped keeps do-it-now — skipped is not finished',
      'skipped',
      '2026-09-07',
      ['do_now', 'move', 'duplicate', 'delete'],
    ],
    ['missed keeps it too', 'missed', '2026-09-07', ['do_now', 'move', 'duplicate', 'delete']],
    ['done loses it', 'done', '2026-09-07', ['move', 'duplicate', 'delete']],
    ['paused (shelved by a detour) loses it', 'paused', '2026-09-08', ['move', 'duplicate', 'delete']],
    ['pending but last week — not this week', 'pending', '2026-09-03', ['move', 'duplicate', 'delete']],
    ['pending but past the horizon', 'pending', '2026-09-14', ['move', 'duplicate', 'delete']],
  ])('%s', (_name, status, date, expected) => {
    expect(holdActions({ status: status as PlanOccurrence['status'] }, date, WEEK_DATES)).toEqual(expected);
  });
});

describe('isEveryDay', () => {
  it.each([
    ['FREQ=DAILY', true],
    ['FREQ=DAILY;INTERVAL=1', true],
    ['freq=daily', true],
    ['FREQ=DAILY;INTERVAL=2', false],
    ['FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR,SA,SU', false],
    ['FREQ=WEEKLY;BYDAY=MO', false],
    ['', false],
    [null, false],
    [undefined, false],
  ])('%s → %s', (rule, expected) => {
    expect(isEveryDay(rule)).toBe(expected);
  });
});

describe('isEveryDayTask', () => {
  const acts = [
    { activity_id: 'daily', recurrence: 'FREQ=DAILY' },
    { activity_id: 'mwf', recurrence: 'FREQ=WEEKLY;BYDAY=MO,WE,FR' },
  ];
  it.each([
    ['a daily activity', occ({ activity_id: 'daily' }), true],
    ['a Mon/Wed/Fri one', occ({ activity_id: 'mwf' }), false],
    ['a meal system row with no rule on file', occ({ activity_id: 'x', title: 'Log breakfast', kind: 'system' }), true],
    [
      'a user row that merely mentions lunch',
      occ({ activity_id: 'x', title: 'Walk after lunch', kind: 'user' }),
      false,
    ],
    ['a weigh-in system row', occ({ activity_id: 'x', title: 'Weigh-in', kind: 'system' }), false],
  ])('%s', (_name, o, expected) => {
    expect(isEveryDayTask(o, acts)).toBe(expected);
  });
});

describe('dayName', () => {
  const week = [day('2026-09-07', 'Mon', 7), day('2026-09-08', 'Tue', 8), day('2026-09-09', 'Wed', 9)];
  it.each([
    ['2026-09-07', 'Today'],
    ['2026-09-08', 'Tomorrow'],
    ['2026-09-09', 'Wed 9'],
    ['2026-09-03', 'Thu 3'], // last week — not in the list, named from the date itself
  ])('%s → %s', (date, label) => {
    expect(dayName(date, week, TODAY)).toBe(label);
  });
});

describe('dayChoices', () => {
  it('marks the days that already hold this task — its own day included', () => {
    const week = [
      day('2026-09-07', 'Mon', 7, [occ({ occurrence_id: 'o0', activity_id: 'a1', status: 'done' })]),
      day('2026-09-08', 'Tue', 8),
      day('2026-09-09', 'Wed', 9, [occ({ occurrence_id: 'o1', activity_id: 'a1' })]),
      day('2026-09-10', 'Thu', 10, [occ({ occurrence_id: 'o9', activity_id: 'other' })]),
    ];
    expect(dayChoices(week, occ(), TODAY)).toEqual([
      { date: '2026-09-07', label: 'Today', taken: true },
      { date: '2026-09-08', label: 'Tomorrow', taken: false },
      { date: '2026-09-09', label: 'Wed 9', taken: true },
      { date: '2026-09-10', label: 'Thu 10', taken: false },
    ]);
  });
});

describe('doNowStep', () => {
  const acts = [{ activity_id: 'meal', recurrence: 'FREQ=DAILY' }];
  const week = [
    day('2026-09-07', 'Mon', 7, [
      occ({ occurrence_id: 'today-meal', activity_id: 'meal', title: 'Log lunch', kind: 'system' }),
    ]),
    day('2026-09-08', 'Tue', 8, [
      occ({ occurrence_id: 'tmrw-meal', activity_id: 'meal', title: 'Log lunch', kind: 'system' }),
      occ({ occurrence_id: 'tmrw-run', activity_id: 'run' }),
    ]),
  ];

  it("today's task just opens", () => {
    expect(doNowStep(occ(), TODAY, TODAY, week, acts)).toEqual({ kind: 'open' });
  });

  it('a past task (last week, logged late) just opens too', () => {
    expect(doNowStep(occ(), '2026-09-03', TODAY, week, acts)).toEqual({ kind: 'open' });
  });

  it("tomorrow's run asks to move, with no twin today and no second ask", () => {
    expect(doNowStep(occ({ activity_id: 'run' }), '2026-09-08', TODAY, week, acts)).toEqual({
      kind: 'ask_move',
      everyDay: false,
      twin: null,
    });
  });

  it("tomorrow's lunch asks twice, and names today's own lunch as the row to open", () => {
    expect(
      doNowStep(occ({ activity_id: 'meal', title: 'Log lunch', kind: 'system' }), '2026-09-08', TODAY, week, acts),
    ).toEqual({
      kind: 'ask_move',
      everyDay: true,
      twin: { occurrence_id: 'today-meal', status: 'pending' },
    });
  });
});
