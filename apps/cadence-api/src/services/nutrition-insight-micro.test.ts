import { describe, expect, it } from 'vitest';
import type { Food } from '@cadence/shared';
import { buildMicroInsightRollup, microInsights } from './nutrition-insight-micro.ts';

function usdaFood(id: string, zinc: number, iron: number): Food {
  return {
    food_id: id,
    owner_user_id: null,
    visibility: 'shared',
    name: `Food ${id}`,
    brand: null,
    source: 'usda',
    off_id: null,
    fdc_id: 1,
    base_unit: 'g',
    // per 100g; default serving 100g → factor 1 at qty 1
    macros_per_base: { kcal: 100, protein_g: 5, zinc_mg: zinc, iron_mg: iron },
    servings: [{ label: '100 g', unit: 'g', amount_g: 100 }],
    default_serving: 0,
    confidence: 1,
    photo_ref: null,
  };
}

function llmFood(id: string): Food {
  return {
    ...usdaFood(id, 20, 20),
    source: 'llm',
    fdc_id: null,
    macros_per_base: { kcal: 200, protein_g: 10, zinc_mg: 50, iron_mg: 50 },
  };
}

describe('microInsights (Req 5 Phase 3)', () => {
  it('stays silent when coverage is thin', () => {
    const foods = new Map([['a', usdaFood('a', 1, 1)]]);
    const rollup = buildMicroInsightRollup(
      [{ provisional: false, items: [{ name: 'a', food_id: 'a', qty: 1 }] }],
      foods,
      1,
    );
    expect(microInsights(rollup)).toEqual([]);
  });

  it('ignores LLM-sourced micros even when numbers look high', () => {
    const foods = new Map([
      ['a', llmFood('a')],
      ['b', llmFood('b')],
      ['c', llmFood('c')],
    ]);
    const recent = [
      { provisional: false, items: [{ name: 'a', food_id: 'a', qty: 1 }] },
      { provisional: false, items: [{ name: 'b', food_id: 'b', qty: 1 }] },
      { provisional: false, items: [{ name: 'c', food_id: 'c', qty: 1 }] },
    ];
    const rollup = buildMicroInsightRollup(recent, foods, 4);
    expect(rollup.zinc.covered).toBe(0);
    expect(microInsights(rollup)).toEqual([]);
  });

  it('surfaces zinc when real-data coverage is solid and average is low', () => {
    // ~2mg zinc/day across 4 days of logging → below 7mg floor
    const foods = new Map([
      ['a', usdaFood('a', 2, 12)],
      ['b', usdaFood('b', 2, 12)],
      ['c', usdaFood('c', 2, 12)],
      ['d', usdaFood('d', 2, 12)],
    ]);
    const recent = [
      { provisional: false, items: [{ name: 'a', food_id: 'a', qty: 1 }] },
      { provisional: false, items: [{ name: 'b', food_id: 'b', qty: 1 }] },
      { provisional: false, items: [{ name: 'c', food_id: 'c', qty: 1 }] },
      { provisional: false, items: [{ name: 'd', food_id: 'd', qty: 1 }] },
    ];
    const rollup = buildMicroInsightRollup(recent, foods, 4);
    const insights = microInsights(rollup);
    expect(insights.some((i) => /zinc/i.test(i.body))).toBe(true);
    expect(insights.some((i) => /pumpkin seeds|chickpeas/i.test(i.body))).toBe(true);
    // Iron averages 12mg/day — above floor, no iron insight
    expect(insights.some((i) => /iron/i.test(i.body))).toBe(false);
  });

  it('surfaces iron when average is low with enough USDA coverage', () => {
    const foods = new Map([
      ['a', usdaFood('a', 12, 2)],
      ['b', usdaFood('b', 12, 2)],
      ['c', usdaFood('c', 12, 2)],
      ['d', usdaFood('d', 12, 2)],
    ]);
    const recent = [
      { provisional: false, items: [{ name: 'a', food_id: 'a', qty: 1 }] },
      { provisional: false, items: [{ name: 'b', food_id: 'b', qty: 1 }] },
      { provisional: false, items: [{ name: 'c', food_id: 'c', qty: 1 }] },
      { provisional: false, items: [{ name: 'd', food_id: 'd', qty: 1 }] },
    ];
    const insights = microInsights(buildMicroInsightRollup(recent, foods, 4));
    expect(insights.some((i) => /iron/i.test(i.body))).toBe(true);
    expect(insights.some((i) => /spinach|lentils/i.test(i.body))).toBe(true);
  });
});
