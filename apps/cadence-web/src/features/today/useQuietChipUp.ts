import { useNotificationPrefs } from '../settings/notifications/useNotificationPrefs.ts';
import { shouldShowQuietChip } from './quietChipWindow.ts';

/**
 * Is the quiet-hours chip on the header right now?
 *
 * Two surfaces need the answer and they must never disagree: the chip itself, and the weather line
 * beside it — which drops its condition word while the chip is up, so the row stays inside a
 * 402px screen. If the header believed the chip was up on an evening when it wasn't, the weather
 * would silently lose its adjective for no reason anyone could see.
 *
 * One rule, one query key: `useNotificationPrefs` is the shared cache, so asking twice on one
 * render costs nothing.
 */
export function useQuietChipUp(now: Date = new Date()): boolean {
  const { data: prefs } = useNotificationPrefs();
  if (!prefs) return false;
  return shouldShowQuietChip(now.getHours() * 60 + now.getMinutes(), prefs.quietStartMin, prefs.quietEndMin);
}
