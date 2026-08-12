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

  /**
   * The reported failure, and the reason `onScroll` alone was not enough: streamed deltas run
   * synchronously many times a second, while scroll events are passive and coalesced. Mid-drag the
   * finger loses the race — the delta snaps the view back before the scroll event can detach us.
   * A touch going down has to stop the following immediately.
   */
  it('stops following the moment a finger goes down, before any scroll event', () => {
    const ref = createRef<HTMLElement>();
    const el = makeEl(1000, 500, 500);
    (ref as { current: HTMLElement | null }).current = el;
    const { result, rerender } = renderHook(({ d }) => useStickToBottom(ref, d), { initialProps: { d: 1 } });

    // Mounting follows to the bottom, which is correct — that is the baseline this test moves from.
    expect(el.scrollTop).toBe(1000);

    act(() => result.current.onTouchStart()); // finger down; no scroll event has fired yet
    (el as HTMLElement & { scrollHeight: number }).scrollHeight = 1400;
    rerender({ d: 2 });

    expect(el.scrollTop).toBe(1000); // held where they grabbed it — this used to jump to 1400
  });

  it('resumes following if they let go still at the bottom', () => {
    const ref = createRef<HTMLElement>();
    const el = makeEl(1000, 500, 500);
    (ref as { current: HTMLElement | null }).current = el;
    const { result, rerender } = renderHook(({ d }) => useStickToBottom(ref, d), { initialProps: { d: 1 } });

    act(() => result.current.onTouchStart());
    act(() => result.current.onTouchEnd()); // a tap, not a drag — still at the bottom

    (el as HTMLElement & { scrollHeight: number }).scrollHeight = 1400;
    rerender({ d: 2 });
    expect(el.scrollTop).toBe(1400);
  });

  it('leaves the viewport alone after they drag away and lift', () => {
    const ref = createRef<HTMLElement>();
    const el = makeEl(1000, 500, 500);
    (ref as { current: HTMLElement | null }).current = el;
    const { result, rerender } = renderHook(({ d }) => useStickToBottom(ref, d), { initialProps: { d: 1 } });

    act(() => result.current.onTouchStart());
    el.scrollTop = 0; // dragged to the top
    act(() => result.current.onTouchEnd());

    (el as HTMLElement & { scrollHeight: number }).scrollHeight = 1400;
    rerender({ d: 2 });
    expect(el.scrollTop).toBe(0);
  });

  /** A scroll event mid-drag must not re-arm the follow under their finger. */
  it('ignores scroll events while a finger is still down', () => {
    const ref = createRef<HTMLElement>();
    const el = makeEl(1000, 500, 0);
    (ref as { current: HTMLElement | null }).current = el;
    const { result, rerender } = renderHook(({ d }) => useStickToBottom(ref, d), { initialProps: { d: 1 } });

    act(() => result.current.onTouchStart());
    el.scrollTop = 500; // overshoot back to the bottom mid-drag
    act(() => result.current.onScroll());

    (el as HTMLElement & { scrollHeight: number }).scrollHeight = 1400;
    rerender({ d: 2 });
    expect(el.scrollTop).toBe(500); // still theirs; not snapped to 1400
  });

  /**
   * The device report, twice over: "I can't scroll while Cadence is replying." The touch handlers
   * alone did not fix it, and momentum is why.
   *
   * A flick upward is over as a TOUCH within a few dozen milliseconds — the finger lifts while the
   * content is still travelling, so at that instant the transcript is usually still near the
   * bottom. Reading the position on release therefore re-armed the follow, and the next SSE delta
   * (mid-reply, milliseconds later) slammed it back down. The momentum scroll events that would
   * have detached us arrive after that, far too late.
   */
  it('does not snap back when a delta lands just after a flick lifts off', () => {
    const ref = createRef<HTMLElement>();
    const el = makeEl(1000, 500, 500);
    (ref as { current: HTMLElement | null }).current = el;
    const { result, rerender } = renderHook(({ d }) => useStickToBottom(ref, d), { initialProps: { d: 1 } });

    act(() => result.current.onTouchStart());
    el.scrollTop = 460; // the flick has begun; still inside the at-bottom threshold
    act(() => result.current.onScroll()); // a scroll DID happen — this was a drag, not a tap
    act(() => result.current.onTouchEnd());

    rerender({ d: 2 }); // an SSE delta, while momentum is still carrying them up
    expect(el.scrollTop).toBe(460);
  });

  /** A tap that moves nothing is not a flick — where they are is where they meant to be. */
  it('keeps following after a tap that did not move the transcript', () => {
    const ref = createRef<HTMLElement>();
    const el = makeEl(1000, 500, 500);
    (ref as { current: HTMLElement | null }).current = el;
    const { result, rerender } = renderHook(({ d }) => useStickToBottom(ref, d), { initialProps: { d: 1 } });

    act(() => result.current.onTouchStart());
    act(() => result.current.onTouchEnd()); // no onScroll between them

    rerender({ d: 2 });
    expect(el.scrollTop).toBe(1000);
  });
});
