/**
 * Swipe the drawer down to leave (quick log, 2026-10-28 — the ‹ went with the reading). Only
 * the top of the drawer drags — the handlers go on the handle, the title and the day, not on
 * the shelf — so the tiles keep their taps and their sideways swipe. The drawer follows the
 * finger and lets go past a distance or a flick; the draft itself stays open server-side, so
 * leaving loses nothing.
 *
 * The WHOLE sheet moves, the way an iOS sheet does (owner, 2026-11-01). The offset used to go
 * on the meal screen itself, but on the trail the meal sits inside the capture sheet — the
 * white card with the rounded top — so the words and tiles slid down inside a sheet that stayed
 * put. `ref` goes on the drawer's root; the offset lands on the nearest `.sheet` around it (the
 * root itself where there is none), the scrim behind it fades with the travel, and a release
 * past the line carries the sheet off the bottom before it closes instead of snapping back.
 */
import { useCallback, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';

/** Travel past this lets go of the drawer… */
export const DRAG_CLOSE_PX = 200;
/** …and so does a flick faster than this, in px per ms. */
export const DRAG_FLICK_V = 0.6;
/** How long the sheet takes to slide off once let go; the close lands after it. */
export const DRAG_LEAVE_MS = 220;
const DRAG_START_PX = 8;
const SETTLE = 'transform 0.3s cubic-bezier(.2,.8,.2,1)';

/** What moves: the sheet the drawer sits in, else the drawer. Its scrim, when it has one. */
export function dragTargets(root: HTMLElement): { sheet: HTMLElement; scrim: HTMLElement | null } {
  const sheet = root.closest<HTMLElement>('.sheet') ?? root;
  const prev = sheet.previousElementSibling;
  const scrim = sheet !== root && prev instanceof HTMLElement && prev.classList.contains('sheet-scrim') ? prev : null;
  return { sheet, scrim };
}

export function useDrawerDrag(onClose: () => void) {
  const drag = useRef<{ y: number; t: number; moving: boolean } | null>(null);
  const ref = useRef<HTMLDivElement | null>(null);
  const [dy, setDy] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [leaving, setLeaving] = useState(false);
  // The host hands a fresh closure every render; the slide-off timer must not restart on each.
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useLayoutEffect(() => {
    const root = ref.current;
    if (!root) return;
    const { sheet, scrim } = dragTargets(root);
    const height = sheet.getBoundingClientRect().height || window.innerHeight || 800;
    sheet.style.transition = dragging ? 'none' : leaving ? `transform ${DRAG_LEAVE_MS}ms ease-in` : SETTLE;
    sheet.style.transform = leaving ? 'translateY(100%)' : dy ? `translateY(${dy}px)` : '';
    if (scrim) {
      scrim.style.transition = dragging ? 'none' : `opacity ${leaving ? DRAG_LEAVE_MS : 300}ms ease`;
      scrim.style.opacity = leaving ? '0' : dy ? String(Math.max(0, 1 - dy / height)) : '';
    }
  }, [dy, dragging, leaving]);

  useLayoutEffect(() => {
    if (!leaving) return;
    const t = setTimeout(() => closeRef.current(), DRAG_LEAVE_MS);
    return () => clearTimeout(t);
  }, [leaving]);

  const onPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLElement>) => {
      if (leaving) return;
      drag.current = { y: e.clientY, t: Date.now(), moving: false };
    },
    [leaving],
  );

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

  const end = useCallback((e: ReactPointerEvent<HTMLElement>) => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    if (!d.moving) return;
    const dist = Math.max(0, e.clientY - d.y);
    const v = dist / Math.max(1, Date.now() - d.t);
    setDy(0);
    setDragging(false);
    if (dist > DRAG_CLOSE_PX || v > DRAG_FLICK_V) setLeaving(true);
  }, []);

  return {
    ref,
    dy,
    dragging,
    leaving,
    handlers: { onPointerDown, onPointerMove, onPointerUp: end, onPointerCancel: end },
  };
}
