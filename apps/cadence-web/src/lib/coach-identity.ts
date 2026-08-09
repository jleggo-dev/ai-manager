import { coachFace } from '@cadence/shared';
import { getCoachFace } from './api/coach-moments.ts';
import { capabilities } from './capability/index.ts';

/**
 * Give Cadence's notifications the coach's face.
 *
 * iOS lets an app donate an `INSendMessageIntent` describing who a message is from. Do that, and
 * the system renders the notification as a MESSAGE: the sender's portrait replaces the app icon,
 * the app icon shrinks to a corner badge, and Cadence appears under "People" in Focus settings —
 * so someone can let their coach through Do Not Disturb the same way they let a person through.
 *
 * That last part is the real reason to do this. A notification from a portrait reads as someone
 * speaking; a notification from an app icon reads as software. Cadence's whole voice is "I", and
 * this is the one surface where the platform decides whether that lands.
 *
 * Everything here degrades to nothing. No face chosen, no plugin, web build, a failed image fetch —
 * each falls back to a plain app-icon notification, which is exactly what shipped before. The face
 * is a nicety; the notification is the thing that must not break.
 */

/** Cadence has one name and one voice; the portrait is a picture, never a persona. */
const SENDER_NAME = 'Cadence';

/** Portraits are small square JPEGs; this is a generous ceiling that still refuses a surprise. */
const MAX_BYTES = 512 * 1024;

/** Fetch the portrait and return its bytes as base64, or null if anything about it is off. */
async function faceAsBase64(art: string): Promise<string | null> {
  const res = await fetch(art);
  if (!res.ok) return null;
  const blob = await res.blob();
  if (blob.size > MAX_BYTES) return null;
  const buffer = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  // Chunked so a large portrait cannot blow the argument limit on String.fromCharCode.
  for (let i = 0; i < buffer.length; i += 0x8000) {
    binary += String.fromCharCode(...buffer.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

/**
 * Donate the coach's identity, if there is one to donate.
 *
 * Call BEFORE scheduling: iOS matches a notification to the most recent matching donation, so a
 * donation that lands after the notification is scheduled decorates nothing.
 *
 * Returns whether the donation happened, for tests and logging. Never throws.
 */
export async function donateCoachIdentity(): Promise<boolean> {
  try {
    if (!capabilities.coachIdentity.isAvailable()) return false;
    const face = coachFace(await getCoachFace());
    // No face chosen is a real answer, not a missing one: the user gets the app icon, which is the
    // honest thing to show when they have not picked a portrait rather than assigning them one.
    if (!face?.art) return false;
    const avatarBase64 = await faceAsBase64(face.art);
    if (!avatarBase64) return false;
    return await capabilities.coachIdentity.donate({ senderName: SENDER_NAME, avatarBase64 });
  } catch (err) {
    console.warn('[coach-identity] donation skipped (non-fatal):', err);
    return false;
  }
}
