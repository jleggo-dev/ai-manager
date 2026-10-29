/**
 * How far back the Leftovers shelf looks (owner, 2026-10-28): seven days unless the user picks
 * otherwise in Settings → Nutrition. The choices stay inside what `/nutrition/recent` will serve
 * (31 days).
 *
 * Device-local, like the location source: it is a reading preference for this drawer, not a fact
 * about the person anyone else reads. Registered in `USER_SCOPED_KEYS` so the next account on the
 * phone starts from the default.
 */
import { useSyncExternalStore } from 'react';

export const LEFTOVER_WINDOW_KEY = 'cadence.leftoverWindowDays';
export const LEFTOVER_WINDOW_DEFAULT = 7;
export const LEFTOVER_WINDOW_CHOICES = [3, 7, 14] as const;

const listeners = new Set<() => void>();

export function readLeftoverWindow(): number {
  try {
    const n = Number(window.localStorage.getItem(LEFTOVER_WINDOW_KEY));
    return (LEFTOVER_WINDOW_CHOICES as readonly number[]).includes(n) ? n : LEFTOVER_WINDOW_DEFAULT;
  } catch {
    return LEFTOVER_WINDOW_DEFAULT;
  }
}

export function setLeftoverWindow(days: number): void {
  try {
    window.localStorage.setItem(LEFTOVER_WINDOW_KEY, String(days));
  } catch {
    /* storage unavailable — the shelf keeps the default */
  }
  for (const l of listeners) l();
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  window.addEventListener('storage', onChange);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener('storage', onChange);
  };
}

export function useLeftoverWindow(): number {
  return useSyncExternalStore(subscribe, readLeftoverWindow, () => LEFTOVER_WINDOW_DEFAULT);
}
