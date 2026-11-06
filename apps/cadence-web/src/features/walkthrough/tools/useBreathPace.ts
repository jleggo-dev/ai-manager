import { useCallback, useEffect, useRef, useState } from 'react';
import { type BreathPattern, breathPaceCeiling, breathPaceFloor, clampBreathPace } from '@cadence/shared';
import { getBreathPace, saveBreathPace } from '../../../lib/api/breath-pace.ts';

/** Listed in `USER_SCOPED_KEYS`: one person's lungs are not the next account's on this phone. */
export const BREATH_PACE_KEY = 'cadence.breathPace';

/** A drag fires on every pixel; the account hears about where it settled. */
const SAVE_AFTER_MS = 500;

function readCached(): number | null {
  try {
    const raw = window.localStorage.getItem(BREATH_PACE_KEY);
    return raw === null ? null : Number(raw);
  } catch {
    return null;
  }
}

function writeCached(pace: number): void {
  try {
    window.localStorage.setItem(BREATH_PACE_KEY, String(pace));
  } catch {
    // Private mode or full storage: the pace still holds for this session and on the account.
  }
}

/**
 * The person's pace and the range this pattern allows. The account is the record, so it follows
 * them to a new phone; the phone keeps a copy so the card paints at the right pace before any
 * network answer. What arrives from the account never overrides a slider the person is already
 * touching. A save that fails stays on this phone until the next one succeeds.
 *
 * What was set stays as set: a pattern with a tighter ceiling plays narrower without overwriting
 * it, so Wind-down cannot quietly shorten the pace someone tuned on box. Only moving the slider
 * changes it.
 */
export function useBreathPace(pattern: BreathPattern, cycles: number) {
  const [stored, setStored] = useState(readCached);
  const touched = useRef(false);
  const unsaved = useRef<number | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let current = true;
    void getBreathPace().then((pace) => {
      if (!current || touched.current || pace === null) return;
      setStored(pace);
      writeCached(pace);
    });
    return () => {
      current = false;
    };
  }, []);

  const flush = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    if (unsaved.current !== null) void saveBreathPace(unsaved.current);
    unsaved.current = null;
  }, []);

  // Leaving the card inside the save delay still saves: the last thing they set is the one they meant.
  useEffect(() => flush, [flush]);

  const setPace = useCallback(
    (next: number) => {
      touched.current = true;
      setStored(next);
      writeCached(next);
      unsaved.current = next;
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(flush, SAVE_AFTER_MS);
    },
    [flush],
  );

  return {
    pace: clampBreathPace(pattern, cycles, stored),
    floor: breathPaceFloor(pattern),
    ceiling: breathPaceCeiling(pattern, cycles),
    setPace,
  };
}
