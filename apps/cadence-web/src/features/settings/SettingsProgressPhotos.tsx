import { useState } from 'react';
import { setProgressPhotosEnabled } from '../../lib/api.ts';
import { useProgressPhotosStatus, useSetProgressPhotosStatus } from '../../lib/query/index.ts';

/**
 * "Progress photos" — an INLINE TOGGLE, not a door (design owner-approved 2026-08-31). The full
 * photo library lives in Progress; this row is only the opt-in switch, wired to the existing
 * `PUT /progress/photos/enabled`. Label and switch, nothing else (owner, 2026-09-07).
 *
 * Optimistic with rollback, like `UnitSettings`' per-axis toggle: a plain on/off with nothing to
 * lose either direction, so the only failure that matters is the save itself not landing.
 */
export function SettingsProgressPhotos() {
  // Through the shared status entry (lib/query/useProgressPhotos.ts): the row is in the list with
  // every other row rather than appearing under them a round trip later, and the quick-add surface
  // that reads the same fact never disagrees with this switch.
  const { data } = useProgressPhotosStatus();
  const setEnabled = useSetProgressPhotosStatus();
  const enabled = data?.enabled ?? null;
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function toggle() {
    if (busy || enabled === null) return;
    setBusy(true);
    setErr('');
    const next = !enabled;
    setEnabled(next);
    const ok = await setProgressPhotosEnabled(next);
    if (!ok) {
      setEnabled(!next);
      setErr("That didn't save — try again in a moment.");
    }
    setBusy(false);
  }

  if (enabled === null) return null;

  return (
    <div className="room-row-wrap">
      <button
        type="button"
        className="room-row room-row-toggle"
        onClick={toggle}
        disabled={busy}
        role="switch"
        aria-checked={enabled}
      >
        <span className="room-row-text">
          <b>Progress photos</b>
        </span>
        <span className={`room-toggle${enabled ? ' is-on' : ''}`} aria-hidden>
          <span className="room-toggle-knob" />
        </span>
      </button>
      {err && <p className="room-row-pointer room-row-err">{err}</p>}
    </div>
  );
}
