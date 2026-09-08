import { capabilities } from '../../lib/capability/index.ts';
import { minutesToClock } from '../../lib/clock.ts';
import { useClockUnit } from '../../lib/query/index.ts';
import { useNotificationPrefs } from './notifications/useNotificationPrefs.ts';

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
 * "Off" is the dial's fourth position (owner, 2026-09-07) — `prefs.enabled === false` — and the
 * sub-line says exactly that, nothing more. While the prefs are still loading there is no
 * sub-line at all rather than a sentence about what notifications are for.
 *
 * Native-shell only, same capability gate `NotificationSettings` itself uses — renders nothing on
 * web.
 */
export function SettingsNotificationsRow({ onOpen }: { onOpen: () => void }) {
  const { data: prefs } = useNotificationPrefs();
  const clock = useClockUnit();
  if (!capabilities.push.isAvailable()) return null;

  const sub = !prefs
    ? null
    : !prefs.enabled
      ? 'Off'
      : `${capitalize(prefs.tier)} · quiet ${minutesToClock(prefs.quietStartMin, clock)}–${minutesToClock(prefs.quietEndMin, clock)}`;

  return (
    <button type="button" className="room-row" onClick={onOpen}>
      <span className="room-row-text">
        <b>Notifications</b>
        {sub && <span>{sub}</span>}
      </span>
      <i className="room-chevron" aria-hidden>
        ›
      </i>
    </button>
  );
}
