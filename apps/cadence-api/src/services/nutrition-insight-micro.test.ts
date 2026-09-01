import { describe, expect, it } from 'vitest';
import { resolveMicronutrientTargets, type Food, type FoodNutrients, type FoodSource } from '@cadence/shared';
import { MICRO_TRUSTED_SOURCE, buildMicroInsightRollup, microInsights } from './nutrition-insight-micro.ts';

function foodFrom(source: FoodSource, id: string, nutrients: FoodNutrients): Food {
  return {
    food_id: id,
    owner_user_id: null,
    visibility: 'shared',
    name: `Food ${id}`,
    brand: null,
    source,
    off_id: null,
    fdc_id: source === 'usda' ? 1 : null,
    base_unit: 'g',
    // per 100g; default serving 100g → factor 1 at qty 1
    macros_per_base: { kcal: 100, protein_g: 5, ...nutrients },
    servings: [{ label: '100 g', unit: 'g', amount_g: 100 }],
    default_serving: 0,
    confidence: 1,
    photo_ref: null,
  };
}

function usdaFood(id: string, zinc: number, iron: number): Food {
  return foodFrom('usda', id, { zinc_mg: zinc, iron_mg: iron });
}

/** Four days of one-item logs, ids a–d, all confirmed. */
function fourDays(): Array<{ provisional: boolean; items: Array<{ name: string; food_id: string; qty: number }> }> {
  return ['a', 'b', 'c', 'd'].map((id) => ({
    provisional: false,
    items: [{ name: id, food_id: id, qty: 1 }],
  }));
}

/** Four identical foods keyed a–d, so a rollup clears MIN_LINKED_ITEMS with room to spare. */
function fourOf(build: (id: string) => Food): Map<string, Food> {
  return new Map(['a', 'b', 'c', 'd'].map((id) => [id, build(id)]));
}

const MALE_40 = resolveMicronutrientTargets({ sex: 'male', age: 40 });

describe('microInsights (Req 5 Phase 3)', () => {
  it('stays silent when coverage is thin', () => {
    const foods = new Map([['a', usdaFood('a', 1, 1)]]);
    const rollup = buildMicroInsightRollup(
      [{ provisional: false, items: [{ name: 'a', food_id: 'a', qty: 1 }] }],
      foods,
      1,
    );
    expect(microInsights(rollup, MALE_40)).toEqual([]);
  });

  it('ignores LLM-sourced micros even when numbers look high', () => {
    const foods = fourOf((id) => foodFrom('llm', id, { zinc_mg: 50, iron_mg: 50 }));
    const rollup = buildMicroInsightRollup(fourDays(), foods, 4);

    expect(rollup.nutrients.zinc_mg).toBeUndefined();
    expect(microInsights(rollup, MALE_40)).toEqual([]);
  });

  it('surfaces zinc when real-data coverage is solid and average is low', () => {
    // 2mg zinc/day across 4 days — under 70% of a 40-year-old man's 11mg intake.
    const rollup = buildMicroInsightRollup(
      fourDays(),
      fourOf((id) => usdaFood(id, 2, 12)),
      4,
    );
    const insights = microInsights(rollup, MALE_40);

    expect(insights.some((i) => /zinc/i.test(i.body))).toBe(true);
    expect(insights.some((i) => /pumpkin seeds|chickpeas/i.test(i.body))).toBe(true);
    // Iron averages 12mg/day — above his 8mg intake, let alone 70% of it.
    expect(insights.some((i) => /iron/i.test(i.body))).toBe(false);
  });

  it('surfaces iron when average is low with enough USDA coverage', () => {
    const rollup = buildMicroInsightRollup(
      fourDays(),
      fourOf((id) => usdaFood(id, 12, 2)),
      4,
    );
    const insights = microInsights(rollup, MALE_40);

    expect(insights.some((i) => /iron/i.test(i.body))).toBe(true);
    expect(insights.some((i) => /spinach|lentils/i.test(i.body))).toBe(true);
  });

  it('says nothing at all when the caller could not resolve any intakes', () => {
    const rollup = buildMicroInsightRollup(
      fourDays(),
      fourOf((id) => usdaFood(id, 1, 1)),
      4,
    );

    expect(microInsights(rollup, [])).toEqual([]);
  });
});

describe('MICRO_TRUSTED_SOURCE — which sources may speak about micros', () => {
  it('pins the ruling for EVERY source, so a new one cannot join by omission', () => {
    // Exhaustive on purpose: an added FoodSource fails typecheck at the Record and fails here
    // too. `cnf` is in because Health Canada's file is a lab panel (99% of live rows carry iron,
    // 96% zinc) and it backs most of the ledger; `research` is out because a web-grounded AI
    // lookup produces a number rather than measuring one.
    expect(MICRO_TRUSTED_SOURCE).toEqual({
      usda: true,
      cnf: true,
      off: true,
      label_photo: true,
      fatsecret: true,
      llm: false,
      chat: false,
      manual: false,
      research: false,
    });
  });

  it('counts cnf micros — without it the zinc line is unreachable in practice', () => {
    const rollup = buildMicroInsightRollup(
      fourDays(),
      fourOf((id) => foodFrom('cnf', id, { zinc_mg: 2 })),
      4,
    );

    expect(rollup.nutrients.zinc_mg?.covered).toBe(4);
    expect(microInsights(rollup, MALE_40).some((i) => /zinc/i.test(i.body))).toBe(true);
  });

  it('ignores research micros — a pinned web lookup is stable, not measured', () => {
    const rollup = buildMicroInsightRollup(
      fourDays(),
      fourOf((id) => foodFrom('research', id, { zinc_mg: 2, iron_mg: 2 })),
      4,
    );

    expect(rollup.linked_items).toBe(4);
    expect(rollup.nutrients.zinc_mg).toBeUndefined();
    expect(microInsights(rollup, MALE_40)).toEqual([]);
  });

  it('gates when trusted foods are a minority of what was logged', () => {
    // One cnf food among four logged items → 25% coverage, under MIN_COVERAGE.
    const foods = new Map<string, Food>([
      ['a', foodFrom('cnf', 'a', { zinc_mg: 1, iron_mg: 1 })],
      ['b', foodFrom('llm', 'b', { zinc_mg: 1, iron_mg: 1 })],
      ['c', foodFrom('chat', 'c', { zinc_mg: 1, iron_mg: 1 })],
      ['d', foodFrom('manual', 'd', { zinc_mg: 1, iron_mg: 1 })],
    ]);
    const rollup = buildMicroInsightRollup(fourDays(), foods, 4);

    expect(rollup.linked_items).toBe(4);
    expect(rollup.nutrients.zinc_mg?.covered).toBe(1);
    expect(microInsights(rollup, MALE_40)).toEqual([]);
  });
});

describe('the floors come from the reference table, not from this file', () => {
  it('speaks to a woman about iron where it stays quiet for a man, on the same food', () => {
    // 10mg iron/day. A 30-year-old woman's reference intake is 18 (70% = 12.6, so short); a
    // 40-year-old man's is 8 (70% = 5.6, so fine). The two hardcoded constants this replaces
    // could not tell them apart — and the Nutrients screen was already saying 18.
    const rollup = buildMicroInsightRollup(
      fourDays(),
      fourOf((id) => usdaFood(id, 12, 10)),
      4,
    );
    const female = microInsights(rollup, resolveMicronutrientTargets({ sex: 'female', age: 30 }));
    const male = microInsights(rollup, MALE_40);

    expect(female.some((i) => /iron/i.test(i.body))).toBe(true);
    expect(male.some((i) => /iron/i.test(i.body))).toBe(false);
  });

  it('speaks below 70% of the intake, not below the intake itself', () => {
    // 9mg zinc/day against a man's 11: short of the intake, but not the clear shortfall this
    // surface exists to notice — a day's micro total is a floor, so "a bit under" is more often
    // under-measured than undernourished.
    const rollup = buildMicroInsightRollup(
      fourDays(),
      fourOf((id) => usdaFood(id, 9, 12)),
      4,
    );

    expect(microInsights(rollup, MALE_40)).toEqual([]);
  });
});

describe("a doctor's number (owner ruling 2026-09-01)", () => {
  const vitaminCFoods = fourOf((id) => foodFrom('cnf', id, { vitamin_c_mg: 50 }));

  it('says nothing about vitamin C on the reference intake alone', () => {
    // 50mg/day is under the published 90, but vitamin C is not one of the two nutrients this
    // surface watches unprompted — the Nutrients screen already lists every shortfall.
    const rollup = buildMicroInsightRollup(fourDays(), vitaminCFoods, 4);

    expect(microInsights(rollup, MALE_40)).toEqual([]);
  });

  it('watches it once they tell her their doctor asked for 2000mg, and names the number', () => {
    const targets = resolveMicronutrientTargets(
      { sex: 'male', age: 40 },
      { vitamin_c_mg: { amount: 2000, why: 'her doctor asked for 2000mg a day', set_at: '2026-09-01' } },
    );
    const rollup = buildMicroInsightRollup(fourDays(), vitaminCFoods, 4);
    const insights = microInsights(rollup, targets);

    expect(insights).toHaveLength(1);
    expect(insights[0]!.body).toMatch(/vitamin c/i);
    expect(insights[0]!.body).toMatch(/2000mg/);
    expect(insights[0]!.body).toMatch(/peppers|citrus|strawberries/i);
  });

  it('never turns a sodium override into a "you look low" line', () => {
    // Sodium is the one ceiling. Running it through the shortfall template would be advice to eat
    // MORE salt, which is why watchedTargets filters on direction rather than on origin alone.
    const targets = resolveMicronutrientTargets(
      { sex: 'male', age: 40 },
      {
        sodium_mg: {
          amount: 1500,
          why: 'blood pressure — his GP asked him to keep it under 1500',
          set_at: '2026-09-01',
        },
      },
    );
    const rollup = buildMicroInsightRollup(
      fourDays(),
      fourOf((id) => foodFrom('cnf', id, { sodium_mg: 200 })),
      4,
    );

    expect(rollup.nutrients.sodium_mg?.covered).toBe(4);
    expect(microInsights(rollup, targets)).toEqual([]);
  });
});
