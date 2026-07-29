import { describe, expect, it } from 'vitest';
import { ringArcs } from './nutritionRing.ts';

describe('ringArcs', () => {
  it('stacks pending after logged (design 2B: 820 logged, +650, 2000 target)', () => {
    const a = ringArcs(820, 650, 2000);
    expect(a.loggedLen).toBeCloseTo(41);
    expect(a.pendingLen).toBeCloseTo(32.5);
    expect(a.pendingOffset).toBeCloseTo(41);
    expect(a.over).toBe(false);
    expect(a.remaining).toBe(530); // "530 kcal left after this"
  });

  it('flags over-target and reports the magnitude to show as "N over"', () => {
    const a = ringArcs(1800, 400, 2000);
    expect(a.over).toBe(true);
    expect(a.remaining).toBe(-200);
    // pending is clamped to the free space so the arcs never wrap past the ring
    expect(a.loggedLen).toBeCloseTo(90);
    expect(a.pendingLen).toBeCloseTo(10);
  });

  it('clamps a logged total already past target to a full ring', () => {
    const a = ringArcs(2100, 0, 2000);
    expect(a.loggedLen).toBe(100);
    expect(a.pendingLen).toBe(0);
    expect(a.over).toBe(true);
    expect(a.remaining).toBe(-100);
  });

  it('handles the no-pending case (just logged so far)', () => {
    const a = ringArcs(820, 0, 2000);
    expect(a.loggedLen).toBeCloseTo(41);
    expect(a.pendingLen).toBe(0);
    expect(a.over).toBe(false);
    expect(a.remaining).toBe(1180); // "1,180 left"
  });

  it('is resilient to a zero/garbage target', () => {
    const a = ringArcs(500, 0, 0);
    expect(Number.isFinite(a.loggedLen)).toBe(true);
    expect(a.loggedLen).toBe(100); // 500 / (guarded 1) clamps to a full ring rather than NaN
  });
});
