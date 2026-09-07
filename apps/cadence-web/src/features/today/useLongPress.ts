import { useCallback, useRef, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from 'react';

/** How long a finger rests before a press becomes a hold — the same beat the food bracket uses. */
export const LONG_PRESS_MS = 450;
/** Movement past this is a scroll (or a drag), never a hold. */
export const HOLD_SLOP_PX = 8;

/**
 * Press-and-hold on a trail node (the hold menu, 2026-09-07).
 *
 * Pointer events, touch and mouse alike (the app lives in an iOS webview). The one hard rule,
 * shared with the bracket engine: a hold must NOT hijack scroll. The timer starts on the press
 * and is cancelled by any real movement, by the pointer leaving or lifting, and by the browser
 * taking the pointer for a scroll (`pointercancel`). Nothing here captures the pointer.
 *
 * When the hold fires, the finger is still down — so the `click` the browser synthesizes on
 * release is swallowed (`onClickCapture`), or the menu would open and the task's own sheet would
 * open on top of it. The context menu is suppressed for the same reason: a long press on iOS
 * otherwise brings up the callout, and on desktop the right-click menu.
 *
 * With no `onHold` the handlers are inert, so a node that has nothing to offer on a hold still
 * taps exactly as before.
 */
export function useLongPress(onHold: (() => void) | undefined) {
  const timer = useRef<number | null>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  const fired = useRef(false);

  const clear = useCallback(() => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
    start.current = null;
  }, []);

  const onPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLElement>) => {
      if (!onHold) return;
      // Only the primary button (or a finger) holds; a right-click is its own gesture.
      if (e.button !== 0) return;
      fired.current = false;
      clear();
      start.current = { x: e.clientX, y: e.clientY };
      timer.current = window.setTimeout(() => {
        timer.current = null;
        fired.current = true;
        onHold();
      }, LONG_PRESS_MS);
    },
    [onHold, clear],
  );

  const onPointerMove = useCallback(
    (e: ReactPointerEvent<HTMLElement>) => {
      if (!start.current || timer.current === null) return;
      if (Math.hypot(e.clientX - start.current.x, e.clientY - start.current.y) > HOLD_SLOP_PX) clear();
    },
    [clear],
  );

  const onClickCapture = useCallback((e: ReactMouseEvent<HTMLElement>) => {
    if (!fired.current) return;
    fired.current = false;
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const onContextMenu = useCallback(
    (e: ReactMouseEvent<HTMLElement>) => {
      if (onHold) e.preventDefault();
    },
    [onHold],
  );

  return {
    onPointerDown,
    onPointerMove,
    onPointerUp: clear,
    onPointerCancel: clear,
    onPointerLeave: clear,
    onClickCapture,
    onContextMenu,
  };
}
