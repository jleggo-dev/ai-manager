import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useTuningCount } from './useTuningCount.ts';

function advance(ms: number) {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

describe('useTuningCount', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it.each([
    [1, 8_000, 8],
    [2, 8_000, 4], // slower: half as many counts in the same time
    [0.75, 6_000, 8], // quicker
    [1.37, 13_700, 10], // any point on the slider, not just round numbers
  ])('at %f seconds a count, %i ms is %i counts', (pace, ms, counts) => {
    const { result } = renderHook(() => useTuningCount(true, pace));
    advance(ms);
    expect(result.current).toBeCloseTo(counts, 5);
  });

  it('changing pace keeps the place: the counts so far stay, only what follows stretches', () => {
    const { result, rerender } = renderHook(({ pace }) => useTuningCount(true, pace), {
      initialProps: { pace: 1 },
    });
    advance(4_000);
    rerender({ pace: 2 });
    expect(result.current).toBeCloseTo(4, 5); // no jump back to 2, where pace 2 from zero would sit
    advance(4_000);
    expect(result.current).toBeCloseTo(6, 5);
  });

  it('stopping returns to zero, and the next loop starts fresh at the current pace', () => {
    const { result, rerender } = renderHook(({ on, pace }) => useTuningCount(on, pace), {
      initialProps: { on: true, pace: 1 },
    });
    advance(5_000);
    rerender({ on: false, pace: 2 });
    expect(result.current).toBe(0);
    rerender({ on: true, pace: 2 });
    advance(2_000);
    expect(result.current).toBeCloseTo(1, 5);
  });
});
