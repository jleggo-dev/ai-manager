/**
 * Progress photos (routes/progress-photos.ts) — opt-in, dated, weight-stamped, never scored.
 * The card only needs the pair read today; the full list/upload surfaces land with the photos
 * screen in a later parcel. The Settings Room (SR-3) needs only the opt-in switch itself.
 */
import type { PhotoPairPayload, WidgetOmission } from '@cadence/shared';
import { BASE, headers } from './http.ts';

/** `photo_pair` — earliest + latest photo for the card, or `{ omission }` (off, or none yet). */
export async function getProgressPhotoPair(): Promise<PhotoPairPayload | { omission: WidgetOmission }> {
  const res = await fetch(`${BASE}/progress/photo-pair`, { headers: headers() });
  if (!res.ok) throw new Error(`/progress/photo-pair failed: ${res.status}`);
  return res.json();
}

/** What the Settings Room's toggle row needs — the opt-in state and enough to say why it matters. */
export interface ProgressPhotosStatus {
  enabled: boolean;
  count: number;
  next_due: string | null;
}

/** GET /progress/photos — soft-fails to "off" so a lagging API never blocks the toggle row. */
export async function getProgressPhotosStatus(): Promise<ProgressPhotosStatus> {
  try {
    const res = await fetch(`${BASE}/progress/photos`, { headers: headers() });
    if (!res.ok) return { enabled: false, count: 0, next_due: null };
    const body = (await res.json()) as Partial<ProgressPhotosStatus>;
    return { enabled: body.enabled === true, count: body.count ?? 0, next_due: body.next_due ?? null };
  } catch {
    return { enabled: false, count: 0, next_due: null };
  }
}

/** PUT /progress/photos/enabled — flips the opt-in switch; returns what the server actually stored. */
export async function setProgressPhotosEnabled(enabled: boolean): Promise<boolean> {
  try {
    const res = await fetch(`${BASE}/progress/photos/enabled`, {
      method: 'PUT',
      headers: headers(),
      body: JSON.stringify({ enabled }),
    });
    if (!res.ok) return false;
    const body = (await res.json()) as { enabled?: boolean };
    return body.enabled === true;
  } catch {
    return false;
  }
}
