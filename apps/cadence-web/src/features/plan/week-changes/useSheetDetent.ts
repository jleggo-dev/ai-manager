import { useCallback, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';

/**
 * Two heights for one sheet — half (just the change) and full (the week) — the way iOS sheets
 * with detents behave. Drag the handle up to open the week, down to come back to the change, and
 * down again from half to close. A tap on the handle toggles. Snap on release, past a distance or
 * a flick, same thresholds as the meal drawer (useDrawerDrag.ts) scaled for a shorter travel.
 */
export type Detent = 'half' | 'full';

export const DETENT_SNAP_PX = 48;
export const DETENT_FLICK_V = 0.5;
const START_PX = 6;

export function useSheetDetent(initial: Detent, onClose: () => void) {
  const [detent, setDetent] = useState<Detent>(initial);
  const drag = useRef<{ y: number; t: number; moving: boolean } | null>(null);

  const onPointerDown = useCallback((e: ReactPointerEvent<HTMLElement>) => {
    drag.current = { y: e.clientY, t: Date.now(), moving: false };
  }, []);

  const onPointerMove = useCallback((e: ReactPointerEvent<HTMLElement>) => {
    const d = drag.current;
    if (!d || d.moving || Math.abs(e.clientY - d.y) <= START_PX) return;
    d.moving = true;
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* no pointer capture in jsdom */
    }
  }, []);

  const end = useCallback(
    (e: ReactPointerEvent<HTMLElement>) => {
      const d = drag.current;
      drag.current = null;
      if (!d) return;
      if (!d.moving) {
        setDetent((v) => (v === 'half' ? 'full' : 'half'));
        return;
      }
      const dy = e.clientY - d.y;
      const v = Math.abs(dy) / Math.max(1, Date.now() - d.t);
      if (Math.abs(dy) < DETENT_SNAP_PX && v < DETENT_FLICK_V) return;
      if (dy < 0) setDetent('full');
      else if (detent === 'full') setDetent('half');
      else onClose();
    },
    [detent, onClose],
  );

  return { detent, setDetent, handlers: { onPointerDown, onPointerMove, onPointerUp: end, onPointerCancel: end } };
}
