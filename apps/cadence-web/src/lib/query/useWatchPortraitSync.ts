import { useEffect, useRef } from 'react';
import { coachFace, type CoachFaceId } from '@cadence/shared';
import { capabilities } from '../capability/index.ts';

/**
 * Send the coach's chosen portrait to the watch.
 *
 * The watch shipped with a bundled stand-in — a real coach's face, but not the one the user picked.
 * The brief always said the chosen portrait "arrives with the WatchConnectivity sync"; this is
 * that, and it only became cheap once the sync existed.
 *
 * Sent on CHANGE, never on a timer. A portrait is 20-30KB and changes approximately never, so a
 * periodic push would be pure waste; the face id is what decides.
 *
 * Deliberately separate from the week (`useWatchSync`): a picture must never cost a plan sync its
 * byte budget, and a failed portrait must never delay today's sessions reaching the wrist.
 */

/** Portraits are small square JPEGs. A generous ceiling that still refuses a surprise — the same
 *  bound `coach-identity.ts` uses for the notification donation. */
const MAX_BYTES = 512 * 1024;

/** Fetch the portrait and return its bytes as base64, or null if anything about it is off. */
async function portraitAsBase64(art: string): Promise<string | null> {
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

export function useWatchPortraitSync(faceId: CoachFaceId | null): void {
  /** The last face actually delivered. A failure leaves this alone, so the next change retries. */
  const delivered = useRef<string | null>(null);

  useEffect(() => {
    if (!faceId || faceId === delivered.current) return;
    if (!capabilities.watchSync.isAvailable()) return;

    // No art is a real answer, not a missing one: the watch keeps its stand-in rather than being
    // sent a broken picture. Captured into a local so the narrowing survives the async closure.
    const art = coachFace(faceId)?.art;
    if (!art) return;

    let cancelled = false;
    void (async () => {
      const state = await capabilities.watchSync.getState();
      // Nothing on the other end. Not marked delivered, so pairing a watch later still syncs.
      if (cancelled || !state.supported || !state.paired || !state.installed) return;

      const base64 = await portraitAsBase64(art);
      if (cancelled || !base64) return;

      const sent = await capabilities.watchSync.pushPortrait(faceId, base64);
      if (!cancelled && sent) delivered.current = faceId;
    })();

    return () => {
      cancelled = true;
    };
  }, [faceId]);
}
