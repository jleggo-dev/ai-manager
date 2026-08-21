/**
 * PERF-08's narration, asserted where a person would see it.
 *
 * Tapping a workout takes ~34s on a first open because the coach genuinely writes the session. The
 * sheet held ONE static line for all of it, which after ten seconds is indistinguishable from a
 * hang. These tests cover the two ways that fix silently fails: the line never appearing, and the
 * ticker outliving the sheet.
 *
 * This repo has twice shipped a status line that was correct in its unit test and never reached the
 * screen (PLAN.md, 2026-08-17 and 2026-08-21), so the last case renders the real sheet.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useSessionPrepLine } from './useSessionPrepLine.ts';

afterEach(() => vi.useRealTimers());

describe('useSessionPrepLine', () => {
  it('says something specific from the first frame — never a blank under the dots', () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useSessionPrepLine(true));
    expect(result.current).toBe('Opening this session…');
  });

  it('moves through the wait, which is the whole point', () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useSessionPrepLine(true));

    act(() => void vi.advanceTimersByTime(9000));
    expect(result.current).toBe('Reading back how the last few went…');

    act(() => void vi.advanceTimersByTime(15000));
    expect(result.current).toBe('Writing it out for you…');
  });

  /** A generation slower than the script must not blank the screen at the end of it. */
  it('holds the last line past the measured 34s', () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useSessionPrepLine(true));
    act(() => void vi.advanceTimersByTime(120_000));
    expect(result.current).toBe('Nearly there — putting the pieces in order…');
  });

  it('is silent when the sheet is not loading', () => {
    const { result } = renderHook(() => useSessionPrepLine(false));
    expect(result.current).toBe('');
  });

  /** A ticker left running behind a closed sheet is a leak with a status message attached. */
  it('stops ticking when the sheet goes away', () => {
    vi.useFakeTimers();
    const clear = vi.spyOn(globalThis, 'clearInterval');
    const { unmount } = renderHook(() => useSessionPrepLine(true));
    unmount();
    expect(clear).toHaveBeenCalled();
  });
});
