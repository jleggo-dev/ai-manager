/**
 * The detour's equipment answer as a picture (PLAN §424, owner 2026-08-04): standing in the hotel
 * gym, snap it, and the remaining days re-draft around what is actually there. The photo is parsed
 * ONCE into equipment names and never shown back — no ref is stored, because nothing needs to
 * reread it ("I keep the words, not the recording", applied to pictures).
 *
 * Pipeline: upload (private bucket) → short-lived signed URL → `parse-gym-photo` vision job →
 * clamp names → the SAME `reviseEpisodeEquipment` the conversational path uses. One revision
 * machine, two doors in.
 *
 * Honest limit: vision images ride the in-process engine path only, so this works deployed but
 * cannot run from a laptop in remote-jobs mode — the same limitation meal photos already have.
 */
import { runJobBySlug } from '../ai/aim.ts';
import { putGymPhoto, signMealPhotoUrl } from './meal-photos.ts';
import { reviseEpisodeEquipment } from './episode.ts';

const MAX_PHOTOS = 4;
const MAX_EQUIPMENT = 20;

export interface GymPhotoResult {
  /** What the model saw — echoed so the UI can show "I can see: dumbbells, a treadmill…". */
  saw: string[];
  revised: boolean;
  reason: 'no_episode' | 'unchanged' | 'revised' | 'nothing_seen';
  note?: string;
}

/** Parse the job's output into names — exported for tests. Empty is a real answer (a bare room). */
export function normalizeGymPhoto(raw: string): string[] | null {
  let parsed: { equipment?: unknown };
  try {
    parsed = JSON.parse(raw) as { equipment?: unknown };
  } catch {
    return null;
  }
  if (!Array.isArray(parsed.equipment)) return null;
  return parsed.equipment
    .map((e) =>
      e && typeof (e as { name?: unknown }).name === 'string'
        ? String((e as { name: string }).name)
            .trim()
            .slice(0, 60)
        : '',
    )
    .filter(Boolean)
    .slice(0, MAX_EQUIPMENT);
}

/**
 * Photos → equipment → revision. `realistically, pictures` (owner): several angles of one gym are
 * one answer, so all photos go to ONE job call and the union is the list.
 */
export async function equipmentFromGymPhotos(userId: string, dataUrls: string[]): Promise<GymPhotoResult> {
  const photos = dataUrls.slice(0, MAX_PHOTOS);
  const urls: string[] = [];
  for (const dataUrl of photos) {
    const ref = await putGymPhoto(userId, dataUrl);
    urls.push(await signMealPhotoUrl(ref));
  }

  const res = await runJobBySlug(userId, 'parse-gym-photo', {}, { images: urls });
  const names = normalizeGymPhoto(String(res.formatted ?? res.raw ?? ''));
  if (names === null) return { saw: [], revised: false, reason: 'nothing_seen' };

  const r = await reviseEpisodeEquipment(
    userId,
    names.map((name) => ({ name })),
  );
  return { saw: names, revised: r.revised, reason: r.reason, note: r.note };
}
