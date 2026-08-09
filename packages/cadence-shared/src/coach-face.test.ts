import { describe, expect, it } from 'vitest';
import { COACH_FACES, PICKABLE_COACH_FACES, coachFace, isCoachFaceId } from './coach-face.ts';

describe('coach faces', () => {
  it('only offers faces that actually have art', () => {
    expect(PICKABLE_COACH_FACES.length).toBeGreaterThan(0);
    expect(PICKABLE_COACH_FACES.every((f) => !!f.art)).toBe(true);
    // Undrawn faces are ABSENT from the picker, not shown as "coming soon" placeholders.
    expect(PICKABLE_COACH_FACES.length).toBe(COACH_FACES.filter((f) => f.art).length);
  });

  it('treats "no face picked" as a real answer rather than an error', () => {
    expect(coachFace(null)).toBeNull();
    expect(coachFace(undefined)).toBeNull();
    expect(isCoachFaceId(null)).toBe(false);
  });

  it('degrades a withdrawn portrait to the brand mark instead of a broken image', () => {
    const undrawn = COACH_FACES.find((f) => !f.art);
    if (!undrawn) throw new Error('expected at least one face still awaiting art');
    // The id is still valid — a stored row keeps working — but it resolves to no face, so every
    // surface falls back to <Orb> rather than rendering an empty <img>.
    expect(isCoachFaceId(undrawn.id)).toBe(true);
    expect(coachFace(undrawn.id)).toBeNull();
  });

  it('resolves a drawn face to its art', () => {
    const [face] = PICKABLE_COACH_FACES;
    if (!face) throw new Error('expected at least one drawn face');
    expect(coachFace(face.id)?.art).toBe(face.art);
  });

  it('rejects ids that are not faces', () => {
    expect(isCoachFaceId('the-bright-spark')).toBe(false);
    expect(coachFace('../../etc/passwd')).toBeNull();
  });

  it('keeps ids unique', () => {
    expect(new Set(COACH_FACES.map((f) => f.id)).size).toBe(COACH_FACES.length);
  });
});
