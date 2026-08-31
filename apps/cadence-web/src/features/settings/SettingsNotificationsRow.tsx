import { capabilities } from '../../lib/capability/index.ts';
import { minutesToTimeValue, useNotificationPrefs } from './notifications/useNotificationPrefs.ts';

/** "Moderate" from "moderate" — the tier value as the design's own demo capitalizes it. */
function capitalize(s: string): string {
  return s.length ? s[0]!.toUpperCase() + s.slice(1) : s;
}

/**
 * The Notifications door row, with LIVE values in its sub-line (design owner-approved
 * 2026-08-31: "sub 'Moderate · quiet 21:30 – 07:00' style, live values"). Reads the same
 * `useNotificationPrefs` query the sub-screen's `NotificationSettings` reads, so the two can never
 * disagree about what the tier or quiet hours currently are.
 *
 * Native-shell only, same capability gate `NotificationSettings` itself uses — renders nothing on
 * web.
 */
export function SettingsNotificationsRow({ onOpen }: { onOpen: () => void }) {
  const { data: prefs } = useNotificationPrefs();
  if (!capabilities.push.isAvailable()) return null;

  const sub = prefs
    ? `${capitalize(prefs.tier)} · quiet ${minutesToTimeValue(prefs.quietStartMin)} – ${minutesToTimeValue(prefs.quietEndMin)}`
    : 'How much, and when, your coach speaks up';

  return (
    <button type="button" className="room-row" onClick={onOpen}>
      <span className="room-row-text">
        <b>Notifications</b>
        <span>{sub}</span>
      </span>
      <i className="room-chevron" aria-hidden>
        ›
      </i>
    </button>
  );
}
