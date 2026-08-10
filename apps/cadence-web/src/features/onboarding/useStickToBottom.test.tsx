import { createRef } from 'react';
import { act, renderHook } from '@testing-library/react';
import { useStickToBottom } from './useStickToBottom.ts';

/** A scroll container with settable geometry — jsdom gives every element zeroes otherwise. */
function makeEl(scrollHeight: number, clientHeight: number, scrollTop = 0) {
  const el = document.createElement('div');
  Object.defineProperty(el, 'scrollHeight', { value: scrollHeight, writable: true });
  Object.defineProperty(el, 'clientHeight', { value: clientHeight, writable: true });
  el.scrollTop = scrollTop;
  return el;
}

/**
 * The bug these lock down: streaming mutates the turn array on every SSE delta, so an effect that
 * unconditionally pins to the bottom refires dozens of times a second while Cadence is talking.
 * Scrolling up mid-reply wasn't hard, it was impossible.
 */
describe('useStickToBottom', () => {
  it('follows the newest turn while the reader is at the bottom', () => {
    const ref = createRef<HTMLElement>();
    (ref as { current: HTMLElement | null }).current = makeEl(1000, 500, 500);
    const { rerender } = renderHook(({ d }) => useStickToBottom(ref, d), { initialProps: { d: 1 } });

    (ref.current as HTMLElement & { scrollHeight: number }).scrollHeight = 1400;
    rerender({ d: 2 });
    expect(ref.current!.scrollTop).toBe(1400);
  });

  it('leaves the viewport alone once they have scrolled up to read back', () => {
    const ref = createRef<HTMLElement>();
    const el = makeEl(1000, 500, 500);
    (ref as { current: HTMLElement | null }).current = el;
    const { result, rerender } = renderHook(({ d }) => useStickToBottom(ref, d), { initialProps: { d: 1 } });

    el.scrollTop = 0; // they scrolled to the top
    act(() => result.current.onScroll());

    // A streamed delta arrives — this is the moment that used to yank them back down.
    (el as HTMLElement & { scrollHeight: number }).scrollHeight = 1400;
    rerender({ d: 2 });
    expect(el.scrollTop).toBe(0);
  });

  it('resumes following when they scroll back down to the newest turn', () => {
    const ref = createRef<HTMLElement>();
    const el = makeEl(1000, 500, 0);
    (ref as { current: HTMLElement | null }).current = el;
    const { result, rerender } = renderHook(({ d }) => useStickToBottom(ref, d), { initialProps: { d: 1 } });

    act(() => result.current.onScroll()); // at top → detached
    el.scrollTop = 500; // back to the bottom
    act(() => result.current.onScroll());

    (el as HTMLElement & { scrollHeight: number }).scrollHeight = 1400;
    rerender({ d: 2 });
    expect(el.scrollTop).toBe(1400);
  });

  it('re-arms on stickNow, because their own message is what they are waiting for', () => {
    const ref = createRef<HTMLElement>();
    const el = makeEl(1000, 500, 0);
    (ref as { current: HTMLElement | null }).current = el;
    const { result, rerender } = renderHook(({ d }) => useStickToBottom(ref, d), { initialProps: { d: 1 } });

    act(() => result.current.onScroll()); // detached at the top
    act(() => result.current.stickNow());

    (el as HTMLElement & { scrollHeight: number }).scrollHeight = 1400;
    rerender({ d: 2 });
    expect(el.scrollTop).toBe(1400);
  });

  it('counts "near enough" to the bottom as still following', () => {
    const ref = createRef<HTMLElement>();
    const el = makeEl(1000, 500, 460); // 40px from the bottom, inside the 80px threshold
    (ref as { current: HTMLElement | null }).current = el;
    const { result, rerender } = renderHook(({ d }) => useStickToBottom(ref, d), { initialProps: { d: 1 } });

    act(() => result.current.onScroll());
    (el as HTMLElement & { scrollHeight: number }).scrollHeight = 1400;
    rerender({ d: 2 });
    expect(el.scrollTop).toBe(1400);
  });
});
