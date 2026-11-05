/**
 * The keep-awake switch is one bit with two holders — the running clock (from the app root) and
 * the metronome. Counted, so the metronome stopping mid-timer never drops the timer's hold: the
 * lock is taken by the first holder, released by the last, and a release with nobody holding is
 * ignored rather than counted below zero.
 */
import { describe, expect, it, vi } from 'vitest';
import { countedKeepAwake } from './keep-awake.ts';

const make = () => {
  const inner = vi.fn(async (_on: boolean) => undefined);
  return { inner, cap: countedKeepAwake({ set: inner }) };
};
const calls = (inner: ReturnType<typeof vi.fn>) => inner.mock.calls.map(([on]) => on);

describe('countedKeepAwake', () => {
  it.each<[string, boolean[], boolean[]]>([
    ['one holder on, then off', [true, false], [true, false]],
    [
      'two holders: the second on is silent, the first off is silent, the last off releases',
      [true, true, false, false],
      [true, false],
    ],
    ['a release with nobody holding is ignored', [false, false], []],
    [
      'never below zero: an extra release does not make the next hold silent',
      [true, false, false, true],
      [true, false, true],
    ],
    ['metronome start and stop during a running clock leaves the clock held', [true, true, false], [true]],
    ['held again after everyone let go takes the lock again', [true, false, true], [true, false, true]],
  ])('%s', async (_name, sequence, expected) => {
    const { inner, cap } = make();
    for (const on of sequence) await cap.set(on);
    expect(calls(inner)).toEqual(expected);
  });
});
