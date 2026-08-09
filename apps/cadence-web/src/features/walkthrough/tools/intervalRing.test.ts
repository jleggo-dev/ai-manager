import { describe, it, expect } from 'vitest';
import { clampIntervalPlan, expandIntervalPhases } from '@cadence/shared';
import { ringSegments, stripSegments } from './intervalRing.ts';
import { INTERVAL_KIND, RING_C } from './tone.ts';

const phases = expandIntervalPhases(
  clampIntervalPlan({ warmupSec: 120, workSec: 40, recoverSec: 20, rounds: 6, cooldownSec: 60 }),
);

const arcOf = (dash: string) => Number(dash.split(' ')[0]);

describe('ringSegments', () => {
  it('draws one wedge per phase, sized by its seconds', () => {
    const segs = ringSegments(phases, 0, 0, false);
    expect(segs).toHaveLength(phases.length); // nothing extra at progress 0
    // The 2:00 warm-up is twice the arc of the 1:00 cool-down, minus the same fixed gap.
    const warm = arcOf(segs[0]!.dash);
    const cool = arcOf(segs[segs.length - 1]!.dash);
    expect(warm + 4).toBeCloseTo(2 * (cool + 4), 4);
  });

  it('wedges tile the whole circle — offsets advance by each phase span', () => {
    const segs = ringSegments(phases, 0, 0, false);
    const last = segs[segs.length - 1]!;
    const span = (60 / 540) * RING_C; // cool-down's share of the 9:00 run
    expect(-last.offset + span).toBeCloseTo(RING_C, 3);
  });

  it('colours by position: behind you is deep, ahead of you is the kind-tinted track', () => {
    // Keyed, not indexed: the in-progress phase inserts a second (fill) wedge, so positional
    // indexes past the current phase do not line up with phase numbers.
    const byKey = new Map(ringSegments(phases, 3, 0.5, false).map((s) => [s.key, s]));
    expect(byKey.get('p0')!.stroke).toBe(INTERVAL_KIND.neutral.done); // warm-up, finished
    expect(byKey.get('p1')!.stroke).toBe(INTERVAL_KIND.work.done); // round 1 work, finished
    expect(byKey.get('p3')!.stroke).toBe(INTERVAL_KIND.work.track); // round 2 work, in progress
    expect(byKey.get('f3')!.stroke).toBe(INTERVAL_KIND.work.fill); // its pro-rata fill
    expect(byKey.get('p4')!.stroke).toBe(INTERVAL_KIND.recover.track); // still ahead
  });

  it('adds exactly one animated pro-rata wedge over the phase in progress', () => {
    const segs = ringSegments(phases, 2, 0.5, false);
    const fills = segs.filter((s) => s.animated);
    expect(fills).toHaveLength(1);
    expect(fills[0]!.stroke).toBe(INTERVAL_KIND.recover.fill);
    // Half of the base wedge, and offset to the same place on the ring.
    const base = segs.find((s) => s.key === 'p2')!;
    expect(arcOf(fills[0]!.dash)).toBeCloseTo(arcOf(base.dash) / 2, 4);
    expect(fills[0]!.offset).toBe(base.offset);
  });

  it('reads every wedge as finished once done, with nothing still filling', () => {
    const segs = ringSegments(phases, phases.length - 1, 1, true);
    expect(segs.some((s) => s.animated)).toBe(false);
    expect(segs.every((s) => s.stroke.includes('oklch'))).toBe(true);
    expect(segs[4]!.stroke).toBe(INTERVAL_KIND.recover.done);
  });

  it('keeps a very short phase visible rather than collapsing it to a dot', () => {
    const long = expandIntervalPhases(clampIntervalPlan({ workSec: 600, recoverSec: 5, rounds: 5 }));
    const segs = ringSegments(long, 0, 0, false);
    expect(Math.min(...segs.map((s) => arcOf(s.dash)))).toBeGreaterThanOrEqual(2);
  });

  it('returns nothing for an empty run instead of dividing by zero', () => {
    expect(ringSegments([], 0, 0, false)).toEqual([]);
  });
});

describe('stripSegments', () => {
  it('weights one segment per phase by its seconds', () => {
    const strip = stripSegments(phases);
    expect(strip).toHaveLength(phases.length);
    expect(strip[0]).toMatchObject({ flex: 120, bg: INTERVAL_KIND.neutral.done });
    expect(strip[1]).toMatchObject({ flex: 40, bg: INTERVAL_KIND.work.done });
  });
});
