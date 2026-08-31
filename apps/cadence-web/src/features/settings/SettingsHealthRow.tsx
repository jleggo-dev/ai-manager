import { capabilities } from '../../lib/capability/index.ts';
import { HEALTH_CONNECTED_KEY } from './health-import.ts';

function isConnected(): boolean {
  try {
    return window.localStorage.getItem(HEALTH_CONNECTED_KEY) === '1';
  } catch {
    return false;
  }
}

/**
 * The Apple Health door row (design owner-approved 2026-08-31: "sub 'Connected · steps &
 * workouts come in' when connected"). Native-shell only — renders nothing on web, same gate
 * `AppleHealthSettings` itself uses.
 *
 * There is no server-side "connected" flag to read (see `health-import.ts`'s
 * `HEALTH_CONNECTED_KEY`), so this reads the client-side marker `AppleHealthSettings` sets on a
 * successful permission grant rather than re-asking HealthKit just to draw a sub-line.
 */
export function SettingsHealthRow({ onOpen }: { onOpen: () => void }) {
  if (!capabilities.health.isAvailable()) return null;

  return (
    <button type="button" className="room-row" onClick={onOpen}>
      <span className="room-row-text">
        <b>Apple Health</b>
        <span>
          {isConnected() ? 'Connected · steps & workouts come in' : 'Bring in workouts you tracked elsewhere'}
        </span>
      </span>
      <i className="room-chevron" aria-hidden>
        ›
      </i>
    </button>
  );
}
