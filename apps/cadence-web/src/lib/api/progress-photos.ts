/**
 * Progress photos (routes/progress-photos.ts) — opt-in, dated, weight-stamped, never scored.
 * The card only needs the pair read today; the list/upload/enable surfaces land with the photos
 * screen in a later parcel.
 */
import type { PhotoPairPayload, WidgetOmission } from '@cadence/shared';
import { BASE, headers } from './http.ts';

/** `photo_pair` — earliest + latest photo for the card, or `{ omission }` (off, or none yet). */
export async function getProgressPhotoPair(): Promise<PhotoPairPayload | { omission: WidgetOmission }> {
  const res = await fetch(`${BASE}/progress/photo-pair`, { headers: headers() });
  if (!res.ok) throw new Error(`/progress/photo-pair failed: ${res.status}`);
  return res.json();
}
