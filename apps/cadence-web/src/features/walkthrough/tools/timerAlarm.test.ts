/**
 * The pocket tier (walkthrough v3 Phase 7c): the running clock's next boundaries are booked as
 * fixed-moment notifications, from the same list the store chimes from, so a pocketed or locked
 * phone still rings. What these pin: the boundaries come out in order and never more than K (eight);
 * the body names the moment in plain words and the title is the step's; a pause cancels, a resume
 * books again (cancel first, which the capability does inside `scheduleAlarms`); a finish cancels;
 * and on the web, where nothing can be booked, nothing is asked.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { singleSetPlan } from '@cadence/shared';

const notif = vi.hoisted(() => ({
  available: true,
  schedule: vi.fn(async (_alarms: unknown[]) => true),
  cancel: vi.fn(async () => undefined),
}));
vi.mock('../../../lib/capability/index.ts', async (orig) => ({
  ...(await orig<typeof import('../../../lib/capability/index.ts')>()),
  capabilities: {
    localNotifications: {
      isAvailable: () => notif.available,
      scheduleAlarms: (alarms: unknown[]) => notif.schedule(alarms),
      cancelAlarms: () => notif.cancel(),
    },
    keepAwake: { set: async () => undefined },
  },
}));
vi.mock('./chime.ts', async (orig) => ({
  ...(await orig<typeof import('./chime.ts')>()),
  playChime: vi.fn(),
  playTones: vi.fn(),
}));

const { pendingBoundaries, wirePocketBells } = await import('./timerAlarm.ts');
const { registerClock, unregisterClock } = await import('../runningClock.ts');
const { BOUNDARY_ALARM_COUNT } = await import('../../../lib/capability/index.ts');
type Spec = Parameters<typeof pendingBoundaries>[0];

const T0 = Date.parse('2026-11-04T10:00:00Z');
const base = { stepId: 's1', title: 'Bike sprints', startedAt: T0, base: 0, chime: true } as const;
const brief = (alarms: ReturnType<typeof pendingBoundaries>) => alarms.map((a) => `${(a.at - T0) / 1000}:${a.body}`);
const booked = () => (notif.schedule.mock.calls.at(-1)?.[0] ?? []) as ReturnType<typeof pendingBoundaries>;

let unwire = () => undefined as void;
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(T0);
  notif.available = true;
  notif.schedule.mockClear();
  notif.cancel.mockClear();
  unwire = wirePocketBells();
});
afterEach(() => {
  unregisterClock();
  unwire();
  vi.useRealTimers();
});

describe('pendingBoundaries — the next boundaries as alarms', () => {
  it.each<[string, Spec, string[]]>([
    [
      'an interval: warm-up, rounds, cool-down, the end',
      {
        ...base,
        kind: 'interval',
        targetSec: 75,
        plan: singleSetPlan({ warmupSec: 10, workSec: 20, recoverSec: 10, rounds: 2, cooldownSec: 5 }),
      },
      ['10:Work · 20 s', '30:Recover · 10 s', '40:Work · 20 s', '60:Recover · 10 s', '70:Cool-down · 5 s', '75:Done'],
    ],
    ['a timed set: the target', { ...base, kind: 'timed_set', targetSec: 45 }, ["45:Time's up"]],
    [
      'a two-sided hold: the halfway chime, then the target',
      { ...base, kind: 'timer', targetSec: 60, switchSides: true },
      ['30:Switch sides', "60:Time's up"],
    ],
    [
      'a sit with bells every 5 min: each bell and the end',
      { ...base, kind: 'sit', targetSec: 20 * 60, bells: { bells: 'interval', intervalMin: 5 } },
      ['300:Bell', '600:Bell', '900:Bell', '1200:Bell'],
    ],
  ])('%s — in order, titled by the step', (_name, spec, expected) => {
    const alarms = pendingBoundaries(spec, T0);
    expect(brief(alarms)).toEqual(expected);
    expect(alarms.every((a) => a.title === 'Bike sprints')).toBe(true);
  });

  it('never more than K: a 20-round interval books only the next eight', () => {
    const spec: Spec = {
      ...base,
      kind: 'interval',
      targetSec: 0,
      plan: singleSetPlan({ workSec: 20, recoverSec: 10, rounds: 20 }),
    };
    const alarms = pendingBoundaries(spec, T0);
    expect(alarms).toHaveLength(BOUNDARY_ALARM_COUNT);
    expect(brief(alarms)).toEqual([
      '20:Recover · 10 s',
      '30:Work · 20 s',
      '50:Recover · 10 s',
      '60:Work · 20 s',
      '80:Recover · 10 s',
      '90:Work · 20 s',
      '110:Recover · 10 s',
      '120:Work · 20 s',
    ]);
  });

  it('only what is still ahead: a clock resumed with seconds banked books from where it is', () => {
    const spec: Spec = {
      ...base,
      kind: 'interval',
      targetSec: 0,
      base: 35,
      plan: singleSetPlan({ workSec: 20, recoverSec: 10, rounds: 2 }),
    };
    // The boundaries at 50 s and 60 s into the run, seen from 35 s; the one at 30 s is behind.
    expect(brief(pendingBoundaries(spec, T0))).toEqual(['15:Recover · 10 s', '25:Done']);
  });

  it('a silent sit, or an effort already past its target, books nothing', () => {
    expect(
      pendingBoundaries({ ...base, kind: 'sit', targetSec: 600, bells: { bells: 'none', intervalMin: 5 } }, T0),
    ).toEqual([]);
    expect(pendingBoundaries({ ...base, kind: 'timer', targetSec: 60, startedAt: T0 - 61_000 }, T0)).toEqual([]);
  });
});

describe('the store books and cancels the boundaries', () => {
  const hold: Spec = { ...base, kind: 'timer', targetSec: 60, switchSides: true };

  it('registering books the next boundaries; a pause (unregister) cancels them all', () => {
    registerClock(hold);
    expect(notif.schedule).toHaveBeenCalledTimes(1);
    expect(brief(booked())).toEqual(['30:Switch sides', "60:Time's up"]);
    unregisterClock();
    expect(notif.cancel).toHaveBeenCalledTimes(1);
  });

  it('a resume books again from the new instant (the capability cancels the old ones first)', () => {
    registerClock(hold);
    vi.setSystemTime(T0 + 10_000);
    unregisterClock(); // paused at 10 s
    vi.setSystemTime(T0 + 25_000);
    registerClock({ ...hold, startedAt: T0 + 25_000, base: 10 }); // resumed with 10 s banked
    expect(notif.schedule).toHaveBeenCalledTimes(2);
    expect(booked().map((a) => a.at)).toEqual([T0 + 25_000 + 20_000, T0 + 25_000 + 50_000]);
  });

  it('a skip, a restart or an edit is a new registration: booked again', () => {
    registerClock(hold);
    registerClock({ ...hold, chime: false }); // the chime switched off: still rebooked, the OS sound is its own
    registerClock({ ...hold, startedAt: T0 + 5_000, base: 40 }); // skipped ahead
    expect(notif.schedule).toHaveBeenCalledTimes(3);
    expect(brief(booked()).map((s) => s.split(':')[1])).toEqual(["Time's up"]);
  });

  it('a finish cancels everything', () => {
    registerClock(hold);
    unregisterClock('s1');
    expect(notif.cancel).toHaveBeenCalledTimes(1);
  });

  it('on the web nothing is booked and nothing is asked', () => {
    notif.available = false;
    registerClock(hold);
    unregisterClock();
    expect(notif.schedule).not.toHaveBeenCalled();
    expect(notif.cancel).not.toHaveBeenCalled();
  });
});
