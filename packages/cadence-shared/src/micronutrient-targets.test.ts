import { describe, expect, it } from 'vitest';
import {
  microStatus,
  microTargetRange,
  micronutrientTargets,
  resolveMicronutrientTargets,
  sanitizeMicroTargetAmount,
  MICRONUTRIENT_KEYS,
} from './micronutrient-targets.ts';

function find(ts: ReturnType<typeof micronutrientTargets>, key: string) {
  const hit = ts.find((t) => t.key === key);
  if (!hit) throw new Error(`no reference intake for ${key}`);
  return hit;
}

/**
 * These are published DRI values, so the tests are really about the two things code can get
 * wrong: picking the right row for a person, and never confusing "eat at least" with "stay under".
 */
describe('micronutrientTargets', () => {
  it('uses the published adult figures per sex', () => {
    const m = micronutrientTargets({ sex: 'male', age: 40 });
    const f = micronutrientTargets({ sex: 'female', age: 30 });
    expect(find(m, 'iron_mg').amount).toBe(8);
    expect(find(f, 'iron_mg').amount).toBe(18);
    expect(find(m, 'fiber_g').amount).toBe(38);
    expect(find(f, 'fiber_g').amount).toBe(25);
    // B12 does not vary by sex, and is the one a plant-based diet must watch.
    expect(find(m, 'vitamin_b12_ug').amount).toBe(2.4);
    expect(find(f, 'vitamin_b12_ug').amount).toBe(2.4);
  });

  it('applies the age bands', () => {
    expect(find(micronutrientTargets({ sex: 'female', age: 60 }), 'iron_mg').amount).toBe(8);
    expect(find(micronutrientTargets({ sex: 'female', age: 60 }), 'calcium_mg').amount).toBe(1200);
    expect(find(micronutrientTargets({ sex: 'male', age: 75 }), 'calcium_mg').amount).toBe(1200);
    expect(find(micronutrientTargets({ sex: 'male', age: 40 }), 'calcium_mg').amount).toBe(1000);
  });

  it('is cautious when it does not know who it is talking to', () => {
    const u = micronutrientTargets({});
    // A floor takes the HIGHER requirement — under-targeting defeats the point of tracking.
    expect(find(u, 'iron_mg').amount).toBe(18);
    // A ceiling takes the LOWER limit.
    expect(find(u, 'sodium_mg').amount).toBe(2300);
  });

  it('marks sodium as a ceiling and everything else as a floor', () => {
    const t = micronutrientTargets({ sex: 'male', age: 40 });
    expect(find(t, 'sodium_mg').direction).toBe('ceiling');
    for (const row of t.filter((r) => r.key !== 'sodium_mg')) expect(row.direction).toBe('floor');
  });

  it('exposes exactly the keys it has targets for', () => {
    expect(MICRONUTRIENT_KEYS).toContain('vitamin_b12_ug');
    expect(MICRONUTRIENT_KEYS).not.toContain('kcal');
  });
});

describe('microStatus', () => {
  const t = micronutrientTargets({ sex: 'female', age: 30 });
  const iron = find(t, 'iron_mg');
  const sodium = find(t, 'sodium_mg');

  it('flags a floor only when it is short', () => {
    expect(microStatus(iron, 9).short).toBe(true);
    expect(microStatus(iron, 18).short).toBe(false);
    expect(microStatus(iron, 25).short).toBe(false);
    // A met floor is silence, not a green tick — count what happened, never what broke.
    expect(microStatus(iron, 25).over).toBe(false);
  });

  it('flags a ceiling only when it is exceeded', () => {
    expect(microStatus(sodium, 1800).over).toBe(false);
    expect(microStatus(sodium, 3000).over).toBe(true);
    expect(microStatus(sodium, 3000).short).toBe(false);
  });

  it('treats nothing logged as zero rather than as missing', () => {
    expect(microStatus(iron, undefined).pct).toBe(0);
    expect(microStatus(iron, undefined).short).toBe(true);
  });

  it('caps a wild outlier so one bad row cannot blow up a bar', () => {
    expect(microStatus(iron, 100_000).pct).toBe(999);
  });
});

describe('overrides — a number they were given outside the app (owner ruling 2026-09-01)', () => {
  const doctorSaid2000 = {
    vitamin_c_mg: { amount: 2000, why: 'her doctor asked for 2000mg a day', set_at: '2026-09-01' },
  } as const;

  it('stands in for the published figure, and says it did', () => {
    const t = find(resolveMicronutrientTargets({ sex: 'female', age: 30 }, doctorSaid2000), 'vitamin_c_mg');

    expect(t.amount).toBe(2000);
    expect(t.origin).toBe('override');
    expect(t.set_because).toBe('her doctor asked for 2000mg a day');
  });

  it('leaves every other nutrient on the reference table', () => {
    const all = resolveMicronutrientTargets({ sex: 'female', age: 30 }, doctorSaid2000);

    expect(find(all, 'iron_mg').amount).toBe(18);
    expect(find(all, 'iron_mg').origin).toBe('reference');
    expect(all.filter((t) => t.origin === 'override')).toHaveLength(1);
  });

  it('accepts the upper limit exactly and refuses a step past it', () => {
    // 2,000mg IS the published safe upper limit for vitamin C, so the owner's own example must
    // land — a bound that rejected it would be the wrong bound.
    expect(sanitizeMicroTargetAmount('vitamin_c_mg', 2000)).toBe(2000);
    expect(sanitizeMicroTargetAmount('vitamin_c_mg', 2001)).toBeNull();
    expect(sanitizeMicroTargetAmount('iron_mg', 45)).toBe(45);
    expect(sanitizeMicroTargetAmount('iron_mg', 46)).toBeNull();
  });

  it('refuses rather than clamps, so a dose nobody chose can never look deliberate', () => {
    expect(sanitizeMicroTargetAmount('zinc_mg', 400)).toBeNull();
    expect(sanitizeMicroTargetAmount('zinc_mg', 0)).toBeNull();
    expect(sanitizeMicroTargetAmount('iron_mg', Number.NaN)).toBeNull();
    expect(sanitizeMicroTargetAmount('vitamin_c_mg', 'lots' as unknown as number)).toBeNull();
  });

  it('keeps B12 to a decimal place — its whole reference intake is 2.4µg', () => {
    expect(sanitizeMicroTargetAmount('vitamin_b12_ug', 2.44)).toBe(2.4);
    expect(sanitizeMicroTargetAmount('calcium_mg', 1204.6)).toBe(1205);
  });

  it('drops a stored override that falls outside the window instead of honouring it', () => {
    // Re-checked on the way OUT, not trusted because it was stored: a blob written by a path that
    // skipped the tool, or under looser bounds, falls back to the published figure.
    const t = find(
      resolveMicronutrientTargets(
        { sex: 'male', age: 40 },
        { iron_mg: { amount: 900, why: 'written by something that never checked', set_at: '2026-01-01' } },
      ),
      'iron_mg',
    );

    expect(t.amount).toBe(8);
    expect(t.origin).toBe('reference');
  });

  it('covers exactly the keys the table publishes', () => {
    expect([...MICRONUTRIENT_KEYS].sort()).toEqual(
      [
        'calcium_mg',
        'fiber_g',
        'iron_mg',
        'potassium_mg',
        'sodium_mg',
        'vitamin_b12_ug',
        'vitamin_c_mg',
        'zinc_mg',
      ].sort(),
    );
    for (const key of MICRONUTRIENT_KEYS) expect(microTargetRange(key)).not.toBeNull();
  });
});
