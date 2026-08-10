import { act, renderHook } from '@testing-library/react';
import { useFloatingInset } from './useFloatingInset.ts';

/** Captures the observed element + callback so a test can drive a resize. */
let observed: { el: Element; fire: (height: number) => void } | null = null;

class FakeResizeObserver {
  constructor(private cb: ResizeObserverCallback) {}
  observe(el: Element) {
    observed = {
      el,
      fire: (height: number) =>
        this.cb([{ target: el, contentRect: { height } } as unknown as ResizeObserverEntry], this),
    };
  }
  unobserve() {}
  disconnect() {
    observed = null;
  }
}

const el = (offsetHeight: number) => {
  const node = document.createElement('div');
  Object.defineProperty(node, 'offsetHeight', { value: offsetHeight, configurable: true });
  return node;
};

beforeEach(() => {
  observed = null;
  vi.stubGlobal('ResizeObserver', FakeResizeObserver);
});
afterEach(() => vi.unstubAllGlobals());

/**
 * The regression: `.chat` reserved a flat 122px for a floating stack that has since grown capture
 * pills and a two-button confirm bar, and that changes height while in use. Everything past 122
 * was conversation sitting under an opaque control — the pills covering the options you were
 * trying to tap, and the typing dots parked below the fold so it looked like nothing was happening.
 */
describe('useFloatingInset', () => {
  it('reserves the stack’s real height plus breathing room', () => {
    const { result } = renderHook(() => useFloatingInset());
    act(() => result.current.floatRef(el(180)));
    expect(result.current.inset).toBe(180 + 14);
  });

  /**
   * ResizeObserver is a TRIGGER to re-measure, not the source of truth — the element's own
   * offsetHeight is. That way one code path serves both RO and the per-render measurement, and a
   * stale/absent RO report can never disagree with the DOM.
   */
  it('follows the stack as it grows — pills appearing, composer expanding', () => {
    const node = el(120);
    const { result } = renderHook(() => useFloatingInset());
    act(() => result.current.floatRef(node));
    expect(result.current.inset).toBe(134);

    Object.defineProperty(node, 'offsetHeight', { value: 260, configurable: true });
    act(() => observed!.fire(260));
    expect(result.current.inset).toBe(274);
  });

  /**
   * The load-bearing one. ResizeObserver was seen delivering NO callbacks in an embedded WebKit
   * context — not even the initial one it is specified to send — so a re-measure on every render
   * is what actually keeps this correct. Every growth in the stack is render-driven anyway.
   */
  it('re-measures on render even when ResizeObserver never fires', () => {
    const node = el(120);
    const { result, rerender } = renderHook(() => useFloatingInset());
    act(() => result.current.floatRef(node));
    expect(result.current.inset).toBe(134);

    // The pills arrive: the element is taller, and RO says nothing about it.
    Object.defineProperty(node, 'offsetHeight', { value: 240, configurable: true });
    rerender();
    expect(result.current.inset).toBe(254);
  });

  it('ignores a zero height rather than lurching the chat downward mid-teardown', () => {
    const node = el(200);
    const { result } = renderHook(() => useFloatingInset());
    act(() => result.current.floatRef(node));
    Object.defineProperty(node, 'offsetHeight', { value: 0, configurable: true });
    act(() => observed!.fire(0));
    expect(result.current.inset).toBe(214);
  });

  it('falls back to the old constant when there is no element to measure', () => {
    const { result } = renderHook(() => useFloatingInset());
    act(() => result.current.floatRef(null));
    expect(result.current.inset).toBe(122 + 14);
  });

  it('still measures without ResizeObserver', () => {
    vi.unstubAllGlobals();
    vi.stubGlobal('ResizeObserver', undefined);
    const { result } = renderHook(() => useFloatingInset());
    act(() => result.current.floatRef(el(150)));
    expect(result.current.inset).toBe(164);
  });
});
