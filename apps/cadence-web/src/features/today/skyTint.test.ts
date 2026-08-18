/**
 * The floating header's one job: never be a cream band on a navy trail. These pin the seam —
 * where the sampled sky crosses from light to dark — and the sunrise band at the day divider,
 * which is the one place a LATER day is bright at its very top.
 */
import {
  DARK_SKY_L,
  FIRST_SKY_L,
  LATER_SKY_L,
  isNightHour,
  skyLightnessAt,
  skyLightnessUnder,
  type SkyBand,
} from './skyTint.ts';

/** One day of trail, 1000px tall, starting at `top` in viewport coordinates. */
const day = (top: number, first: boolean): SkyBand => ({ top, height: 1000, first });

describe('skyLightnessAt', () => {
  it('reads the stops it was given, and interpolates between them', () => {
    expect(skyLightnessAt(FIRST_SKY_L, 0)).toBeCloseTo(0.95);
    expect(skyLightnessAt(FIRST_SKY_L, 1)).toBeCloseTo(0.23);
    // Halfway between the 0.74 dusk stop (0.58) and the 0.88 one (0.33).
    expect(skyLightnessAt(FIRST_SKY_L, 0.81)).toBeCloseTo(0.455, 2);
  });

  it('clamps rather than extrapolating off either end', () => {
    expect(skyLightnessAt(FIRST_SKY_L, -3)).toBeCloseTo(0.95);
    expect(skyLightnessAt(LATER_SKY_L, 4)).toBeCloseTo(0.23);
  });
});

describe('the sky under the header', () => {
  const bands = [day(0, true), day(1000, false)];

  it('is nothing at all above the first day — the header keeps its own default there', () => {
    expect(skyLightnessUnder(-40, bands)).toBeNull();
    expect(skyLightnessUnder(0, [])).toBeNull();
  });

  it('flips across the day/night seam as the trail scrolls under it', () => {
    // Morning stretch of today: cream. Evening stretch: night.
    expect(skyLightnessUnder(200, bands)! > DARK_SKY_L).toBe(true);
    expect(skyLightnessUnder(900, bands)! > DARK_SKY_L).toBe(false);
    // The crossing itself lands at 71% down the day — between the 0.56 stop (0.84) and the 0.74 one (0.58).
    expect(skyLightnessUnder(700, bands)! > DARK_SKY_L).toBe(true);
    expect(skyLightnessUnder(720, bands)! > DARK_SKY_L).toBe(false);
  });

  it('reads tomorrow with tomorrow’s ramp — the sunrise band makes its top bright', () => {
    // Same fraction down the day, opposite answer: 4% into today is dawn, 4% into a later day is
    // still the night before the divider.
    expect(skyLightnessUnder(1040, bands)!).toBeLessThan(DARK_SKY_L);
    expect(skyLightnessUnder(40, bands)!).toBeGreaterThan(DARK_SKY_L);
    // ...and by 30% down, the later day is at its brightest.
    expect(skyLightnessUnder(1300, bands)!).toBeCloseTo(0.96, 2);
  });

  it('ignores a day that has not been laid out yet', () => {
    expect(skyLightnessUnder(500, [{ top: 0, height: 0, first: true }])).toBeNull();
  });
});

describe('isNightHour', () => {
  it('covers the hours the old emoji got wrong', () => {
    expect(isNightHour(21)).toBe(true); // clear at 21:00 — the reported bug
    expect(isNightHour(2)).toBe(true);
    expect(isNightHour(6)).toBe(false);
    expect(isNightHour(19)).toBe(false);
  });
});
