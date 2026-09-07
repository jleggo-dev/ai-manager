/**
 * The hold, at the wire: it fires only when the finger rests, it never fires under a scroll or a
 * quick tap, and the click the browser sends on release after a hold is swallowed — or the menu
 * would open with the task's own sheet on top of it.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { HOLD_SLOP_PX, LONG_PRESS_MS, useLongPress } from './useLongPress.ts';

// jsdom has no PointerEvent; the hook only reads mouse-shaped fields.
if (!('PointerEvent' in window)) {
  (window as unknown as { PointerEvent: typeof MouseEvent }).PointerEvent = MouseEvent;
}

function Node({ onHold, onClick }: { onHold?: () => void; onClick: () => void }) {
  const hold = useLongPress(onHold);
  return (
    <button {...hold} onClick={onClick}>
      Easy run
    </button>
  );
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const down = (el: HTMLElement, x = 10, y = 10) => fireEvent.pointerDown(el, { button: 0, clientX: x, clientY: y });

describe('useLongPress', () => {
  it('fires after the finger has rested, and swallows the click that follows', () => {
    const onHold = vi.fn();
    const onClick = vi.fn();
    render(<Node onHold={onHold} onClick={onClick} />);
    const el = screen.getByText('Easy run');
    down(el);
    vi.advanceTimersByTime(LONG_PRESS_MS - 1);
    expect(onHold).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onHold).toHaveBeenCalledTimes(1);
    fireEvent.pointerUp(el);
    fireEvent.click(el);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('a quick tap is a tap — no hold, and the click goes through', () => {
    const onHold = vi.fn();
    const onClick = vi.fn();
    render(<Node onHold={onHold} onClick={onClick} />);
    const el = screen.getByText('Easy run');
    down(el);
    vi.advanceTimersByTime(100);
    fireEvent.pointerUp(el);
    fireEvent.click(el);
    vi.advanceTimersByTime(LONG_PRESS_MS);
    expect(onHold).not.toHaveBeenCalled();
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('movement past the slop is a scroll, never a hold', () => {
    const onHold = vi.fn();
    render(<Node onHold={onHold} onClick={() => {}} />);
    const el = screen.getByText('Easy run');
    down(el);
    fireEvent.pointerMove(el, { clientX: 10, clientY: 10 + HOLD_SLOP_PX + 1 });
    vi.advanceTimersByTime(LONG_PRESS_MS);
    expect(onHold).not.toHaveBeenCalled();
  });

  it('a wobble inside the slop still holds', () => {
    const onHold = vi.fn();
    render(<Node onHold={onHold} onClick={() => {}} />);
    const el = screen.getByText('Easy run');
    down(el);
    fireEvent.pointerMove(el, { clientX: 12, clientY: 13 });
    vi.advanceTimersByTime(LONG_PRESS_MS);
    expect(onHold).toHaveBeenCalledTimes(1);
  });

  it('the browser taking the pointer for a scroll cancels the hold', () => {
    const onHold = vi.fn();
    render(<Node onHold={onHold} onClick={() => {}} />);
    const el = screen.getByText('Easy run');
    down(el);
    fireEvent.pointerCancel(el);
    vi.advanceTimersByTime(LONG_PRESS_MS);
    expect(onHold).not.toHaveBeenCalled();
  });

  it('a second, ordinary tap after a hold clicks normally', () => {
    const onHold = vi.fn();
    const onClick = vi.fn();
    render(<Node onHold={onHold} onClick={onClick} />);
    const el = screen.getByText('Easy run');
    down(el);
    vi.advanceTimersByTime(LONG_PRESS_MS);
    fireEvent.pointerUp(el);
    fireEvent.click(el);
    down(el);
    fireEvent.pointerUp(el);
    fireEvent.click(el);
    expect(onHold).toHaveBeenCalledTimes(1);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('with nothing to offer, the node just taps', () => {
    const onClick = vi.fn();
    render(<Node onClick={onClick} />);
    const el = screen.getByText('Easy run');
    down(el);
    vi.advanceTimersByTime(LONG_PRESS_MS);
    fireEvent.pointerUp(el);
    fireEvent.click(el);
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
