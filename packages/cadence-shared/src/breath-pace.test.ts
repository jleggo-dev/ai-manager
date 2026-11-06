import { describe, expect, it } from 'vitest';
import {
  DEFAULT_BREATH_PACE,
  MAX_BREATH_PACE,
  MIN_BREATH_PACE,
  breathPaceCeiling,
  breathPaceFloor,
  canSetBreathPace,
  clampBreathPace,
} from './breath-pace.ts';
import {
  BREATH_PATTERNS,
  MAX_HOLD_SECONDS,
  MAX_SESSION_SECONDS,
  breathPhaseKind,
  patternById,
  totalSeconds,
} from './breathing.ts';

describe('breath pace range', () => {
  it.each([
    ['box', 6, MAX_BREATH_PACE], // 4-count holds never reach the cap inside the range
    ['coherent', 6, MAX_BREATH_PACE], // no holds at all
    ['equal', 6, MAX_BREATH_PACE],
    ['wind_down', 6, MAX_HOLD_SECONDS / 7], // the 7-count hold is what binds
    ['box', 30, MAX_SESSION_SECONDS / (16 * 30)], // 480 s of box: the session cap binds, not the hold
    ['box', 37, MAX_SESSION_SECONDS / (16 * 37)], // prescribed right at the cap: almost no room
    ['up_shift', 6, DEFAULT_BREATH_PACE], // Sharpen does not stretch
  ])('%s × %i rounds slows to at most %f', (id, cycles, ceiling) => {
    expect(breathPaceCeiling(patternById(id), cycles)).toBeCloseTo(ceiling, 6);
  });

  it('only Sharpen is left out, and it cannot go quicker either', () => {
    const fixed = BREATH_PATTERNS.filter((p) => !canSetBreathPace(p)).map((p) => p.id);
    expect(fixed).toEqual(['up_shift']);
    expect(breathPaceFloor(patternById('up_shift'))).toBe(DEFAULT_BREATH_PACE);
    expect(breathPaceFloor(patternById('box'))).toBe(MIN_BREATH_PACE);
  });

  it('the slowest pace of every pattern keeps every hold and the whole run inside the caps', () => {
    for (const pattern of BREATH_PATTERNS) {
      for (const cycles of [1, 6, 20, 37, 60]) {
        const pace = clampBreathPace(pattern, cycles, 99);
        const holds = pattern.phases.filter((p) => breathPhaseKind(p.label) === 'hold');
        for (const hold of holds) expect(hold.seconds * pace).toBeLessThanOrEqual(MAX_HOLD_SECONDS + 1e-9);
        expect(totalSeconds(pattern, cycles) * pace).toBeLessThanOrEqual(MAX_SESSION_SECONDS + 1e-9);
      }
    }
  });
});

describe('clampBreathPace', () => {
  const box = patternById('box');

  it.each([
    [1.37, 1.37], // any point on the track is kept: the slider is smooth, not stepped
    [0.75, 0.75],
    [2, 2],
    [0.2, MIN_BREATH_PACE],
    [5, MAX_BREATH_PACE],
    [Number.NaN, DEFAULT_BREATH_PACE],
    [Number.POSITIVE_INFINITY, DEFAULT_BREATH_PACE],
    [null, DEFAULT_BREATH_PACE],
    [undefined, DEFAULT_BREATH_PACE],
  ])('box at %s plays at %s', (asked, played) => {
    expect(clampBreathPace(box, 6, asked)).toBe(played);
  });

  it('a pace set on box is narrowed, not lost, when a tighter pattern plays', () => {
    expect(clampBreathPace(patternById('wind_down'), 6, 1.8)).toBeCloseTo(MAX_HOLD_SECONDS / 7, 6);
    expect(clampBreathPace(patternById('up_shift'), 6, 1.8)).toBe(DEFAULT_BREATH_PACE);
    expect(clampBreathPace(box, 6, 1.8)).toBe(1.8);
  });
});
