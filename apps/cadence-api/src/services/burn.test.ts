import { describe, it, expect } from 'vitest';
import { estimateBurnKcal } from './burn.ts';

describe('estimateBurnKcal', () => {
  it('estimates MET × weight × hours, rounded to 10', () => {
    expect(estimateBurnKcal('run', 30, 88)).toBe(430); // 9.8 × 88 × 0.5 = 431 → 430
    expect(estimateBurnKcal('strength', 60, 88)).toBe(440); // 5 × 88 × 1
  });

  it('falls back to a modest MET for an unknown physical category', () => {
    expect(estimateBurnKcal('pilates', 60, 88)).toBe(350); // 4 × 88 = 352 → 350
  });

  it('burns nothing for non-physical categories', () => {
    expect(estimateBurnKcal('reflection', 60, 88)).toBe(0);
    expect(estimateBurnKcal('nourishment', 60, 88)).toBe(0);
    expect(estimateBurnKcal('measurement', 60, 88)).toBe(0);
  });

  it('returns 0 for missing duration, zero duration, or implausible weight', () => {
    expect(estimateBurnKcal('run', 0, 88)).toBe(0);
    expect(estimateBurnKcal('run', null, 88)).toBe(0);
    expect(estimateBurnKcal('run', 30, 0)).toBe(0);
    expect(estimateBurnKcal('run', 30, 600)).toBe(0);
    expect(estimateBurnKcal(undefined, 30, 88)).toBe(0);
  });
});
