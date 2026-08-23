/**
 * The contract every food source owes the ledger — and the three real bugs it retro-catches.
 *
 * Each of those bugs was silent, and each looked exactly like "that food isn't in this source",
 * which is a normal answer. That is why the checks here are deliberately source-AGNOSTIC: they
 * know nothing about USDA's nutrient numbering or FatSecret's JSON, so they keep working when the
 * next source arrives with its own private way of being wrong.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  applyNormalization,
  atwaterKcal,
  checkNormalizedFood,
  looksAlcoholic,
  type NormalizedFood,
} from './normalized.ts';

const food = (over: Partial<NormalizedFood> = {}): NormalizedFood => ({
  name: 'peanuts, raw',
  brand: null,
  base_unit: 'g',
  macros_per_base: { kcal: 588, protein_g: 23.2, carbs_g: 26.5, fat_g: 43.3 },
  servings: [{ label: '1 oz (28g)', unit: 'g', amount_g: 28 }],
  default_serving: 0,
  ...over,
});

beforeEach(() => vi.spyOn(console, 'warn').mockImplementation(() => {}));
afterEach(() => vi.restoreAllMocks());

describe('a well-formed food', () => {
  it('passes clean', () => {
    expect(checkNormalizedFood(food())).toEqual([]);
    expect(applyNormalization('test', food())).not.toBeNull();
  });
});

describe('the energy cross-check', () => {
  it('catches macros with no calories — the Foundation/Atwater bug, without knowing about USDA', () => {
    // Foundation reports energy only as nutrient 957/958, so "Peanuts, raw" imported at 0 kcal
    // and contributed nothing to the day. Nothing threw. This is what would have said so.
    const macros = { protein_g: 23.2, carbs_g: 26.5, fat_g: 43.3 };
    const problems = checkNormalizedFood(food({ macros_per_base: macros }));
    expect(problems).toEqual([expect.objectContaining({ field: 'kcal', detail: expect.stringContaining('589') })]);
  });

  it('catches calories that disagree with their own macros by an order of magnitude', () => {
    const macros = { kcal: 58, protein_g: 23.2, carbs_g: 26.5, fat_g: 43.3 };
    expect(checkNormalizedFood(food({ macros_per_base: macros }))).toEqual([
      expect.objectContaining({ field: 'kcal', severity: 'warn' }),
    ]);
  });

  it('stays quiet about fibre, rounding and the other honest disagreements', () => {
    // Real USDA rows that legitimately sit off Atwater — the widest of 15 sampled foods. Bran
    // muffin mix (7.6%) and almonds (6.7%) are correct; a guard that flags them gets ignored.
    for (const macros of [
      { kcal: 396, protein_g: 8.5, carbs_g: 68.7, fat_g: 9.9 },
      { kcal: 579, protein_g: 21.2, carbs_g: 21.6, fat_g: 49.9 },
      { kcal: 884, protein_g: 0, carbs_g: 0, fat_g: 100 },
    ]) {
      expect(checkNormalizedFood(food({ macros_per_base: macros }))).toEqual([]);
    }
  });

  it('says nothing when it does not actually know', () => {
    // One macro implies a meaningless total; accusing a correct kcal of being wrong is worse
    // than staying silent. All three or nothing.
    expect(atwaterKcal({ protein_g: 1.09 })).toBeNull();
    expect(checkNormalizedFood(food({ macros_per_base: { kcal: 89, protein_g: 1.09 } }))).toEqual([]);
  });

  it('ignores near-zero foods, where a few calories is the whole ratio', () => {
    // Raw spinach really does state 23 kcal against 30 implied — 22%, and seven calories on a leaf.
    expect(
      checkNormalizedFood(food({ macros_per_base: { kcal: 23, protein_g: 2.9, carbs_g: 3.6, fat_g: 0.4 } })),
    ).toEqual([]);
  });
});

describe('alcohol, for sources that do not publish it', () => {
  it('stands the energy check down for a drink named as one', () => {
    // FatSecret publishes NO alcohol figure — a Red Table Wine row has calories, carbohydrate,
    // protein, fat and calcium, full stop. So its 85 kcal against ~11 implied would be flagged
    // forever with no way to answer, and a guard that cries wolf on every glass of wine stops
    // being read.
    const wine = food({
      name: 'Red Table Wine',
      macros_per_base: { kcal: 85, protein_g: 0.1, carbs_g: 2.7, fat_g: 0 },
    });
    expect(checkNormalizedFood(wine)).toEqual([]);
    const vodka = food({ name: 'Vodka', macros_per_base: { kcal: 231, protein_g: 0, carbs_g: 0, fat_g: 0 } });
    expect(checkNormalizedFood(vodka)).toEqual([]);
  });

  it('matches whole words only', () => {
    expect(looksAlcoholic('Red Table Wine')).toBe(true);
    expect(looksAlcoholic('Whiskey Sour')).toBe(true);
    expect(looksAlcoholic('Ginger snaps')).toBe(false);
    expect(looksAlcoholic('Sparkling water')).toBe(false);
  });

  it('still DROPS impossible numbers on a drink — only the warning is suppressed', () => {
    // The asymmetry that makes a name-based guess safe: a false positive costs a warning, never
    // a number. The checks that actually discard data run regardless of what a thing is called.
    const bad = food({ name: 'Red Table Wine', macros_per_base: { kcal: 85, protein_g: 0, carbs_g: 262, fat_g: 0 } });
    expect(checkNormalizedFood(bad)).toEqual(
      expect.arrayContaining([expect.objectContaining({ field: 'carbs_g', severity: 'drop' })]),
    );
  });
});

describe('impossible numbers', () => {
  it('condemns the WHOLE record when a value cannot fit in 100 g of anything', () => {
    // USDA really publishes a Starbucks K-Cup at 262.5 g carbs / 50 g protein / 875 mg sodium per
    // 100 g — per-package values filed as per-100g. Keeping the fields that happen to fall under
    // the limit would leave numbers that are equally wrong and now look fine, and pin them.
    const bad = food({ macros_per_base: { protein_g: 50, carbs_g: 262.5, fat_g: 12, sodium_mg: 875 } });
    expect(checkNormalizedFood(bad)).toEqual(
      expect.arrayContaining([expect.objectContaining({ field: 'carbs_g', severity: 'drop' })]),
    );
    expect(applyNormalization('usda', bad)).toBeNull();
  });

  it('condemns the record for a negative too, and drops just the field for a non-number', () => {
    expect(applyNormalization('t', food({ macros_per_base: { protein_g: -3, carbs_g: 1, fat_g: 1 } }))).toBeNull();
    const out = applyNormalization('t', food({ macros_per_base: { kcal: 100, protein_g: Number.NaN } as never }));
    expect(out).not.toBeNull();
    expect(out!.macros_per_base.protein_g).toBeUndefined();
  });

  it('allows 900 kcal, which is not a gram measurement', () => {
    // Pure fat is ~900 kcal/100 g. The >100 rule must never touch energy.
    expect(checkNormalizedFood(food({ macros_per_base: { kcal: 884, protein_g: 0, carbs_g: 0, fat_g: 100 } }))).toEqual(
      [],
    );
  });
});

describe('servings', () => {
  it('rejects a default that points outside the list', () => {
    // An out-of-range default preselects the WRONG portion, and the user logs a number they
    // never chose — the exact class of error the confirm step exists to stop.
    const problems = checkNormalizedFood(food({ default_serving: 3 }));
    expect(problems.map((p) => p.field)).toContain('default_serving');
  });

  it('rejects a zero or negative serving amount', () => {
    const problems = checkNormalizedFood(food({ servings: [{ label: '1 pack', unit: 'g', amount_g: 0 }] }));
    expect(problems.map((p) => p.field)).toContain('servings[0]');
  });
});

describe('applyNormalization', () => {
  it('drops the untrustworthy field and keeps the food', () => {
    // Losing one nutrient is a gap. Keeping a wrong one is a lie that gets PINNED and reused
    // forever, so it is never the safer option.
    const out = applyNormalization(
      'test',
      food({
        macros_per_base: { kcal: 588, protein_g: 23.2, carbs_g: 26.5, fat_g: 43.3, sodium_mg: Number.NaN } as never,
      }),
    );
    expect(out).not.toBeNull();
    expect(out!.macros_per_base.sodium_mg).toBeUndefined();
    expect(out!.macros_per_base.kcal).toBe(588);
  });

  it('fills in energy the source never published, the way a label would', () => {
    // USDA's own OREO COOKIES row carries seven nutrients and no energy. Zero is not the
    // conservative answer — it is a confident wrong one that gets pinned and repeats.
    const out = applyNormalization('usda', food({ macros_per_base: { protein_g: 5, carbs_g: 71, fat_g: 20 } }));
    expect(out!.macros_per_base.kcal).toBe(484);
  });

  it('keeps an energy it disagrees with, and says so instead of overruling the source', () => {
    // We do not know WHICH number is wrong — the macros could be the misread half. Substituting
    // our own arithmetic would also mask the mapping bug by making the result look plausible.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const out = applyNormalization(
      'usda',
      food({ macros_per_base: { kcal: 100, protein_g: 5, carbs_g: 71, fat_g: 20 } }),
    );
    expect(out!.macros_per_base.kcal).toBe(100);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('disagrees'));
  });

  it('leaves a drink alone — ethanol is not a macro', () => {
    const out = applyNormalization(
      'usda',
      food({ alcoholic: true, macros_per_base: { protein_g: 0, carbs_g: 0, fat_g: 0 } }),
    );
    expect(out!.macros_per_base.kcal).toBeUndefined();
  });

  it('discards a food that cannot be identified again', () => {
    expect(applyNormalization('test', food({ name: '   ' }))).toBeNull();
  });

  it('says out loud what it dropped — a silent guard is the bug it is preventing', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    applyNormalization('usda', food({ default_serving: 9 }));
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('[usda]'));
  });
});
