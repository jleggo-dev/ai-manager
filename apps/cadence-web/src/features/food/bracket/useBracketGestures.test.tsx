/**
 * The engine at the INTENT-LOCK level (full drag choreography is exercised in integration):
 *   • a vertical move never becomes a gesture — the scroll wins, always;
 *   • a member dragged left past the commit line leaves its part; short of it, nothing fires;
 *   • a loose row dragged right joins the bracket next door — and does nothing with no neighbour;
 *   • the notch is a dedicated handle: grabs at once, and its span takes only contiguous loose rows;
 *   • long-press fires only when the pointer has not moved.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import type { MealItem, MealPart } from '@cadence/shared';
import { orderedRows, type BracketRow } from './partModel.ts';
import {
  adjacentPartFor,
  dragAxis,
  groupSpan,
  resizeDiff,
  useBracketGestures,
  COMMIT_PX,
  LONG_PRESS_MS,
  type BracketGestureCallbacks,
} from './useBracketGestures.ts';

// jsdom has no PointerEvent; the engine only reads mouse-shaped fields plus pointerId (defaulted).
if (!('PointerEvent' in window)) {
  (window as unknown as { PointerEvent: typeof MouseEvent }).PointerEvent = MouseEvent;
}

function Harness({ rows, cb }: { rows: BracketRow[]; cb: BracketGestureCallbacks }) {
  const g = useBracketGestures(rows, cb);
  return (
    <div>
      {rows.map((r, i) =>
        r.kind === 'item' ? (
          <div key={i} data-testid={`rowwrap-${i}`} ref={g.registerRow(i)}>
            <button data-testid={`notch-${i}`} {...g.notchProps(i, r.index)} />
            <div data-testid={`row-${i}`} {...g.rowProps(i, r.index)} />
          </div>
        ) : (
          <div key={i} data-testid={`rowwrap-${i}`} ref={g.registerRow(i)}>
            {r.memberIndexes.map((m) => (
              <div key={m} data-testid={`member-${m}`} {...g.memberProps(r.part.key, m)} ref={g.registerMember(m)} />
            ))}
          </div>
        ),
      )}
      <output data-testid="drag">{g.drag.kind}</output>
    </div>
  );
}

const bracketed = (): BracketRow[] => {
  const items: MealItem[] = [
    { name: 'yogurt', est: { kcal: 146 }, part: 'p1' },
    { name: 'chia', est: { kcal: 58 }, part: 'p1' },
    { name: 'muffin', est: { kcal: 430 } },
    { name: 'juice', est: { kcal: 40 } },
  ];
  const parts: MealPart[] = [{ key: 'p1', name: 'Chia bowl' }];
  return orderedRows(items, parts);
};

const flatRows = (): BracketRow[] =>
  orderedRows(
    [{ name: 'a', est: { kcal: 10 } }, { name: 'b', est: { kcal: 20 } }, { name: 'c', est: { kcal: 30 } }],
    [],
  );

function setRect(el: Element, top: number, height = 40) {
  (el as HTMLElement).getBoundingClientRect = () =>
    ({ top, height, bottom: top + height, left: 0, right: 100, width: 100, x: 0, y: top, toJSON: () => ({}) }) as DOMRect;
}

const drag = () => screen.getByTestId('drag').textContent;

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('the intent lock', () => {
  it('a vertical move stays a scroll: no drag state, no callback on release', () => {
    const onRemoveFromPart = vi.fn();
    render(<Harness rows={bracketed()} cb={{ onRemoveFromPart }} />);
    const member = screen.getByTestId('member-0');
    fireEvent.pointerDown(member, { pointerId: 1, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(member, { pointerId: 1, clientX: 103, clientY: 160 });
    fireEvent.pointerMove(member, { pointerId: 1, clientX: 20, clientY: 300 });
    expect(drag()).toBe('idle');
    fireEvent.pointerUp(member, { pointerId: 1, clientX: 20, clientY: 300 });
    expect(onRemoveFromPart).not.toHaveBeenCalled();
  });

  it('below the lock nothing is decided yet', () => {
    const onRemoveFromPart = vi.fn();
    render(<Harness rows={bracketed()} cb={{ onRemoveFromPart }} />);
    const member = screen.getByTestId('member-0');
    fireEvent.pointerDown(member, { pointerId: 1, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(member, { pointerId: 1, clientX: 96, clientY: 102 });
    expect(drag()).toBe('idle');
  });
});

describe('drag a member left — it leaves', () => {
  it('past the commit line, release fires onRemoveFromPart', () => {
    const onRemoveFromPart = vi.fn();
    render(<Harness rows={bracketed()} cb={{ onRemoveFromPart }} />);
    const member = screen.getByTestId('member-1');
    fireEvent.pointerDown(member, { pointerId: 1, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(member, { pointerId: 1, clientX: 60, clientY: 102 });
    expect(drag()).toBe('leave');
    fireEvent.pointerMove(member, { pointerId: 1, clientX: 100 - COMMIT_PX - 5, clientY: 103 });
    fireEvent.pointerUp(member, { pointerId: 1, clientX: 100 - COMMIT_PX - 5, clientY: 103 });
    expect(onRemoveFromPart).toHaveBeenCalledWith('p1', 1);
  });

  it('short of the commit line, release fires nothing', () => {
    const onRemoveFromPart = vi.fn();
    render(<Harness rows={bracketed()} cb={{ onRemoveFromPart }} />);
    const member = screen.getByTestId('member-1');
    fireEvent.pointerDown(member, { pointerId: 1, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(member, { pointerId: 1, clientX: 80, clientY: 101 });
    fireEvent.pointerUp(member, { pointerId: 1, clientX: 80, clientY: 101 });
    expect(onRemoveFromPart).not.toHaveBeenCalled();
  });
});

describe('drag a loose row right — it joins the bracket next door', () => {
  it('the row under the bracket joins it', () => {
    const onAddToPart = vi.fn();
    render(<Harness rows={bracketed()} cb={{ onAddToPart }} />);
    const row = screen.getByTestId('row-1'); // the muffin, directly under the bracket
    fireEvent.pointerDown(row, { pointerId: 1, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(row, { pointerId: 1, clientX: 140, clientY: 101 });
    expect(drag()).toBe('join');
    fireEvent.pointerMove(row, { pointerId: 1, clientX: 100 + COMMIT_PX + 4, clientY: 101 });
    fireEvent.pointerUp(row, { pointerId: 1, clientX: 100 + COMMIT_PX + 4, clientY: 101 });
    expect(onAddToPart).toHaveBeenCalledWith('p1', 2);
  });

  it('with no bracket adjacent there is no join to offer', () => {
    const onAddToPart = vi.fn();
    render(<Harness rows={flatRows()} cb={{ onAddToPart }} />);
    const row = screen.getByTestId('row-1');
    fireEvent.pointerDown(row, { pointerId: 1, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(row, { pointerId: 1, clientX: 180, clientY: 101 });
    expect(drag()).toBe('idle');
    fireEvent.pointerUp(row, { pointerId: 1, clientX: 180, clientY: 101 });
    expect(onAddToPart).not.toHaveBeenCalled();
  });
});

describe('the notch — a dedicated handle', () => {
  it('pull it down over the rows below and release: onGroup gets the span', () => {
    const onGroup = vi.fn();
    render(<Harness rows={flatRows()} cb={{ onGroup }} />);
    setRect(screen.getByTestId('rowwrap-0'), 0);
    setRect(screen.getByTestId('rowwrap-1'), 40);
    setRect(screen.getByTestId('rowwrap-2'), 80);
    const notch = screen.getByTestId('notch-0');
    fireEvent.pointerDown(notch, { pointerId: 1, clientX: 10, clientY: 10 });
    expect(drag()).toBe('group');
    fireEvent.pointerMove(notch, { pointerId: 1, clientX: 10, clientY: 70 });
    fireEvent.pointerUp(notch, { pointerId: 1, clientX: 10, clientY: 70 });
    expect(onGroup).toHaveBeenCalledWith([0, 1]);
  });

  it('a span of one makes nothing', () => {
    const onGroup = vi.fn();
    render(<Harness rows={flatRows()} cb={{ onGroup }} />);
    setRect(screen.getByTestId('rowwrap-0'), 0);
    setRect(screen.getByTestId('rowwrap-1'), 40);
    setRect(screen.getByTestId('rowwrap-2'), 80);
    const notch = screen.getByTestId('notch-0');
    fireEvent.pointerDown(notch, { pointerId: 1, clientX: 10, clientY: 10 });
    fireEvent.pointerUp(notch, { pointerId: 1, clientX: 10, clientY: 12 });
    expect(onGroup).not.toHaveBeenCalled();
  });
});

describe('long-press', () => {
  it('fires only when the pointer has not moved, and disarms the drag', () => {
    vi.useFakeTimers();
    const onLongPress = vi.fn();
    const onAddToPart = vi.fn();
    render(<Harness rows={bracketed()} cb={{ onLongPress, onAddToPart }} />);
    const row = screen.getByTestId('row-1');
    fireEvent.pointerDown(row, { pointerId: 1, clientX: 100, clientY: 100 });
    vi.advanceTimersByTime(LONG_PRESS_MS + 10);
    expect(onLongPress).toHaveBeenCalledWith(2);
    fireEvent.pointerMove(row, { pointerId: 1, clientX: 190, clientY: 100 });
    fireEvent.pointerUp(row, { pointerId: 1, clientX: 190, clientY: 100 });
    expect(onAddToPart).not.toHaveBeenCalled();
  });

  it('a move inside the window cancels it', () => {
    vi.useFakeTimers();
    const onLongPress = vi.fn();
    const onRemoveFromPart = vi.fn();
    render(<Harness rows={bracketed()} cb={{ onLongPress, onRemoveFromPart }} />);
    const member = screen.getByTestId('member-0');
    fireEvent.pointerDown(member, { pointerId: 1, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(member, { pointerId: 1, clientX: 60, clientY: 101 });
    vi.advanceTimersByTime(LONG_PRESS_MS + 100);
    expect(onLongPress).not.toHaveBeenCalled();
  });
});

describe('pure geometry', () => {
  it('dragAxis: whichever axis dominates past the lock', () => {
    expect(dragAxis(3, 3)).toBe('none');
    expect(dragAxis(-20, 4)).toBe('horizontal');
    expect(dragAxis(4, 20)).toBe('vertical');
  });

  it('adjacentPartFor prefers the bracket above, falls back below', () => {
    const rows = bracketed(); // [part p1, muffin, juice]
    expect(adjacentPartFor(rows, 1)).toBe('p1');
    expect(adjacentPartFor(rows, 2)).toBeNull();
  });

  it('groupSpan stops at a bracket — brackets never nest', () => {
    const items: MealItem[] = [
      { name: 'a', est: { kcal: 10 } },
      { name: 'b', est: { kcal: 20 }, part: 'p1' },
      { name: 'c', est: { kcal: 30 }, part: 'p1' },
      { name: 'd', est: { kcal: 40 } },
    ];
    const rows = orderedRows(items, [{ key: 'p1', name: null }]); // [a, part, d]
    const mids = [
      { key: 0, mid: 20 },
      { key: 1, mid: 60 },
      { key: 2, mid: 100 },
    ];
    expect(groupSpan(rows, mids, 0, 300)).toEqual([0]);
  });

  it('resizeDiff grows over loose rows below the tail, or shrinks members back off it', () => {
    const rows = bracketed(); // [part p1(0,1), muffin(2), juice(3)]
    const rowMids = [
      { key: 0, mid: 40 },
      { key: 1, mid: 100 },
      { key: 2, mid: 140 },
    ];
    const memberMids = [
      { key: 0, mid: 20 },
      { key: 1, mid: 60 },
    ];
    expect(resizeDiff(rows, rowMids, memberMids, 'p1', 'tail', 150)).toEqual({ add: [2, 3], remove: [] });
    expect(resizeDiff(rows, rowMids, memberMids, 'p1', 'tail', 30)).toEqual({ add: [], remove: [1] });
  });
});
