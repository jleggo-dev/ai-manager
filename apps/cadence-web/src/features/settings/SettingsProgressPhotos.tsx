import { useEffect, useState } from 'react';
import { getProgressPhotosStatus, setProgressPhotosEnabled } from '../../lib/api.ts';

/**
 * "Progress photos" — an INLINE TOGGLE, not a door (design owner-approved 2026-08-31). The full
 * photo library lives in Progress; this row is only the opt-in switch, wired to the existing
 * `PUT /progress/photos/enabled`.
 *
 * Optimistic with rollback, like `UnitSettings`' per-axis toggle: a plain on/off with nothing to
 * lose either direction, so the only failure that matters is the save itself not landing.
 */
export function SettingsProgressPhotos() {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    let alive = true;
    void getProgressPhotosStatus().then((s) => {
      if (alive) setEnabled(s.enabled);
    });
    return () => {
      alive = false;
    };
  }, []);

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
          <span>One photo every 4 weeks · dated & weight-stamped</span>
        </span>
        <span className={`room-toggle${enabled ? ' is-on' : ''}`} aria-hidden>
          <span className="room-toggle-knob" />
        </span>
      </button>
      <p className="room-row-pointer">All photos live in Progress</p>
      {err && <p className="room-row-pointer room-row-err">{err}</p>}
    </div>
  );
}
