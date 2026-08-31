import { WeighInSettings } from './WeighInSettings.tsx';
import { SettingsHealthRow } from './SettingsHealthRow.tsx';
import { SettingsLocation } from './SettingsLocation.tsx';
import { SettingsNotificationsRow } from './SettingsNotificationsRow.tsx';
import { SettingsProgressPhotos } from './SettingsProgressPhotos.tsx';

/**
 * "DEVICE & DATA" (design owner-approved 2026-08-31).
 *
 * Units and Notifications are doors (their sub-screens restyle/reuse `UnitSettings` and
 * `NotificationSettings`); Apple Health is a door too (its detail — a list of workouts — does not
 * belong inline in a settings menu). Location, Weigh-ins and Progress photos stay inline: the
 * first is a compact multi-state row with its own "Set" flow, and the other two already
 * self-manage a row-that-expands-in-place (`WeighInSettings`) or are a single toggle
 * (`SettingsProgressPhotos`) — wrapping either in a door would be navigation for its own sake.
 */
export function SettingsDeviceGroup({
  onOpenUnits,
  onOpenNotifications,
  onOpenHealth,
}: {
  onOpenUnits: () => void;
  onOpenNotifications: () => void;
  onOpenHealth: () => void;
}) {
  return (
    <section className="room-group">
      <h3 className="room-group-label">Device & data</h3>
      <button type="button" className="room-row" onClick={onOpenUnits}>
        <span className="room-row-text">
          <b>Units</b>
          <span>Pounds, grams, kilometres — set however you talk</span>
        </span>
        <i className="room-chevron" aria-hidden>
          ›
        </i>
      </button>
      <SettingsNotificationsRow onOpen={onOpenNotifications} />
      <SettingsLocation />
      <SettingsHealthRow onOpen={onOpenHealth} />
      <WeighInSettings />
      <SettingsProgressPhotos />
    </section>
  );
}
