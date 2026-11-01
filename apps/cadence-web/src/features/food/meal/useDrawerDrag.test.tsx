/**
 * What the drag MOVES (owner, 2026-11-01: "the whole window should swipe down, not just the text
 * & image"). On the trail the meal sits inside the capture sheet, and the offset went on the meal
 * alone — the words slid down inside a white sheet that stayed put. The table: inside a sheet the
 * sheet moves and its scrim fades; with no sheet around it the drawer itself moves; a scrim that
 * belongs to nothing it is dragging is never touched.
 */
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DRAG_LEAVE_MS, dragTargets, useDrawerDrag } from './useDrawerDrag.ts';

function Drawer({ onClose }: { onClose: () => void }) {
  const drag = useDrawerDrag(onClose);
  return (
    <div ref={drag.ref} className="ms ms-quick" data-testid="drawer">
      <div className="ms-drag" data-testid="grab" {...drag.handlers} />
    </div>
  );
}

function InSheet({ onClose }: { onClose: () => void }) {
  return (
    <>
      <div className="sheet-scrim" data-testid="scrim" />
      <div className="sheet ss" data-testid="sheet">
        <div className="mc mc-cart">
          <Drawer onClose={onClose} />
        </div>
      </div>
    </>
  );
}

const pull = (el: HTMLElement, to: number) => {
  fireEvent.pointerDown(el, { clientY: 0, pointerId: 1 });
  fireEvent.pointerMove(el, { clientY: to, pointerId: 1 });
};

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('dragTargets — what a drag moves', () => {
  it.each([
    ['inside a capture sheet: the sheet, and its scrim', true, 'sheet', 'scrim'],
    ['on its own (the Food screen): the drawer, no scrim', false, 'drawer', null],
  ])('%s', (_name, sheeted, moves, fades) => {
    const { getByTestId } = render(sheeted ? <InSheet onClose={() => {}} /> : <Drawer onClose={() => {}} />);
    const t = dragTargets(getByTestId('drawer'));
    expect(t.sheet).toBe(getByTestId(moves));
    expect(t.scrim).toBe(fades ? getByTestId(fades) : null);
  });

  it('near-miss: a scrim beside a drawer with no sheet is not its scrim', () => {
    const { getByTestId } = render(
      <>
        <div className="sheet-scrim" />
        <Drawer onClose={() => {}} />
      </>,
    );
    expect(dragTargets(getByTestId('drawer')).scrim).toBeNull();
  });
});

describe('useDrawerDrag — the whole sheet follows the finger', () => {
  it('moves the sheet, not the meal inside it, and fades the scrim', () => {
    const { getByTestId } = render(<InSheet onClose={() => {}} />);
    pull(getByTestId('grab'), 120);
    expect(getByTestId('sheet').style.transform).toBe('translateY(120px)');
    expect(getByTestId('drawer').style.transform).toBe('');
    expect(Number(getByTestId('scrim').style.opacity)).toBeLessThan(1);
  });

  it('a short pull settles back and leaves nothing on the sheet', () => {
    const onClose = vi.fn();
    const { getByTestId } = render(<InSheet onClose={onClose} />);
    pull(getByTestId('grab'), 60);
    act(() => vi.advanceTimersByTime(1000));
    fireEvent.pointerUp(getByTestId('grab'), { clientY: 60, pointerId: 1 });
    expect(getByTestId('sheet').style.transform).toBe('');
    expect(getByTestId('scrim').style.opacity).toBe('');
    act(() => vi.advanceTimersByTime(DRAG_LEAVE_MS));
    expect(onClose).not.toHaveBeenCalled();
  });

  it('a long pull carries the sheet off the bottom, then closes', () => {
    const onClose = vi.fn();
    const { getByTestId } = render(<InSheet onClose={onClose} />);
    pull(getByTestId('grab'), 260);
    fireEvent.pointerUp(getByTestId('grab'), { clientY: 260, pointerId: 1 });
    expect(getByTestId('sheet').style.transform).toBe('translateY(100%)');
    expect(getByTestId('scrim').style.opacity).toBe('0');
    expect(onClose).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(DRAG_LEAVE_MS));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
