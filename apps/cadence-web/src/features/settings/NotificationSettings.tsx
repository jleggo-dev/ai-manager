/**
 * Settings — notifications (native shell only; the seam hides this on web).
 *
 * Confirm-first: tapping asks iOS's permission sheet, and only a granted permission registers the
 * device with cadence-api. Nothing schedules pushes yet — this makes the channel exist so the
 * coach's check-ins can use it when that ships (PLAN.md §12 B).
 */
import { useState } from 'react';
import { capabilities } from '../../lib/capability/index.ts';
import { registerPushToken } from '../../lib/api.ts';

const TOKEN_KEY = 'cadence.pushToken';

/** Defensive: this component mounts (and its hooks run) even where it renders null. */
function storedToken(): string | null {
  try {
    return window.localStorage?.getItem(TOKEN_KEY) ?? null;
  } catch {
    return null;
  }
}

export function NotificationSettings() {
  const [enabled, setEnabled] = useState(() => Boolean(storedToken()));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  if (!capabilities.push.isAvailable()) return null;

  async function enable() {
    if (busy) return;
    setBusy(true);
    setMsg('');
    try {
      const token = await capabilities.push.register();
      if (!token) {
        setMsg('iOS said no — you can change that anytime in Settings → Notifications.');
        return;
      }
      const ok = await registerPushToken(token);
      if (ok) {
        window.localStorage.setItem(TOKEN_KEY, token);
        setEnabled(true);
        setMsg("Done — when check-ins arrive, they'll reach you here.");
      } else {
        setMsg("That didn't save — try again in a moment.");
      }
    } catch {
      setMsg("That didn't work — try again in a moment.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="diet-block" style={{ marginTop: 12 }}>
      <div className="diet-block-t">Notifications</div>
      <div className="diet-block-h">
        For the occasional check-in from your coach — never a guilt trip, never a streak alarm.
      </div>
      {enabled ? (
        <div className="sheet-msg" style={{ padding: '6px 0 8px' }}>
          This device is set up. Turn notifications off anytime in iOS Settings.
        </div>
      ) : (
        <button type="button" className="set-row" onClick={enable} disabled={busy}>
          <b>Allow notifications</b>
          <span>iOS will ask once — you stay in charge of what gets through.</span>
        </button>
      )}
      {msg && (
        <div className="auth-notice" style={{ marginTop: 6 }}>
          {msg}
        </div>
      )}
    </div>
  );
}
