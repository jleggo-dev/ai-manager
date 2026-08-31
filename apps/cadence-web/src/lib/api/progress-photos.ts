/**
 * Progress photos (routes/progress-photos.ts) — opt-in, dated, weight-stamped, never scored.
 * The card reads the pair; the "All photos" screen (SR-5) reads the full list and posts new ones.
 */
import type { PhotoPairPayload, ProgressPhotoSlot, WidgetOmission } from '@cadence/shared';
import { BASE, headers } from './http.ts';

/** `photo_pair` — earliest + latest photo for the card, or `{ omission }` (off, or none yet). */
export async function getProgressPhotoPair(): Promise<PhotoPairPayload | { omission: WidgetOmission }> {
  const res = await fetch(`${BASE}/progress/photo-pair`, { headers: headers() });
  if (!res.ok) throw new Error(`/progress/photo-pair failed: ${res.status}`);
  return res.json();
}

/** GET /progress/photos response shape (services/progress-photos.ts `listProgressPhotoCards`) —
 *  the whole "All photos" screen's read. Off — the default — comes back honest and empty, never
 *  an error, so this never wraps in an omission the way the widget reads do. */
export interface ProgressPhotoList {
  enabled: boolean;
  count: number;
  next_due: string | null;
  photos: ProgressPhotoSlot[];
}

/** `/progress/photos` — every photo the user has, oldest first, plus the opt-in state, the
 *  count, and next-due. The "All photos" screen's one read. */
export async function getProgressPhotos(): Promise<ProgressPhotoList> {
  const res = await fetch(`${BASE}/progress/photos`, { headers: headers() });
  if (!res.ok) throw new Error(`/progress/photos failed: ${res.status}`);
  return res.json();
}

export interface StoredProgressPhoto {
  photo: { date: string; weight_kg: number | null };
  next_due: string | null;
}

/**
 * POST /progress/photos — store one photo (data-URL; `takenOn` defaults to today server-side).
 * Null on failure (off, invalid photo, or a network/server error) — same soft-fail convention as
 * `setUnits`/`saveNotificationPrefs`; the screen reads the null and says so, it never throws.
 */
export async function postProgressPhoto(photo: string, takenOn?: string): Promise<StoredProgressPhoto | null> {
  try {
    const res = await fetch(`${BASE}/progress/photos`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ photo, ...(takenOn ? { taken_on: takenOn } : {}) }),
    });
    if (!res.ok) return null;
    return (await res.json()) as StoredProgressPhoto;
  } catch {
    return null;
  }
}

/** PUT /progress/photos/enabled — the opt-in switch. Returns what the server actually stored. */
export async function putProgressPhotosEnabled(enabled: boolean): Promise<{ enabled: boolean } | null> {
  try {
    const res = await fetch(`${BASE}/progress/photos/enabled`, {
      method: 'PUT',
      headers: headers(),
      body: JSON.stringify({ enabled }),
    });
    if (!res.ok) return null;
    return (await res.json()) as { enabled: boolean };
  } catch {
    return null;
  }
}
