/**
 * The one-time line that says a tile can be held (owner, 2026-10-28: "make hold discoverable").
 * Shown above the tiles until the first hold lands, then never again on this device for this
 * account (`cadence.holdHintSeen` is in `USER_SCOPED_KEYS`). Using the gesture is what retires
 * it — no × to find, no counter of views.
 */
import { useCallback, useState } from 'react';

export const HOLD_HINT_KEY = 'cadence.holdHintSeen';
export const HOLD_HINT = 'Hold a tile to choose how much.';

function seen(): boolean {
  try {
    return window.localStorage.getItem(HOLD_HINT_KEY) === '1';
  } catch {
    return false;
  }
}

export function useHoldHint(): { show: boolean; retire: () => void } {
  const [show, setShow] = useState(() => !seen());
  const retire = useCallback(() => {
    setShow(false);
    try {
      window.localStorage.setItem(HOLD_HINT_KEY, '1');
    } catch {
      /* storage unavailable — it retires for this session */
    }
  }, []);
  return { show, retire };
}
