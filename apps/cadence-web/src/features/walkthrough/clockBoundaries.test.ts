/**
 * The moments a clock chimes, derived from what a tool registers (clockBoundaries.ts). The store
 * arms a timeout per boundary and the pocket tier books a notification per boundary, so the list
 * has to be right and in order: the same arithmetic `positionAt` uses for an interval, the sit's
 * own bell schedule, the halfway turn-over for a two-sided hold, and nothing at the start (the
 * tool announces that inside the Start tap).
 */
import { describe, expect, it } from 'vitest';
import { singleSetPlan } from '@cadence/shared';
import { clockBoundaries, type RunningClockSpec } from './clockBoundaries.ts';
import { CHIME_DONE, CHIME_RECOVER, CHIME_SWITCH, CHIME_WORK } from './tools/chime-tones.ts';

const base = { stepId: 's1', title: 'Step', startedAt: 0, base: 0, chime: true } as const;
const brief = (b: ReturnType<typeof clockBoundaries>[number]) =>
  `${b.atSec}:${b.kind}:${b.label}${b.seconds != null ? `:${b.seconds}` : ''}`;

describe('clockBoundaries', () => {
  it.each<[string, RunningClockSpec, string[]]>([
    ['a timer: the target only', { ...base, kind: 'timer', targetSec: 300 }, ["300:done:Time's up"]],
    [
      'a two-sided hold: halfway, then the target',
      { ...base, kind: 'timer', targetSec: 60, switchSides: true },
      ['30:switch:Switch sides', "60:done:Time's up"],
    ],
    ['one timed set', { ...base, kind: 'timed_set', targetSec: 45 }, ["45:done:Time's up"]],
    ['a circuit move', { ...base, kind: 'circuit_move', targetSec: 30 }, ["30:done:Time's up"]],
    [
      'an interval: warm-up, rounds, cool-down — every handover after the first, then the end',
      {
        ...base,
        kind: 'interval',
        targetSec: 75,
        plan: singleSetPlan({ warmupSec: 10, workSec: 20, recoverSec: 10, rounds: 2, cooldownSec: 5 }),
      },
      [
        '10:work:Work:20',
        '30:recover:Recover:10',
        '40:work:Work:20',
        '60:recover:Recover:10',
        '70:neutral:Cool-down:5',
        '75:done:Done',
      ],
    ],
    [
      'an interval with no warm-up: the first work phase is the start, not a boundary',
      { ...base, kind: 'interval', targetSec: 20, plan: singleSetPlan({ workSec: 5, recoverSec: 5, rounds: 2 }) },
      ['5:recover:Recover:5', '10:work:Work:5', '15:recover:Recover:5', '20:done:Done'],
    ],
    [
      'a sit with bells every 5 min: each bell, and the end',
      { ...base, kind: 'sit', targetSec: 20 * 60, bells: { bells: 'interval', intervalMin: 5 } },
      ['300:bell:Bell', '600:bell:Bell', '900:bell:Bell', '1200:done:Bell'],
    ],
    [
      'a sit with a start and end bell: the end only',
      { ...base, kind: 'sit', targetSec: 10 * 60, bells: { bells: 'start_end', intervalMin: 5 } },
      ['600:done:Bell'],
    ],
    ['a silent sit: nothing', { ...base, kind: 'sit', targetSec: 600, bells: { bells: 'none', intervalMin: 5 } }, []],
    ['the breath pacer: the end of the last round', { ...base, kind: 'breath', targetSec: 96 }, ['96:done:Done']],
  ])('%s', (_name, spec, expected) => {
    expect(clockBoundaries(spec).map(brief)).toEqual(expected);
  });

  it('gives each boundary its voice: rising for work, falling for recover, the flourish at the end, the turn-over halfway; the plain chime otherwise', () => {
    const interval = clockBoundaries({
      ...base,
      kind: 'interval',
      targetSec: 20,
      plan: singleSetPlan({ workSec: 5, recoverSec: 5, rounds: 2 }),
    });
    expect(interval.map((b) => b.tones)).toEqual([CHIME_RECOVER, CHIME_WORK, CHIME_RECOVER, CHIME_DONE]);
    const hold = clockBoundaries({ ...base, kind: 'timer', targetSec: 60, switchSides: true });
    expect(hold.map((b) => b.tones)).toEqual([CHIME_SWITCH, undefined]);
  });

  it('is in order and strictly increasing, so the store can arm them one after another', () => {
    const list = clockBoundaries({
      ...base,
      kind: 'interval',
      targetSec: 0,
      plan: {
        warmupSec: 10,
        sets: [{ workSec: 20, recoverSec: 10, rounds: 3 }],
        restBetweenSetsSec: 60,
        cooldownSec: 0,
      },
    });
    for (let i = 1; i < list.length; i += 1) expect(list[i]!.atSec).toBeGreaterThan(list[i - 1]!.atSec);
  });
});
