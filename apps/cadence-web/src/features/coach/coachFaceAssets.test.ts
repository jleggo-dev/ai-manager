import { describe, expect, it } from 'vitest';
import { COACH_FACES, PICKABLE_COACH_FACES } from '@cadence/shared';

/**
 * Every offered face must have a file behind it — and every file must belong to a face.
 *
 * The registry lives in @cadence/shared and the artwork lives in cadence-web's `public/`, so
 * nothing but this test connects the two. Without it a renamed or missing asset ships as a
 * silently blank tile: the picker still renders, the radio still selects, and the only symptom
 * is a 404 in a console nobody is watching.
 *
 * Uses Vite's glob rather than node's `fs` because this workspace is a browser app and does not
 * carry node types — the same reason the assertion runs on filenames rather than on disk reads.
 */
const files = Object.keys(import.meta.glob('../../../public/avatars/*.jpg'));
const names = new Set(files.map((p) => p.split('/').pop()));

describe('coach face assets', () => {
  it('finds the avatar directory at all', () => {
    // A wrong glob path would make every other assertion here vacuously pass.
    expect(files.length).toBeGreaterThan(0);
  });

  it('has a file for every pickable face', () => {
    const missing = PICKABLE_COACH_FACES.filter((f) => !names.has(`${f.id}.jpg`)).map((f) => f.id);
    expect(missing).toEqual([]);
  });

  it('has no orphaned artwork — every file belongs to a face', () => {
    const known = new Set(COACH_FACES.map((f) => `${f.id}.jpg`));
    expect([...names].filter((n) => n && !known.has(n))).toEqual([]);
  });

  it('offers a meaningful number of faces', () => {
    // Guards against the registry being emptied by a bad edit — a picker silently showing
    // nothing looks identical to "the feature is off".
    expect(PICKABLE_COACH_FACES.length).toBeGreaterThanOrEqual(4);
  });
});
