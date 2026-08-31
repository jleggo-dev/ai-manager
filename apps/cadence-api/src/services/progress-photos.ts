/**
 * Progress photos (owner design "Cadence Progress" 1a, "PHOTOS · every 4 weeks · optional") —
 * the meal-photo pattern applied to a new record: Supabase Storage, PRIVATE bucket, self-healing
 * creation, userId-scoped paths (`<userId>/<date>/<uuid>.<ext>` — purge is one folder walk),
 * short-TTL signed URLs.
 *
 * Brand physics, held by this file: photos are dated and weight-stamped, never scored — nothing
 * here computes a delta, a comparison, or a judgment. `weight_kg` is the user's OWN nearest
 * weigh-in within ±3 days of the photo date when one exists, null otherwise — never invented.
 * The whole subsystem is opt-in: every entry point checks `users.progress_photos_enabled` first
 * and answers "off" without touching the photos table, which also keeps a pre-migration-0048
 * database safe (the flag column reads as undefined = off).
 */
import type { PhotoPairPayload, ProgressPhotoSlot, WidgetOmission } from '@cadence/shared';
import { cadenceServiceClient } from '../db/supabase.ts';
import { getUser } from '../repos/users.ts';
import { listWeighInSeries } from '../repos/occurrences.ts';
import {
  countProgressPhotos,
  insertProgressPhoto,
  listProgressPhotos,
  type ProgressPhotoRow,
} from '../repos/progress-photos.ts';
import { parsePhotoDataUrl } from './photo-validate.ts';
import { omit } from './window-range.ts';

const BUCKET = 'progress-photos';
const SIGNED_URL_TTL_S = 60 * 60; // 1h — the tab refetches per open, so short is fine
/** "every 4 weeks" — the cadence the card states and next-due counts by. */
export const PHOTO_CADENCE_DAYS = 28;
/** A weigh-in speaks for a photo only this close to it. */
const WEIGH_IN_WINDOW_DAYS = 3;

const dayMs = 86_400_000;
const dayNumber = (dateIso: string): number => Math.round(new Date(`${dateIso}T00:00:00Z`).getTime() / dayMs);

/* ── Pure helpers (fixture-tested, no DB) ───────────────────────────────────────────────────── */

/** The user's own nearest weigh-in within ±3 days of `takenOn` — null when none is that close. */
export function nearestWeighInKg(series: { date: string; kg: number }[], takenOn: string): number | null {
  const target = dayNumber(takenOn);
  let best: { kg: number; diff: number; date: string } | null = null;
  for (const point of series) {
    const diff = Math.abs(dayNumber(point.date) - target);
    if (diff > WEIGH_IN_WINDOW_DAYS) continue;
    if (!best || diff < best.diff || (diff === best.diff && point.date < best.date)) {
      best = { kg: point.kg, diff, date: point.date };
    }
  }
  return best ? best.kg : null;
}

/** Last photo + 28 days. Null when there is no photo yet — the card then invites the first one
 *  instead of counting down to nothing. */
export function nextPhotoDue(lastTakenOn: string | null): string | null {
  if (!lastTakenOn) return null;
  const ms = new Date(`${lastTakenOn}T00:00:00Z`).getTime();
  if (!Number.isFinite(ms)) return null;
  return new Date(ms + PHOTO_CADENCE_DAYS * dayMs).toISOString().slice(0, 10);
}

/** Earliest + latest from the signed slots (oldest-first). One photo = a first slot and no
 *  latest — the renderer says so honestly rather than doubling the same picture. */
export function buildPhotoPair(slots: ProgressPhotoSlot[]): PhotoPairPayload | null {
  if (slots.length === 0) return null;
  const first = slots[0]!;
  const latest = slots.length > 1 ? slots[slots.length - 1]! : null;
  return {
    first,
    latest,
    next_due: nextPhotoDue((latest ?? first).date),
    count: slots.length,
  };
}

/* ── Storage + DB (the impure half) ─────────────────────────────────────────────────────────── */

async function isEnabled(userId: string): Promise<boolean> {
  const user = await getUser(userId);
  return user?.progress_photos_enabled === true;
}

async function uploadToBucket(userId: string, takenOn: string, dataUrl: string): Promise<string> {
  const parsed = parsePhotoDataUrl(dataUrl);
  if (!parsed.ok) throw new Error(`invalid photo: ${parsed.reason}`);
  const storage = cadenceServiceClient().storage;
  const path = `${userId}/${takenOn}/${crypto.randomUUID()}.${parsed.ext}`;
  const upload = () => storage.from(BUCKET).upload(path, parsed.buffer, { contentType: parsed.mime, upsert: false });
  let { error } = await upload();
  if (error && /bucket/i.test(error.message) && /not.*found/i.test(error.message)) {
    await storage.createBucket(BUCKET, { public: false }).catch(() => {}); // race-safe: loser's error is fine
    ({ error } = await upload());
  }
  if (error) throw new Error(`photo upload failed: ${error.message}`);
  return path;
}

/**
 * Store one progress photo. Returns null when the feature is off — the route answers 403 rather
 * than quietly keeping a photo the user never opted into sharing with the record.
 */
export async function putProgressPhoto(
  userId: string,
  dataUrl: string,
  takenOn: string = new Date().toISOString().slice(0, 10),
): Promise<{ row: ProgressPhotoRow; next_due: string | null } | null> {
  if (!(await isEnabled(userId))) return null;
  const photo_ref = await uploadToBucket(userId, takenOn, dataUrl);
  // The weigh-in series is day-count-scoped from "now": reach back far enough to cover a
  // backdated photo plus the ±3-day window, with a small floor for the ordinary today case.
  const daysBack = Math.max(14, Math.round((Date.now() - new Date(`${takenOn}T00:00:00Z`).getTime()) / dayMs) + 7);
  const series = await listWeighInSeries(userId, daysBack);
  const weight_kg = nearestWeighInKg(series, takenOn);
  const row = await insertProgressPhoto(userId, { taken_on: takenOn, photo_ref, weight_kg });
  // Next-due counts from the LATEST photo on file — a backdated upload must never move it earlier.
  const rows = await listProgressPhotos(userId);
  return { row, next_due: nextPhotoDue(rows[rows.length - 1]?.taken_on ?? row.taken_on) };
}

export interface ProgressPhotoList {
  enabled: boolean;
  count: number;
  next_due: string | null;
  photos: ProgressPhotoSlot[];
}

/** Everything the photos surface needs: signed slots (oldest first), the count, and next-due.
 *  Off — the default — answers without touching the photos table. */
export async function listProgressPhotoCards(userId: string): Promise<ProgressPhotoList> {
  if (!(await isEnabled(userId))) return { enabled: false, count: 0, next_due: null, photos: [] };
  const rows = await listProgressPhotos(userId);
  if (rows.length === 0) return { enabled: true, count: 0, next_due: null, photos: [] };

  const storage = cadenceServiceClient().storage;
  const { data } = await storage.from(BUCKET).createSignedUrls(
    rows.map((r) => r.photo_ref),
    SIGNED_URL_TTL_S,
  );
  const byPath = new Map((data ?? []).filter((d) => d.signedUrl).map((d) => [d.path, d.signedUrl]));
  const photos: ProgressPhotoSlot[] = rows
    .map((r) => ({ date: r.taken_on, weight_kg: r.weight_kg, url: byPath.get(r.photo_ref) ?? '' }))
    .filter((s) => s.url !== '');
  return {
    enabled: true,
    count: rows.length,
    next_due: nextPhotoDue(rows[rows.length - 1]!.taken_on),
    photos,
  };
}

/** Opted in AND at least one photo — the cheap existence fact the default layout and the compose
 *  availability both gate the `photo_pair` card on. Off never touches the photos table. */
export async function hasProgressPhotos(userId: string): Promise<boolean> {
  if (!(await isEnabled(userId))) return false;
  return (await countProgressPhotos(userId)) > 0;
}

/** The `photo_pair` widget read: payload, or the omission evidence (off, or nothing taken yet). */
export async function getPhotoPair(userId: string): Promise<PhotoPairPayload | WidgetOmission> {
  const list = await listProgressPhotoCards(userId);
  if (!list.enabled) return omit('photo_pair', 'photo_pair', 'progress photos are off (opt-in)');
  const pair = buildPhotoPair(list.photos);
  if (!pair) return omit('photo_pair', 'photo_pair', 'progress photos are on but none have been added yet');
  return pair;
}

/** Remove every progress photo the user owns — part of the start-over promise. */
export async function purgeProgressPhotos(userId: string): Promise<void> {
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
