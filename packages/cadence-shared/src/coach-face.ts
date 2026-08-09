/**
 * The coach's face.
 *
 * Cadence is ONE coach, with one name and one voice (BRAND.md: "the coach speaks as 'I'").
 * These are **portraits, not personalities** — picking one changes the picture and nothing
 * else: no tone, no copy, no prompt, no plan. That is why nothing here is called a persona,
 * a temperament or a voice; naming it that way is exactly how a picture quietly becomes four
 * different coaches, and the user then has to wonder which one remembers them.
 *
 * The names below are internal ids and accessibility labels ONLY. The picker renders portraits
 * with no name text under them, so no label on screen can imply a temperament attaches to a
 * face. Rename freely — nothing derives meaning from these strings.
 *
 * A face is optional. Until someone picks one, every surface falls back to the Metronome Split
 * mark (`<Orb>`) — the product's own voice, which is the honest thing to show when the user
 * hasn't chosen a face rather than assigning them one.
 */

export const COACH_FACE_IDS = ['steady-pacer', 'mindful-guide', 'rhythm-keeper', 'hearth-anchor'] as const;

export type CoachFaceId = (typeof COACH_FACE_IDS)[number];

export interface CoachFace {
  id: CoachFaceId;
  /** Accessibility + internal label. Never rendered as tile text — see the file note. */
  name: string;
  /** Public asset path, or null while the portrait is still to be drawn. */
  art: string | null;
}

/**
 * The four faces. `art: null` is not a placeholder tile — it removes the face from the picker
 * entirely (see `PICKABLE_COACH_FACES`), so a user is never offered a face that doesn't exist.
 */
export const COACH_FACES: readonly CoachFace[] = [
  { id: 'steady-pacer', name: 'Steady Pacer', art: '/avatars/steady-pacer.jpg' },
  { id: 'mindful-guide', name: 'Mindful Guide', art: '/avatars/mindful-guide.jpg' },
  { id: 'rhythm-keeper', name: 'Rhythm Keeper', art: null },
  { id: 'hearth-anchor', name: 'Hearth Anchor', art: null },
];

/** Faces that can actually be chosen. Art is the gate — no hatched "coming soon" tiles. */
export const PICKABLE_COACH_FACES: readonly CoachFace[] = COACH_FACES.filter((f) => f.art !== null);

export function isCoachFaceId(v: unknown): v is CoachFaceId {
  return typeof v === 'string' && (COACH_FACE_IDS as readonly string[]).includes(v);
}

/** The face for an id, or null for "no face chosen" (and for an id whose art was withdrawn). */
export function coachFace(id: string | null | undefined): CoachFace | null {
  if (!isCoachFaceId(id)) return null;
  const face = COACH_FACES.find((f) => f.id === id) ?? null;
  return face?.art ? face : null;
}
