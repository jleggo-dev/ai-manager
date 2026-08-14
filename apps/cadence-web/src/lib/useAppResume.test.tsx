import { renderHook } from '@testing-library/react';
import { useAppResume } from './useAppResume.ts';

const addListener = vi.fn();
vi.mock('@capacitor/app', () => ({
  App: { addListener: (...a: unknown[]) => addListener(...a) },
}));

const remove = vi.fn();
beforeEach(() => {
  vi.clearAllMocks();
  addListener.mockResolvedValue({ remove });
});

/** jsdom has no way to set `document.hidden`, so drive it directly. */
function setHidden(hidden: boolean) {
  Object.defineProperty(document, 'hidden', { configurable: true, value: hidden });
}

describe('useAppResume', () => {
  it('fires when the page becomes visible again, and not when it is being hidden', () => {
    const onResume = vi.fn();
    renderHook(() => useAppResume(onResume));

    setHidden(true);
    document.dispatchEvent(new Event('visibilitychange'));
    expect(onResume).not.toHaveBeenCalled();

    setHidden(false);
    document.dispatchEvent(new Event('visibilitychange'));
    expect(onResume).toHaveBeenCalledTimes(1);
  });

  it('fires on the native app becoming active, and ignores it going to background', async () => {
    const onResume = vi.fn();
    renderHook(() => useAppResume(onResume));
    const handler = addListener.mock.calls[0]![1] as (s: { isActive: boolean }) => void;

    handler({ isActive: false });
    expect(onResume).not.toHaveBeenCalled();
    handler({ isActive: true });
    expect(onResume).toHaveBeenCalledTimes(1);
  });

  it('always calls the LATEST callback without re-subscribing', () => {
    setHidden(false);
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = renderHook(({ cb }) => useAppResume(cb), { initialProps: { cb: first } });
    rerender({ cb: second });

    document.dispatchEvent(new Event('visibilitychange'));
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
    // Re-subscribing per render would heal the same turn once per render.
    expect(addListener).toHaveBeenCalledTimes(1);
  });

  it('stops listening once unmounted — both doors', async () => {
    const onResume = vi.fn();
    const { unmount } = renderHook(() => useAppResume(onResume));
    const handler = addListener.mock.calls[0]![1] as (s: { isActive: boolean }) => void;
    unmount();
    // The Capacitor handle is a promise, so its removal lands a few microtasks after unmount.
    await new Promise((r) => setTimeout(r, 0));

    setHidden(false);
    document.dispatchEvent(new Event('visibilitychange'));
    handler({ isActive: true });
    expect(onResume).not.toHaveBeenCalled();
    expect(remove).toHaveBeenCalled();
  });
});
