/**
 * The coach's face.
 *
 * Cadence is ONE coach, with one name and one voice (BRAND.md: "the coach speaks as 'I'").
 * These are **portraits, not personalities** — picking one changes the picture and nothing
 * else: no tone, no copy, no prompt, no plan. That is why nothing here is called a persona,
 * a temperament or a voice; naming it that way is exactly how a picture quietly becomes
 * fifteen different coaches, and the user then has to wonder which one remembers them.
 *
 * **Why the ids read like categories and the labels don't.** Each id carries the owner's own
 * vocabulary for the source art (`steady-pacer`, `mindful-guide`, `rhythm-keeper`,
 * `hearth-anchor` — Body, Mind, Creative, Any). That grouping is a fact about where the
 * artwork came from, and it keeps ids stable and matched to their asset filenames. It is
 * deliberately NOT surfaced: the picker renders portraits with no captions, and the
 * accessible labels are positional, so nothing on screen or in a screen reader implies that
 * a face carries a temperament — or asserts anything about the person depicted.
 *
 * The naming of all of this is an open question (docs/cadence/PLAN.md, "Coach face naming").
 * Nothing derives meaning from these strings, so renaming is a data edit plus an asset rename.
 *
 * A face is optional, and `null` always renders the Metronome Split mark (`<Orb>`) — the product's
 * own voice. An id that no longer exists resolves the same way, so withdrawing a portrait degrades
 * to the mark instead of a broken image.
 *
 * **Who gets a face, and when (owner ruling 2026-08-09).** Onboarding draws one at random when the
 * user meets Cadence and keeps it. The earlier rule here — never assign a portrait, always start
 * from the mark — was written for a wizard where the mark was all anyone had seen. It doesn't
 * survive a product that opens with "Hi, I'm your coach": a logo saying that is a logo pretending
 * to be a person. So the picker during the plan build opens with her already selected, and `null`
 * on a live account means someone deliberately chose the mark instead.
 */

export const COACH_FACE_IDS = [
  'steady-pacer-feminine-1',
  'steady-pacer-feminine-2',
  'steady-pacer-masculine-1',
  'steady-pacer-masculine-2',
  'steady-pacer-neutral',
  'mindful-guide-feminine-1',
  'mindful-guide-feminine-2',
  'mindful-guide-masculine',
  'mindful-guide-neutral',
  'rhythm-keeper-feminine',
  'rhythm-keeper-masculine',
  'rhythm-keeper-neutral',
  'hearth-anchor-feminine',
  'hearth-anchor-masculine',
  'hearth-anchor-neutral',
] as const;

export type CoachFaceId = (typeof COACH_FACE_IDS)[number];

export interface CoachFace {
  id: CoachFaceId;
  /**
   * Accessible label, never rendered as visible text. Positional on purpose: a sighted user is
   * choosing from pictures, and a screen-reader user needs the options distinguishable without
   * the app claiming anything about who is depicted.
   */
  label: string;
  /** Public asset path, or null while a portrait is still to be drawn. */
  art: string | null;
}

export const COACH_FACES: readonly CoachFace[] = COACH_FACE_IDS.map((id, i) => ({
  id,
  label: `Face ${i + 1}`,
  art: `/avatars/${id}.jpg`,
}));

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
