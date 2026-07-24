import { describe, it, expect } from 'vitest';
import type { OccurrenceSession, ProgressionScheme } from '@cadence/shared';
import { computeSession, parseLoad } from './progression.ts';

const AT = '2026-02-01T00:00:00.000Z';

/** One-item eval session (the week-0 template the engine carries forward). */
const evalWith = (fields: Record<string, unknown>): OccurrenceSession => ({
  blocks: [{ label: 'Main', items: [{ name: 'Back squat', sets: 3, reps: 5, ...fields }] }],
  note: 'Evaluation — find your working weight.',
  generated_at: '2026-01-01T00:00:00.000Z',
  version: 1,
});

const loadScheme: ProgressionScheme = {
  quantity: 'load',
  kind: 'percent',
  increment: 10,
  deload_every: 4,
  deload_pct: 90,
};
const loadOf = (s: OccurrenceSession) => s.blocks[0]!.items[0]!.load;

describe('parseLoad', () => {
  it('splits number + unit, and rejects non-numeric loads', () => {
    expect(parseLoad('55 lb')).toEqual({ n: 55, unit: 'lb' });
    expect(parseLoad('60kg')).toEqual({ n: 60, unit: 'kg' });
    expect(parseLoad('bodyweight')).toBeNull();
    expect(parseLoad('zone 2')).toBeNull();
    expect(parseLoad(undefined)).toBeNull();
  });
});

describe('computeSession — load %-progression + deload', () => {
  it('week 0 is the baseline (numbers unchanged), other fields preserved', () => {
    const s = computeSession(evalWith({ load: '100 lb' }), loadScheme, { weekIndex: 0 }, AT);
    expect(loadOf(s)).toBe('100 lb');
    const it0 = s.blocks[0]!.items[0]!;
    expect(it0.name).toBe('Back squat');
    expect(it0.sets).toBe(3);
    expect(it0.reps).toBe(5);
    expect(s.generated_at).toBe(AT);
  });

  it('progresses +10%/wk, rounded to the nearest 5', () => {
    const at = (w: number) => loadOf(computeSession(evalWith({ load: '100 lb' }), loadScheme, { weekIndex: w }, AT));
    expect(at(1)).toBe('110 lb'); // 100 × 1.1
    expect(at(2)).toBe('120 lb'); // 121 → 120
    expect(at(4)).toBe('135 lb'); // deload week 3 skipped as a step → 3 steps → 133.1 → 135
  });

  it('backs off on the 4th (deload) week and says so', () => {
    const s = computeSession(evalWith({ load: '100 lb' }), loadScheme, { weekIndex: 3 }, AT);
    expect(loadOf(s)).toBe('120 lb'); // 133.1 × 0.9 = 119.8 → 120
    expect(s.note.toLowerCase()).toContain('recovery');
  });

  it('holds at the previous week when the last session was missed', () => {
    const progressed = loadOf(computeSession(evalWith({ load: '100 lb' }), loadScheme, { weekIndex: 2 }, AT));
    const held = loadOf(
      computeSession(evalWith({ load: '100 lb' }), loadScheme, { weekIndex: 2, lastMissed: true }, AT),
    );
    expect(progressed).toBe('120 lb');
    expect(held).toBe('110 lb'); // effective week 1
  });

  it('is deterministic — same inputs produce an identical session', () => {
    const a = computeSession(evalWith({ load: '100 lb' }), loadScheme, { weekIndex: 5 }, AT);
    const b = computeSession(evalWith({ load: '100 lb' }), loadScheme, { weekIndex: 5 }, AT);
    expect(a).toEqual(b);
  });

  it('carries non-numeric loads through untouched', () => {
    const s = computeSession(evalWith({ load: 'bodyweight' }), loadScheme, { weekIndex: 3 }, AT);
    expect(loadOf(s)).toBe('bodyweight');
  });
});

describe('computeSession — other quantities', () => {
  it('progresses reps linearly (+1/wk) and leaves an item without that quantity alone', () => {
    const scheme: ProgressionScheme = { quantity: 'reps', kind: 'linear', increment: 1 };
    const s = computeSession(evalWith({ reps: 5 }), scheme, { weekIndex: 2 }, AT);
    expect(s.blocks[0]!.items[0]!.reps).toBe(7); // 5 + 1×2
  });

  it('progresses distance and rounds to 0.1 km', () => {
    const scheme: ProgressionScheme = { quantity: 'distance_km', kind: 'percent', increment: 10 };
    const s = computeSession(evalWith({ distance_km: 5 }), scheme, { weekIndex: 1 }, AT);
    expect(s.blocks[0]!.items[0]!.distance_km).toBe(5.5); // 5 × 1.1
  });
});
