import { describe, expect, it } from 'vitest';
import { microStatus, micronutrientTargets, MICRONUTRIENT_KEYS } from './micronutrient-targets.ts';

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
