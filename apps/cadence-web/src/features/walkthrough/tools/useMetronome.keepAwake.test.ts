/**
 * The screen stays on while the metronome clicks, and ONLY then (owner, 2026-11-01). A practice
 * with nobody touching the phone auto-locked it and silenced the click; the opposite failure — a
 * screen left held after the click stopped or the step closed — would drain a battery in a pocket
 * and nothing would ever say so.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';

const set = vi.fn(async (_on: boolean) => undefined);
vi.mock('../../../lib/capability/index.ts', () => ({ capabilities: { keepAwake: { set } } }));

const { useMetronome } = await import('./useMetronome.ts');

afterEach(() => {
  set.mockClear();
  localStorage.clear();
});

describe('useMetronome keeps the screen on while it clicks', () => {
  it('holds nothing when the dock is merely open', () => {
    renderHook(() => useMetronome({ bpm: 72, meter: 4 }, 'Scales'));
    expect(set).not.toHaveBeenCalled();
  });

  it('holds on start and lets go on stop', () => {
    const { result } = renderHook(() => useMetronome({ bpm: 72, meter: 4 }, 'Scales'));
    act(() => result.current.toggle());
    expect(set).toHaveBeenLastCalledWith(true);
    act(() => result.current.toggle());
    expect(set).toHaveBeenLastCalledWith(false);
  });

  it('lets go when the step closes mid-click', () => {
    const { result, unmount } = renderHook(() => useMetronome({ bpm: 72, meter: 4 }, 'Scales'));
    act(() => result.current.toggle());
    unmount();
    expect(set).toHaveBeenLastCalledWith(false);
  });
});
