/**
 * The seeds test (owner mandate, TURN 1 "seed, never lock"): every starting point must be a real,
 * already-runnable session — not just plausible-looking data. Every seed runs through
 * `deriveWalkthrough` without throwing, and every item resolves to the exact tool its family
 * promised (never left to chance/inference drifting later).
 */
import { describe, it, expect } from 'vitest';
import { deriveWalkthrough } from '@cadence/shared';
import { FAMILIES, SEEDS, seedsForFamily, familyOf } from './builderSeeds.ts';

/** What kind each block/item in a seed was AUTHORED to resolve to — mirrors how the seed was
 *  written (explicit `tool`, or the measure fields for the one kind with no `tool` route). */
function expectedKinds(session: (typeof SEEDS)[number]['session']): string[] {
  return session.blocks.map((block) => {
    if (block.mode === 'circuit') return 'circuit';
    const item = block.items[0];
    if (!item) throw new Error('empty block in a seed');
    if (item.tool) return item.tool;
    if (item.measure_metric || item.measure_unit) return 'measure';
    throw new Error(`seed item "${item.name}" names no tool and no measure fields`);
  });
}

describe('builderSeeds', () => {
  it('has 2–3 starting points for every family, and every family owns at least one seed', () => {
    for (const family of FAMILIES) {
      const seeds = seedsForFamily(family.id);
      expect(seeds.length).toBeGreaterThanOrEqual(2);
      expect(seeds.length).toBeLessThanOrEqual(3);
    }
  });

  it.each(SEEDS)('$id runs through deriveWalkthrough and every item resolves to its intended tool', (seed) => {
    const expected = expectedKinds(seed.session);
    const wt = deriveWalkthrough(seed.session);
    expect(wt.steps).toHaveLength(expected.length);
    wt.steps.forEach((step, i) => {
      expect(step.tool.kind).toBe(expected[i]);
      // A step with no real length would render "0 min" and contradict the footer's own total.
      expect(step.minutes).toBeGreaterThan(0);
    });
    expect(wt.total_min).toBeGreaterThan(0);
  });

  it('every seed session is well-formed OccurrenceSession JSON (round-trips through JSON)', () => {
    for (const seed of SEEDS) {
      const round = JSON.parse(JSON.stringify(seed.session));
      expect(round).toEqual(seed.session);
    }
  });

  it('familyOf resolves every declared family id back to its own definition', () => {
    for (const family of FAMILIES) {
      expect(familyOf(family.id)).toBe(family);
    }
  });
});
