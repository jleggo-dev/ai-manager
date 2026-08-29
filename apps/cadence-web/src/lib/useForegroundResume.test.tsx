import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

const isNativePlatform = vi.fn<() => boolean>();
let appStateHandler: ((s: { isActive: boolean }) => void) | null = null;
const removeListener = vi.fn();

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => isNativePlatform() },
}));
vi.mock('@capacitor/app', () => ({
  App: {
    addListener: (_event: string, handler: (s: { isActive: boolean }) => void) => {
      appStateHandler = handler;
      return Promise.resolve({ remove: removeListener });
    },
  },
}));

import { useForegroundResume } from './useForegroundResume.ts';

function goVisible() {
  Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
  document.dispatchEvent(new Event('visibilitychange'));
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  appStateHandler = null;
  isNativePlatform.mockReturnValue(false);
});
afterEach(() => {
  vi.useRealTimers();
});

describe('useForegroundResume — the doorbell for a boot the background suspended', () => {
  it('fires on the web signal (visibilitychange to visible)', () => {
    const onResume = vi.fn();
    renderHook(() => useForegroundResume(onResume));
    act(goVisible);
    expect(onResume).toHaveBeenCalledTimes(1);
  });

  it('fires on the native signal, which visibilitychange does not reliably cover across a suspend', async () => {
    isNativePlatform.mockReturnValue(true);
    const onResume = vi.fn();
    renderHook(() => useForegroundResume(onResume));
    await act(async () => {}); // let the listener registration promise settle
    act(() => appStateHandler?.({ isActive: true }));
    expect(onResume).toHaveBeenCalledTimes(1);
  });

  it('a background transition is not a resume', async () => {
    isNativePlatform.mockReturnValue(true);
    const onResume = vi.fn();
    renderHook(() => useForegroundResume(onResume));
    await act(async () => {});
    act(() => appStateHandler?.({ isActive: false }));
    expect(onResume).not.toHaveBeenCalled();
  });

  it('both signals inside one return deliver ONE resume, not two', async () => {
    isNativePlatform.mockReturnValue(true);
    const onResume = vi.fn();
    renderHook(() => useForegroundResume(onResume));
    await act(async () => {});
    act(() => {
      appStateHandler?.({ isActive: true });
      goVisible();
    });
    expect(onResume).toHaveBeenCalledTimes(1);
  });

  it('a later return fires again — the guard dedupes a moment, never the feature', async () => {
    isNativePlatform.mockReturnValue(true);
    const onResume = vi.fn();
    renderHook(() => useForegroundResume(onResume));
    await act(async () => {});
    act(() => appStateHandler?.({ isActive: true }));
    act(() => vi.advanceTimersByTime(1_000));
    act(() => appStateHandler?.({ isActive: true }));
    expect(onResume).toHaveBeenCalledTimes(2);
  });

  it('always sees the LATEST callback — a stale closure would retry a screen that no longer exists', () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = renderHook(({ cb }) => useForegroundResume(cb), { initialProps: { cb: first } });
    rerender({ cb: second });
    act(goVisible);
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('unmount removes the web listener', () => {
    const onResume = vi.fn();
    const { unmount } = renderHook(() => useForegroundResume(onResume));
    unmount();
    act(goVisible);
    expect(onResume).not.toHaveBeenCalled();
  });
});
