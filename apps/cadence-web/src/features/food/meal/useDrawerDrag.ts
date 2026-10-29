/**
 * Swipe the drawer down to leave (quick log, 2026-10-28 — the ‹ went with the reading). Only
 * the top of the drawer drags — the handlers go on the handle, the title and the day, not on
 * the shelf — so the tiles keep their taps and their sideways swipe. The drawer follows the
 * finger and lets go past a distance or a flick; the draft itself stays open server-side, so
 * leaving loses nothing.
 */
import { useCallback, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';

/** Travel past this lets go of the drawer… */
export const DRAG_CLOSE_PX = 200;
/** …and so does a flick faster than this, in px per ms. */
export const DRAG_FLICK_V = 0.6;
const DRAG_START_PX = 8;

export function useDrawerDrag(onClose: () => void) {
  const drag = useRef<{ y: number; t: number; moving: boolean } | null>(null);
  const [dy, setDy] = useState(0);
  const [dragging, setDragging] = useState(false);

  const onPointerDown = useCallback((e: ReactPointerEvent<HTMLElement>) => {
    drag.current = { y: e.clientY, t: Date.now(), moving: false };
  }, []);

  const onPointerMove = useCallback((e: ReactPointerEvent<HTMLElement>) => {
    const d = drag.current;
    if (!d) return;
    const dist = Math.max(0, e.clientY - d.y);
    if (!d.moving) {
      if (dist <= DRAG_START_PX) return;
      d.moving = true;
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        /* no pointer capture in jsdom */
      }
      setDragging(true);
    }
    setDy(dist);
  }, []);

  const end = useCallback(
    (e: ReactPointerEvent<HTMLElement>) => {
      const d = drag.current;
      drag.current = null;
      if (!d) return;
      if (!d.moving) return;
      const dist = Math.max(0, e.clientY - d.y);
      const v = dist / Math.max(1, Date.now() - d.t);
      setDy(0);
      setDragging(false);
      if (dist > DRAG_CLOSE_PX || v > DRAG_FLICK_V) onClose();
    },
    [onClose],
  );

  return {
    dy,
    dragging,
    handlers: { onPointerDown, onPointerMove, onPointerUp: end, onPointerCancel: end },
  };
}
