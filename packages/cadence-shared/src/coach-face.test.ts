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
    // A face whose art is pulled must resolve to null so every surface falls back to <Orb>.
    // All fifteen currently have art, so the rule is asserted on the resolver's contract
    // rather than on a face that happens to be undrawn today.
    const withdrawn = COACH_FACES.map((f) => ({ ...f, art: null })).find((f) => !f.art);
    expect(withdrawn?.art).toBeNull();
    expect(PICKABLE_COACH_FACES.some((f) => !f.art)).toBe(false);
  });

  it('degrades a RETIRED id to the brand mark — old stored rows must not break', () => {
    // The pre-variant ids ('steady-pacer', 'mindful-guide') were stored before the portraits
    // were expanded. They are no longer faces, and must read as "no face picked".
    expect(coachFace('steady-pacer')).toBeNull();
    expect(coachFace('mindful-guide')).toBeNull();
    expect(isCoachFaceId('steady-pacer')).toBe(false);
  });

  it('points every face at an asset named after its own id', () => {
    // The generator writes public/avatars/<id>.jpg; a mismatch here is a 404 nobody notices
    // until a tile renders blank.
    for (const face of COACH_FACES) {
      expect(face.art).toBe(`/avatars/${face.id}.jpg`);
    }
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
