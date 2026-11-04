import { useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';

/**
 * The two drags of the Rearrange sheet (walkthrough v3 Phase 6, design boards "Rearrange" and
 * "Spread"): a whole group by its handle, or one set pill out of its group. Pointer events, so it
 * works one-handed on a phone: press, move, and the gap nearest the finger opens; release drops
 * it there. Pure arithmetic over the rows' boxes, so `gapForY` has a table test of its own.
 */
export type Drag =
  | { kind: 'group'; groupId: string; y: number }
  | { kind: 'turn'; groupId: string; turnIndex: number; label: string; x: number; y: number };

/**
 * Which gap (0..n, between the rows as they stand) a point is nearest: above a row's middle is the
 * gap before it, below the last row's middle is the gap after it. Rows are given top-to-bottom.
 */
export function gapForY(rows: ReadonlyArray<{ top: number; bottom: number }>, y: number): number {
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (r && y < (r.top + r.bottom) / 2) return i;
  }
  return rows.length;
}

export function useRearrangeDrag(onDrop: (drag: Drag, gap: number) => void) {
  const [drag, setDrag] = useState<Drag | null>(null);
  const [gap, setGap] = useState<number | null>(null);
  const rows = useRef<(HTMLElement | null)[]>([]);
  const live = useRef<{ drag: Drag; gap: number | null } | null>(null);

  const measure = () =>
    rows.current
      .filter((el): el is HTMLElement => !!el)
      .map((el) => {
        const b = el.getBoundingClientRect();
        return { top: b.top, bottom: b.bottom };
      });

  function begin(e: ReactPointerEvent, start: Drag) {
    e.preventDefault();
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture?.(e.pointerId);
    live.current = { drag: start, gap: null };
    setDrag(start);
    setGap(null);
    const move = (ev: PointerEvent) => {
      if (!live.current) return;
      const next: Drag = {
        ...live.current.drag,
        y: ev.clientY,
        ...('x' in live.current.drag ? { x: ev.clientX } : {}),
      } as Drag;
      const g = gapForY(measure(), ev.clientY);
      live.current = { drag: next, gap: g };
      setDrag(next);
      setGap(g);
    };
    const end = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', end);
      el.removeEventListener('pointercancel', end);
      const cur = live.current;
      live.current = null;
      setDrag(null);
      setGap(null);
      if (cur && cur.gap != null) onDrop(cur.drag, cur.gap);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
  }

  return {
    drag,
    gap,
    /** Put each row's element here by its index, so the gaps can be measured. */
    rowRef: (i: number) => (el: HTMLElement | null) => {
      rows.current[i] = el;
    },
    startGroup: (e: ReactPointerEvent, groupId: string) => begin(e, { kind: 'group', groupId, y: e.clientY }),
    startTurn: (e: ReactPointerEvent, groupId: string, turnIndex: number, label: string) =>
      begin(e, { kind: 'turn', groupId, turnIndex, label, x: e.clientX, y: e.clientY }),
  };
}
