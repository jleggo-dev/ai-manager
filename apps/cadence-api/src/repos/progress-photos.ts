/**
 * `cadence.progress_photos` (migration 0048) — the every-4-weeks visual record, opt-in.
 * Rows carry a date, a private-bucket storage path, and the user's own nearest weigh-in when one
 * existed. Callers gate every read/write on `users.progress_photos_enabled` FIRST (off is the
 * default and the pre-migration state), so none of these queries runs for a user who never
 * turned the feature on.
 */
import { sql } from '../db/sql.ts';

export interface ProgressPhotoRow {
  id: string;
  taken_on: string; // YYYY-MM-DD
  photo_ref: string;
  weight_kg: number | null;
}

export async function insertProgressPhoto(
  userId: string,
  photo: { taken_on: string; photo_ref: string; weight_kg: number | null },
): Promise<ProgressPhotoRow> {
  const [row] = await sql<ProgressPhotoRow[]>`
    insert into cadence.progress_photos (user_id, taken_on, photo_ref, weight_kg)
    values (${userId}, ${photo.taken_on}, ${photo.photo_ref}, ${photo.weight_kg})
    returning id, to_char(taken_on, 'YYYY-MM-DD') as taken_on, photo_ref, weight_kg::float as weight_kg`;
  return row!;
}

/** Every photo, oldest first — the pair reads its two ends off this, the drill screen the rest. */
export async function listProgressPhotos(userId: string): Promise<ProgressPhotoRow[]> {
  return sql<ProgressPhotoRow[]>`
    select id, to_char(taken_on, 'YYYY-MM-DD') as taken_on, photo_ref, weight_kg::float as weight_kg
    from cadence.progress_photos
    where user_id = ${userId}
    order by taken_on asc, created_at asc`;
}

export async function countProgressPhotos(userId: string): Promise<number> {
  const [row] = await sql<{ n: string }[]>`
    select count(*) as n from cadence.progress_photos where user_id = ${userId}`;
  return Number(row?.n ?? 0);
}
