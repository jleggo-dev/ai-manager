/**
 * The shelf's two gestures and the drawer's one, as tables: a press is a tap, a held press is a
 * hold, a moved press is neither; a sideways drag past the threshold changes shelf, a short one
 * or a vertical one does not; a drag down past the distance (or a flick) lets go of the drawer.
 * All routers that fail silently — the wrong thing happens and nothing throws.
 */
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { DRAG_CLOSE_PX, DRAG_LEAVE_MS, useDrawerDrag } from './useDrawerDrag.ts';
import { HOLD_MS, SWIPE_CHANGE_PX, useHoldTap, useSwipe } from './useShelfGestures.ts';
import { HOLD_SELECTION_SETTLE_MS } from '../../../lib/holdSelection.ts';

const ev = (x: number, y: number, extra: Record<string, unknown> = {}) =>
  ({
    clientX: x,
    clientY: y,
    button: 0,
    pointerId: 1,
    pointerType: 'touch',
    currentTarget: { setPointerCapture: () => {}, getBoundingClientRect: () => ({ top: 0 }) },
    ...extra,
  }) as unknown as ReactPointerEvent<HTMLElement>;

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  // A hold leaves the page's selection guard up until the finger lifts — end it between tests.
  window.dispatchEvent(new Event('pointerup'));
  vi.advanceTimersByTime(HOLD_SELECTION_SETTLE_MS);
  vi.useRealTimers();
});

describe('useHoldTap', () => {
  it.each([
    ['up before the hold', HOLD_MS - 50, 0, 'tap'],
    ['the hold fires', HOLD_MS + 10, 0, 'hold'],
    ['moved too far before up', HOLD_MS - 50, 20, 'none'],
    ['moved too far before the hold would fire', HOLD_MS + 10, 20, 'none'],
  ])('%s → %s', (_name, wait, move, outcome) => {
    const onTap = vi.fn();
    const onHold = vi.fn();
    const { result } = renderHook(() => useHoldTap(onTap, onHold));
    act(() => result.current.onPointerDown(ev(10, 10)));
    if (move) act(() => result.current.onPointerMove(ev(10 + move, 10)));
    act(() => vi.advanceTimersByTime(wait));
    act(() => result.current.onPointerUp(ev(10 + move, 10)));
    act(() => result.current.onClick());
    expect(onTap).toHaveBeenCalledTimes(outcome === 'tap' ? 1 : 0);
    expect(onHold).toHaveBeenCalledTimes(outcome === 'hold' ? 1 : 0);
  });

  it('a hold clears any selection — iOS selects under the sheet the hold opens otherwise', () => {
    const { result } = renderHook(() => useHoldTap(vi.fn(), vi.fn()));
    const words = document.body.appendChild(document.createElement('p'));
    words.textContent = 'Greek yogurt';
    document.getSelection()!.selectAllChildren(words);
    expect(document.getSelection()!.toString()).toBe('Greek yogurt');
    act(() => result.current.onPointerDown(ev(10, 10)));
    act(() => vi.advanceTimersByTime(HOLD_MS + 10));
    expect(document.getSelection()!.toString()).toBe('');
    const e = new Event('selectstart', { bubbles: true, cancelable: true });
    document.body.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(true);
    words.remove();
  });

  it('a bare click (keyboard) is a tap; a tile without onHold never holds', () => {
    const onTap = vi.fn();
    const { result } = renderHook(() => useHoldTap(onTap));
    act(() => result.current.onClick());
    expect(onTap).toHaveBeenCalledTimes(1);
    act(() => result.current.onPointerDown(ev(0, 0)));
    act(() => vi.advanceTimersByTime(HOLD_MS * 2));
    act(() => result.current.onPointerUp(ev(0, 0)));
    expect(onTap).toHaveBeenCalledTimes(2);
  });
});

describe('useSwipe', () => {
  it.each([
    ['left past the threshold', -(SWIPE_CHANGE_PX + 10), 0, 1],
    ['right past the threshold', SWIPE_CHANGE_PX + 10, 0, -1],
    ['too short', -(SWIPE_CHANGE_PX - 10), 0, null],
    ['mostly vertical', -80, 120, null],
  ])('%s', (_name, dx, dy, dir) => {
    const onSwipe = vi.fn();
    const { result } = renderHook(() => useSwipe(onSwipe));
    act(() => result.current.handlers.onPointerDown(ev(100, 100)));
    act(() => result.current.handlers.onPointerMove(ev(100 + dx / 2, 100 + dy / 2)));
    act(() => result.current.handlers.onPointerMove(ev(100 + dx, 100 + dy)));
    act(() => result.current.handlers.onPointerUp(ev(100 + dx, 100 + dy)));
    if (dir == null) expect(onSwipe).not.toHaveBeenCalled();
    else expect(onSwipe).toHaveBeenCalledWith(dir);
    expect(result.current.dx).toBe(0);
    expect(result.current.swiping).toBe(false);
  });

  it('follows the finger once committed', () => {
    const { result } = renderHook(() => useSwipe(() => {}));
    act(() => result.current.handlers.onPointerDown(ev(100, 100)));
    act(() => result.current.handlers.onPointerMove(ev(60, 102)));
    expect(result.current.swiping).toBe(true);
    expect(result.current.dx).toBe(-40);
  });
});

describe('useDrawerDrag', () => {
  it.each([
    ['a long pull', DRAG_CLOSE_PX + 20, 800, true],
    ['a short pull', DRAG_CLOSE_PX - 50, 800, false],
    ['a flick', 120, 50, true],
    ['an upward move', -40, 100, false],
  ])('%s', (_name, dy, ms, closes) => {
    const onClose = vi.fn();
    const { result } = renderHook(() => useDrawerDrag(onClose));
    act(() => result.current.handlers.onPointerDown(ev(50, 20)));
    act(() => result.current.handlers.onPointerMove(ev(50, 20 + dy / 2)));
    act(() => vi.advanceTimersByTime(ms));
    act(() => result.current.handlers.onPointerMove(ev(50, 20 + dy)));
    act(() => result.current.handlers.onPointerUp(ev(50, 20 + dy)));
    expect(result.current.dy).toBe(0);
    expect(result.current.leaving).toBe(closes);
    // The sheet slides off first; the close lands once it is gone.
    expect(onClose).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(DRAG_LEAVE_MS));
    expect(onClose).toHaveBeenCalledTimes(closes ? 1 : 0);
  });
});
