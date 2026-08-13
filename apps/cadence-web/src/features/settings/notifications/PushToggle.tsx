import { useState } from 'react';
import { capabilities } from '../../../lib/capability/index.ts';
import { registerPushToken, removePushToken } from '../../../lib/api.ts';
import { useNotificationPrefs, useSaveNotificationPrefs } from './useNotificationPrefs.ts';
import { PUSH_TOKEN_KEY as TOKEN_KEY } from './enablePush.ts';

function storedToken(): string | null {
  try {
    return window.localStorage?.getItem(TOKEN_KEY) ?? null;
  } catch {
    return null;
  }
}

/**
 * Push — the ONLY channel here.
 *
 * There is no email row and no text-message row, and that absence is a decision rather than a gap.
 * A toggle for a channel nothing sends on is a promise the app breaks the first time someone turns
 * it on and waits.
 *
 * Turning it OFF forgets this device's token as well as clearing the preference. Leaving a
 * registered token behind and relying on a boolean to suppress it means one bug away from a
 * notification arriving at a device the user told us to stop using.
 */
export function PushToggle() {
  const { data: prefs } = useNotificationPrefs();
  const save = useSaveNotificationPrefs();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  if (!prefs) return null;
  const on = prefs.enabled && Boolean(storedToken());

  async function enable() {
    setMsg('');
    const token = await capabilities.push.register();
    if (!token) {
      setMsg('iOS said no — you can change that anytime in Settings → Notifications.');
      return;
    }
    if (!(await registerPushToken(token))) {
      setMsg("That didn't save — try again in a moment.");
      return;
    }
    window.localStorage.setItem(TOKEN_KEY, token);
    await save.mutateAsync({ enabled: true });
  }

  async function disable() {
    const token = storedToken();
    if (token) await removePushToken(token).catch(() => false);
    window.localStorage.removeItem(TOKEN_KEY);
    await save.mutateAsync({ enabled: false });
  }

  async function toggle() {
    if (busy) return;
    setBusy(true);
    try {
      await (on ? disable() : enable());
    } catch {
      setMsg("That didn't work — try again in a moment.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        className="set-row push-toggle"
        onClick={toggle}
        disabled={busy}
        role="switch"
        aria-checked={on}
      >
        <b>Push {on ? 'on' : 'off'}</b>
        <span>{on ? 'Notifications reach this device' : 'Turn on to let notifications reach this device'}</span>
      </button>
      {msg && <div className="auth-notice">{msg}</div>}
    </>
  );
}
