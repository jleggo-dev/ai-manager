/**
 * Pure photo data-URL validation (no deps — unit-testable like capture-normalize.ts).
 * The client downscales to ≤1024px JPEG before sending, so the cap here is a backstop
 * against raw uploads, not the normal path. express.json's 2mb limit is the outer wall.
 */

export const MAX_PHOTO_BYTES = 1_500_000; // ~1.5MB decoded — a downscaled JPEG is far smaller

const DATA_URL_RE = /^data:image\/(jpeg|jpg|png|webp);base64,([A-Za-z0-9+/=]+)$/;

export type PhotoParse =
  | { ok: true; mime: string; ext: 'jpg' | 'png' | 'webp'; buffer: Buffer }
  | { ok: false; reason: 'not_image_data_url' | 'too_large' | 'unreadable' };

export function parsePhotoDataUrl(dataUrl: string): PhotoParse {
  const m = DATA_URL_RE.exec(dataUrl.trim());
  if (!m) return { ok: false, reason: 'not_image_data_url' };
  const kind = m[1] === 'jpg' ? 'jpeg' : m[1]!;
  let buffer: Buffer;
  try {
    buffer = Buffer.from(m[2]!, 'base64');
  } catch {
    return { ok: false, reason: 'unreadable' };
  }
  if (buffer.length === 0) return { ok: false, reason: 'unreadable' };
  if (buffer.length > MAX_PHOTO_BYTES) return { ok: false, reason: 'too_large' };
  return { ok: true, mime: `image/${kind}`, ext: kind === 'jpeg' ? 'jpg' : (kind as 'png' | 'webp'), buffer };
}
