import { describe, expect, it } from 'vitest';
import type { Activity } from '@cadence/shared';
import { DENSITY_FLOOR, densityRepairSteer, firesOn, readDensity } from './plan-density.ts';

const act = (recurrence: string, kind: 'user' | 'system' = 'user'): Partial<Activity> => ({
  kind,
  schedule: { recurrence },
});

describe('readDensity', () => {
  /**
   * The round-4 device plan, exactly as committed: two 2×/wk cores, one daily 10-min prehab, one
   * 1×/wk walk, a system check-in. Every active day held 1-2 user items — the week the owner
   * called unusable. This is the shape that MUST trigger repair.
   */
  it('flags the observed round-4 week as needing repair', () => {
    const plan = [
      act('FREQ=WEEKLY;BYDAY=TU,SA'), // endurance run
      act('FREQ=WEEKLY;BYDAY=MO,TH'), // obstacle strength
      act('FREQ=DAILY'), // joint prehab
      act('FREQ=WEEKLY;BYDAY=WE'), // recovery walk
      act('FREQ=WEEKLY;BYDAY=SU', 'system'), // weekly check-in — never counts toward the floor
    ];
    const d = readDensity(plan);
    expect(d.perDay).toEqual([2, 2, 2, 2, 1, 2, 1]);
    expect(d.activeDays).toBe(7);
    expect(d.thinDays).toHaveLength(7);
    expect(d.needsRepair).toBe(true);
  });

  it('passes a week whose active days hold the floor', () => {
    const plan = [
      act('FREQ=DAILY'),
      act('FREQ=DAILY'),
      act('FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR'),
      act('FREQ=WEEKLY;BYDAY=SA,SU'),
    ];
    expect(readDensity(plan).needsRepair).toBe(false);
  });

  /** One-small-thing plans have ONE active-day shape by construction; the repair still fires and
   *  the STEER carries the minimal exception — the model returns them unchanged, and unchanged is
   *  accepted. The floor never rewrites restraint on its own. */
  it('counts rest days as rest, not as thin days', () => {
    const plan = [
      act('FREQ=WEEKLY;BYDAY=MO,WE,FR'),
      act('FREQ=WEEKLY;BYDAY=MO,WE,FR'),
      act('FREQ=WEEKLY;BYDAY=MO,WE,FR'),
    ];
    const d = readDensity(plan);
    expect(d.activeDays).toBe(3); // Tue/Thu/Sat/Sun are rest, and rest is fine
    expect(d.needsRepair).toBe(false);
  });

  it('treats an empty plan as nothing to repair', () => {
    expect(readDensity([]).needsRepair).toBe(false);
  });
});

describe('firesOn', () => {
  it('reads DAILY, WEEKLY;BYDAY, and refuses what it cannot parse', () => {
    expect(firesOn('FREQ=DAILY', 'WE')).toBe(true);
    expect(firesOn('FREQ=DAILY;INTERVAL=2', 'WE')).toBe(false);
    expect(firesOn('FREQ=WEEKLY;BYDAY=MO,FR', 'FR')).toBe(true);
    expect(firesOn('FREQ=WEEKLY;BYDAY=MO,FR', 'TU')).toBe(false);
    expect(firesOn('FREQ=MONTHLY;BYMONTHDAY=1', 'MO')).toBe(false);
    expect(firesOn('', 'MO')).toBe(false);
  });
});

describe('densityRepairSteer', () => {
  it('names the thin days, the floor, the per-day counts, and the minimal exception', () => {
    const s = densityRepairSteer(readDensity([act('FREQ=WEEKLY;BYDAY=TU,SA'), act('FREQ=WEEKLY;BYDAY=MO,TH')]));
    expect(s).toContain('DENSITY READ');
    expect(s).toContain(String(DENSITY_FLOOR));
    expect(s).toMatch(/one small commitment/);
    expect(s).toMatch(/Keep EVERY existing activity/);
    // The facts she plans from: what every day already holds, MO..SU.
    expect(s).toContain('MO 1, TU 1, WE 0, TH 1, FR 0, SA 1, SU 0');
    expect(s).toContain('Anything you add carries suggested: true');
  });

  // Facts, not picks (owner 2026-09-03): the repair pass hands her the counts and the floor.
  // It never names a length, an anchor, or a number of items to add.
  it('never prescribes what to add, how long, or what to anchor it to', () => {
    const s = densityRepairSteer(readDensity([act('FREQ=WEEKLY;BYDAY=TU,SA')]));
    expect(s).not.toMatch(/ADD small anchored support routines/);
    expect(s).not.toMatch(/5-10 minutes/);
    expect(s).not.toMatch(/tied to waking, lunch, or bed/);
    expect(s).not.toMatch(/until a normal active day holds at least/);
    expect(s).not.toMatch(/too thin/);
  });
});
