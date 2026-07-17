import { cadenceServiceClient } from '../db/supabase.ts';
import { parsePhotoDataUrl } from './photo-validate.ts';
import type { NutritionLog } from '@cadence/shared';

/**
 * Meal-photo storage (Supabase Storage, PRIVATE bucket). Photos are capture-first: stored and
 * shown to the user today; machine-read later once the AI Admin engine gains multimodal input
 * (backlog §F) — photo_ref makes every photo retroactively parseable, so nothing shipped now
 * is lost. Paths are userId-scoped (`<userId>/<date>/<uuid>.<ext>`) so purge is one folder walk.
 */

const BUCKET = 'meal-photos';
const SIGNED_URL_TTL_S = 60 * 60; // 1h — the sheet refetches per open, so short is fine

/** Upload a validated data-URL photo; returns the storage path for photo_ref. Self-healing:
 *  creates the (private) bucket on first ever upload rather than requiring a provisioning step. */
export async function putMealPhoto(userId: string, date: string, dataUrl: string): Promise<string> {
  const parsed = parsePhotoDataUrl(dataUrl);
  if (!parsed.ok) throw new Error(`invalid photo: ${parsed.reason}`);

  const storage = cadenceServiceClient().storage;
  const path = `${userId}/${date}/${crypto.randomUUID()}.${parsed.ext}`;
  const upload = () => storage.from(BUCKET).upload(path, parsed.buffer, { contentType: parsed.mime, upsert: false });

  let { error } = await upload();
  if (error && /bucket/i.test(error.message) && /not.*found/i.test(error.message)) {
    await storage.createBucket(BUCKET, { public: false }).catch(() => {}); // race-safe: loser's error is fine
    ({ error } = await upload());
  }
  if (error) throw new Error(`photo upload failed: ${error.message}`);
  return path;
}

/** Sign ONE photo_ref (e.g. to hand a just-uploaded photo to the vision parser). */
export async function signMealPhotoUrl(photoRef: string, ttlSeconds = 600): Promise<string> {
  const { data, error } = await cadenceServiceClient().storage.from(BUCKET).createSignedUrl(photoRef, ttlSeconds);
  if (error || !data?.signedUrl) throw new Error(`photo sign failed: ${error?.message ?? 'no url'}`);
  return data.signedUrl;
}

/** Attach short-lived signed URLs to rows that carry a photo_ref (display-only field). */
export async function signMealPhotoUrls(rows: NutritionLog[]): Promise<NutritionLog[]> {
  const refs = rows.filter((r) => r.photo_ref);
  if (refs.length === 0) return rows;
  const storage = cadenceServiceClient().storage;
  const { data } = await storage.from(BUCKET).createSignedUrls(
    refs.map((r) => r.photo_ref!),
    SIGNED_URL_TTL_S,
  );
  const byPath = new Map((data ?? []).filter((d) => d.signedUrl).map((d) => [d.path, d.signedUrl]));
  return rows.map((r) => (r.photo_ref ? { ...r, photo_url: byPath.get(r.photo_ref) ?? null } : r));
}

/** Remove every photo the user owns — part of the start-over promise ("erases everything"). */
export async function purgeMealPhotos(userId: string): Promise<void> {
  const storage = cadenceServiceClient().storage;
  // Storage list() is per-folder; walk userId/<date>/ folders then delete their files.
  const { data: days } = await storage.from(BUCKET).list(userId);
  for (const day of days ?? []) {
    const prefix = `${userId}/${day.name}`;
    const { data: files } = await storage.from(BUCKET).list(prefix);
    const paths = (files ?? []).map((f) => `${prefix}/${f.name}`);
    if (paths.length) await storage.from(BUCKET).remove(paths);
  }
}
