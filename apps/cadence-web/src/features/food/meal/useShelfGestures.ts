/**
 * The two gestures the shelf answers to (quick log, 2026-10-28):
 *
 *   swipe — left/right across the tiles moves to the next/previous shelf; the pane follows the
 *           finger and snaps. Vertical scrolling is untouched (touch-action: pan-y on the
 *           scroller), so a swipe only starts once the finger has clearly gone sideways.
 *   hold  — a tile pressed and held opens its amount sheet; let go before that and it is a tap.
 *           Any real movement cancels the hold, so a swipe never opens a sheet and a scroll
 *           never adds a food. The press is reported as it happens (the tile draws it, filling
 *           toward the hold) and the hold landing ticks a haptic — so the gesture can be found
 *           by feel, not only read about (owner, 2026-10-28).
 *
 * Pointer events only, no touch handlers: one code path for a finger, a mouse and a test.
 */
import { useCallback, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { tickHaptic } from '../../../lib/haptics.ts';

/** How far sideways before the pane commits to a swipe. */
export const SWIPE_START_PX = 8;
/** How far a committed swipe has to travel to change shelf. */
export const SWIPE_CHANGE_PX = 60;
/** How long a press is a hold. */
export const HOLD_MS = 450;
/** Movement past this cancels a hold (and a tap). */
export const HOLD_SLOP_PX = 8;

export interface SwipeHandlers {
  onPointerDown: (e: ReactPointerEvent<HTMLElement>) => void;
  onPointerMove: (e: ReactPointerEvent<HTMLElement>) => void;
  onPointerUp: (e: ReactPointerEvent<HTMLElement>) => void;
  onPointerCancel: (e: ReactPointerEvent<HTMLElement>) => void;
}

export function useSwipe(onSwipe: (dir: 1 | -1) => void): { dx: number; swiping: boolean; handlers: SwipeHandlers } {
  const start = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  const [dx, setDx] = useState(0);
  const [swiping, setSwiping] = useState(false);

  const onPointerDown = useCallback((e: ReactPointerEvent<HTMLElement>) => {
    start.current = { x: e.clientX, y: e.clientY, moved: false };
  }, []);

  const onPointerMove = useCallback((e: ReactPointerEvent<HTMLElement>) => {
    const s = start.current;
    if (!s) return;
    const ddx = e.clientX - s.x;
    const ddy = e.clientY - s.y;
    if (!s.moved) {
      if (Math.abs(ddx) <= SWIPE_START_PX || Math.abs(ddx) <= Math.abs(ddy)) return;
      s.moved = true;
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        /* jsdom has no pointer capture; the gesture still works without it */
      }
      setSwiping(true);
    }
    setDx(ddx);
  }, []);

  const end = useCallback(
    (e: ReactPointerEvent<HTMLElement>) => {
      const s = start.current;
      start.current = null;
      if (!s) return;
      const ddx = e.clientX - s.x;
      setDx(0);
      setSwiping(false);
      if (s.moved && Math.abs(ddx) > SWIPE_CHANGE_PX) onSwipe(ddx < 0 ? 1 : -1);
    },
    [onSwipe],
  );

  return { dx, swiping, handlers: { onPointerDown, onPointerMove, onPointerUp: end, onPointerCancel: end } };
}

export interface HoldTapHandlers {
  onPointerDown: (e: ReactPointerEvent<HTMLElement>) => void;
  onPointerMove: (e: ReactPointerEvent<HTMLElement>) => void;
  onPointerUp: (e: ReactPointerEvent<HTMLElement>) => void;
  onPointerCancel: (e: ReactPointerEvent<HTMLElement>) => void;
  onPointerLeave: (e: ReactPointerEvent<HTMLElement>) => void;
  onClick: () => void;
  onContextMenu: (e: { preventDefault: () => void }) => void;
}

/**
 * Tap-or-hold for one tile. A pointer sequence decides for itself (up before HOLD_MS = tap,
 * the timer firing = hold); a keyboard activation arrives as a bare click with no pointer
 * sequence before it and is a tap. Holds are opt-in: a tile without `onHold` only ever taps.
 * `onPress` hears true when a press starts and false when it ends, however it ends.
 */
export function useHoldTap(
  onTap: () => void,
  onHold?: () => void,
  onPress?: (pressing: boolean) => void,
): HoldTapHandlers {
  const press = useRef<{ x: number; y: number; timer: ReturnType<typeof setTimeout> | null; held: boolean } | null>(
    null,
  );
  const pointerHandled = useRef(false);

  const clear = useCallback(() => {
    const p = press.current;
    if (p?.timer) clearTimeout(p.timer);
    if (p) onPress?.(false);
    press.current = null;
  }, [onPress]);

  const onPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLElement>) => {
      if (e.button !== 0 && e.pointerType === 'mouse') return;
      clear();
      pointerHandled.current = false;
      const p = { x: e.clientX, y: e.clientY, timer: null as ReturnType<typeof setTimeout> | null, held: false };
      if (onHold) {
        p.timer = setTimeout(() => {
          p.held = true;
          p.timer = null;
          onPress?.(false);
          tickHaptic();
          onHold();
        }, HOLD_MS);
      }
      press.current = p;
      onPress?.(true);
    },
    [clear, onHold, onPress],
  );

  const onPointerMove = useCallback(
    (e: ReactPointerEvent<HTMLElement>) => {
      const p = press.current;
      if (!p || p.held) return;
      if (Math.abs(e.clientX - p.x) > HOLD_SLOP_PX || Math.abs(e.clientY - p.y) > HOLD_SLOP_PX) clear();
    },
    [clear],
  );

  const onPointerUp = useCallback(() => {
    const p = press.current;
    pointerHandled.current = true;
    if (!p) return;
    const held = p.held;
    clear();
    if (!held) onTap();
  }, [clear, onTap]);

  const onClick = useCallback(() => {
    // The click that follows a pointer sequence has already been answered; a bare one (keyboard)
    // is a tap in its own right.
    if (pointerHandled.current) {
      pointerHandled.current = false;
      return;
    }
    onTap();
  }, [onTap]);

  return {
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerCancel: clear,
    onPointerLeave: clear,
    onClick,
    onContextMenu: (e) => e.preventDefault(),
  };
}
