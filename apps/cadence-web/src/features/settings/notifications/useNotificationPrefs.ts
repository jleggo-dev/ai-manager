import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getNotificationPrefs,
  saveNotificationPrefs,
  type NotificationPrefs,
  type NotificationPrefsPatch,
} from '../../../lib/api.ts';

/**
 * The dial's state, shared.
 *
 * One query key, because two surfaces read it — Settings and the quiet-hours chip on Today — and
 * they must never disagree. Changing quiet hours from the chip has to move the row in Settings,
 * and the reverse; two independent fetches would show a user two different bedtimes and leave them
 * to work out which one the app believes.
 */
export const notificationPrefsKey = ['notificationPrefs'] as const;

export function useNotificationPrefs() {
  return useQuery<NotificationPrefs | null>({ queryKey: notificationPrefsKey, queryFn: getNotificationPrefs });
}

/**
 * Save a patch, then replace the cache with the SERVER's answer.
 *
 * No optimistic update. A dial that moves before the save lands, and stays moved when it fails, is
 * the one failure mode this control cannot have: the user believes they turned Cadence down, and
 * Cadence keeps talking. The round trip is one small request; the honesty is worth the moment.
 */
export function useSaveNotificationPrefs() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (patch: NotificationPrefsPatch) => saveNotificationPrefs(patch),
    onSuccess: (saved) => {
      if (saved) queryClient.setQueryData(notificationPrefsKey, saved);
      else void queryClient.invalidateQueries({ queryKey: notificationPrefsKey });
    },
  });
}

/** "9:30 pm" — minutes past midnight rendered on the user's own clock face. */
export function minutesToLabel(minutes: number): string {
  const m = ((Math.trunc(minutes) % 1440) + 1440) % 1440;
  const h24 = Math.floor(m / 60);
  const mm = String(m % 60).padStart(2, '0');
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${mm} ${h24 < 12 ? 'am' : 'pm'}`;
}

/** "21:30" — the value an <input type="time"> wants. */
export function minutesToTimeValue(minutes: number): string {
  const m = ((Math.trunc(minutes) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/** "21:30" → 1290. Returns null for anything unparseable, so the caller keeps the stored value. */
export function timeValueToMinutes(value: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const hour = Number(m[1]);
  const minute = Number(m[2]);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return hour * 60 + minute;
}
