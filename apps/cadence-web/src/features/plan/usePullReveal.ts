import { useEffect, useRef, useState, type TouchEvent as ReactTouchEvent } from 'react';
import { PULL_REVEAL_PX, rememberRevealed, wasRevealed } from './proposalShelf.ts';

/**
 * The pull that brings the shelf out (proposalShelf.ts). Touch handlers for the plan's own scroll
 * pane: a touch that starts with the pane at its top and travels `PULL_REVEAL_PX` down is the
 * deliberate pull; anything else — a scroll from further down, a tap, a flick up — is not, and
 * nothing here ever captures the pointer or fights the scroll. `reveal` is the same answer by tap
 * (the grip), for a mouse or a screen reader.
 *
 * `key` names the proposal on the shelf (its `created_at`); null means nothing is shelved. A
 * proposal revealed once stays revealed for the session (module memory — the plan unmounts on
 * every tab switch), and a NEW proposal starts on the shelf again.
 */
export function usePullReveal(key: string | null) {
  const [revealed, setRevealed] = useState(() => (key ? wasRevealed(key) : false));
  const startY = useRef<number | null>(null);

  useEffect(() => {
    setRevealed(key ? wasRevealed(key) : false);
  }, [key]);

  const reveal = () => {
    if (key) rememberRevealed(key);
    setRevealed(true);
  };

  const onTouchStart = (e: ReactTouchEvent<HTMLElement>) => {
    const y = e.touches[0]?.clientY;
    startY.current = key && !revealed && e.currentTarget.scrollTop <= 0 && y != null ? y : null;
  };
  const onTouchMove = (e: ReactTouchEvent<HTMLElement>) => {
    if (startY.current == null) return;
    const y = e.touches[0]?.clientY;
    if (y != null && y - startY.current >= PULL_REVEAL_PX) {
      startY.current = null;
      reveal();
    }
  };
  const onTouchEnd = () => {
    startY.current = null;
  };

  return { revealed, reveal, handlers: { onTouchStart, onTouchMove, onTouchEnd, onTouchCancel: onTouchEnd } };
}
