import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { coachingMessages, useRotatingMessage } from './coaching-progress.ts';

describe('coachingMessages', () => {
  it('anchors on the task title', () => {
    expect(coachingMessages('Easy run')[0]).toBe('Coaching your Easy run…');
  });

  it('falls back gracefully with no (or blank) title', () => {
    expect(coachingMessages()[0]).toBe('Reading your plan…');
    expect(coachingMessages('   ')[0]).toBe('Reading your plan…');
  });

  it('adds a weather line only for outdoor-sounding tasks', () => {
    expect(coachingMessages('Easy run (zone 2)').some((m) => /conditions/.test(m))).toBe(true);
    expect(coachingMessages('Modified strength + obstacle prep').some((m) => /conditions/.test(m))).toBe(false);
  });

  it("ends on a tail that doesn't over-promise", () => {
    expect(coachingMessages('anything').at(-1)).toBe('Putting it together…');
  });
});

describe('useRotatingMessage', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('advances through messages then holds on the last while active', () => {
    vi.useFakeTimers();
    const msgs = ['a', 'b', 'c'];
    const { result } = renderHook(() => useRotatingMessage(true, msgs, 1000));
    expect(result.current).toBe('a');
    act(() => vi.advanceTimersByTime(1000));
    expect(result.current).toBe('b');
    act(() => vi.advanceTimersByTime(1000));
    expect(result.current).toBe('c');
    act(() => vi.advanceTimersByTime(5000)); // keeps ticking but clamps — never loops back
    expect(result.current).toBe('c');
  });

  it('stays on the first message when inactive (fast fetch — no rotation)', () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useRotatingMessage(false, ['a', 'b'], 1000));
    act(() => vi.advanceTimersByTime(5000));
    expect(result.current).toBe('a');
  });
});
