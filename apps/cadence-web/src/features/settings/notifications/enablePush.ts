import { capabilities } from '../../../lib/capability/index.ts';
import { registerPushToken, removePushToken, saveNotificationPrefs } from '../../../lib/api.ts';

/** The one localStorage key a registered push token lives under — shared with the Settings dial,
 *  so "Off" there reflects a permission granted anywhere else (the building screen, app launch). */
export const PUSH_TOKEN_KEY = 'cadence.pushToken';

export type EnablePushOutcome = 'on' | 'denied' | 'failed' | 'unavailable';

export function storedPushToken(): string | null {
  try {
    return window.localStorage?.getItem(PUSH_TOKEN_KEY) ?? null;
  } catch {
    return null;
  }
}

/**
 * The device half of the enable dance: iOS permission → APNs token → server registration → token
 * remembered on this device. Says nothing about the prefs flag — the caller decides what to save
 * alongside it (the dial saves `enabled: true` AND the tier in one round trip).
 */
export async function registerPushDevice(): Promise<EnablePushOutcome> {
  if (!capabilities.push.isAvailable()) return 'unavailable';
  const token = await capabilities.push.register();
  if (!token) return 'denied';
  if (!(await registerPushToken(token))) {
    // The token exists and the SERVER refused it — a different fault from iOS saying no, and one
    // that leaves push permanently dead while the phone believes it is switched on.
    console.error('[push] server rejected the device token');
    return 'failed';
  }
  try {
    window.localStorage.setItem(PUSH_TOKEN_KEY, token);
  } catch {
    /* private mode — the server registration is what matters */
  }
  return 'on';
}

/**
 * Forget this device: the server-side token AND the local marker. Leaving a registered token
 * behind and relying on a boolean to suppress it means one bug away from a notification arriving
 * at a device the user told us to stop using.
 */
export async function forgetPushDevice(): Promise<void> {
  const token = storedPushToken();
  if (token) await removePushToken(token).catch(() => false);
  try {
    window.localStorage.removeItem(PUSH_TOKEN_KEY);
  } catch {
    /* nothing stored, nothing to forget */
  }
}

/**
 * The whole enable dance as one reusable move, prefs flipped on included — what the building
 * screen and the launch-time registration (`usePushRegistered`) call, so whatever surface asked,
 * Settings tells the truth about the answer afterward.
 */
export async function enablePushOnThisDevice(): Promise<EnablePushOutcome> {
  const outcome = await registerPushDevice();
  if (outcome === 'on') await saveNotificationPrefs({ enabled: true }).catch(() => null);
  return outcome;
}
