import { capabilities } from '../../../lib/capability/index.ts';
import { registerPushToken, saveNotificationPrefs } from '../../../lib/api.ts';

/** The one localStorage key a registered push token lives under — shared with PushToggle, so the
 *  Settings toggle reflects a permission granted anywhere else (the building screen). */
export const PUSH_TOKEN_KEY = 'cadence.pushToken';

export type EnablePushOutcome = 'on' | 'denied' | 'failed' | 'unavailable';

/**
 * The whole enable dance as one reusable move: iOS permission → APNs token → server registration
 * → prefs flipped on. Extracted from PushToggle so the building screen can ask "want a ping when
 * it's ready?" without duplicating the contract — same token key, same prefs flag, so whatever
 * surface asked, Settings tells the truth about the answer afterward.
 */
export async function enablePushOnThisDevice(): Promise<EnablePushOutcome> {
  if (!capabilities.push.isAvailable()) return 'unavailable';
  const token = await capabilities.push.register();
  if (!token) return 'denied';
  if (!(await registerPushToken(token))) return 'failed';
  try {
    window.localStorage.setItem(PUSH_TOKEN_KEY, token);
  } catch {
    /* private mode — the server registration is what matters */
  }
  await saveNotificationPrefs({ enabled: true }).catch(() => null);
  return 'on';
}
