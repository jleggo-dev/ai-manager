import { useState } from 'react';
import { capabilities } from '../../lib/capability/index.ts';
import { HEALTH_CONNECTED_KEY } from './health-import.ts';

function readConnected(): boolean {
  try {
    return window.localStorage.getItem(HEALTH_CONNECTED_KEY) === '1';
  } catch {
    return false;
  }
}

function writeConnected(on: boolean): void {
  try {
    if (on) window.localStorage.setItem(HEALTH_CONNECTED_KEY, '1');
    else window.localStorage.removeItem(HEALTH_CONNECTED_KEY);
  } catch {
    /* no localStorage — the switch still moves for this session */
  }
}

/**
 * Apple Health as a persistent TOGGLE (owner, 2026-09-07: "this should be a toggle that remains
 * persistently on or off"), same idiom as `SettingsProgressPhotos`. Native-shell only — renders
 * nothing on web, same gate `AppleHealthSettings` uses.
 *
 * ON asks HealthKit's permission sheet for workouts and records the grant under
 * `HEALTH_CONNECTED_KEY` — the client-side marker that IS the persisted state; there is no
 * server flag (see `health-import.ts`). If the sheet cannot be reached the switch stays off and
 * the error line says so. OFF clears the marker. HealthKit itself cannot be revoked from inside an
 * app — iOS owns that — so off means "Cadence stops reading", which is all the marker ever gated.
 *
 * While on, a plain "Workouts" door underneath opens the import list (`AppleHealthSettings`).
 */
export function SettingsHealthRow({ onOpenWorkouts }: { onOpenWorkouts: () => void }) {
  const [on, setOn] = useState(readConnected);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  if (!capabilities.health.isAvailable()) return null;

  async function toggle() {
    if (busy) return;
    setErr('');
    if (on) {
      writeConnected(false);
      setOn(false);
      return;
    }
    setBusy(true);
    try {
      // The boolean it resolves carries no information on iOS (see native.ts); only a throw
      // means the sheet never happened.
      await capabilities.health.requestPermissions(['workouts']);
      writeConnected(true);
      setOn(true);
    } catch {
      setErr("Couldn't reach Apple Health — try again in a moment.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="room-row-wrap">
      <button
        type="button"
        className="room-row room-row-toggle"
        onClick={() => void toggle()}
        disabled={busy}
        role="switch"
        aria-checked={on}
      >
        <span className="room-row-text">
          <b>Apple Health</b>
        </span>
        <span className={`room-toggle${on ? ' is-on' : ''}`} aria-hidden>
          <span className="room-toggle-knob" />
        </span>
      </button>
      {on && (
        <button type="button" className="room-row" onClick={onOpenWorkouts}>
          <span className="room-row-text">
            <b>Workouts</b>
          </span>
          <i className="room-chevron" aria-hidden>
            ›
          </i>
        </button>
      )}
      {err && <p className="room-row-pointer room-row-err">{err}</p>}
    </div>
  );
}
