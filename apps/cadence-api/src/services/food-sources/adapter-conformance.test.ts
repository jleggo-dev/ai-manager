/**
 * Both adapters, replayed against REAL recorded API responses.
 *
 * The user's objection is the reason this file exists, and it is unanswerable: *"it will be almost
 * impossible for a user to detect an issue with them during usage — how would they validate?"* They
 * cannot. Nobody weighs their lunch against a lab, and the app states every number with the same
 * confidence whether it came from a measurement, a mis-read field, or nothing at all. So the
 * validation has to live here.
 *
 * These payloads came off the wire (`scripts/capture-food-fixtures.ts`), not out of my head. That
 * distinction is the whole point: every bug this stack has had was invisible precisely because the
 * hand-written fixtures agreed with the code's assumptions. A fixture I invent tests what I already
 * believe. The three cases below are exactly the ones where what I believed was wrong —
 *
 *   · Foundation publishes NO "Energy" row, only Atwater factors under ids 2047/2048
 *   · Branded uses the legacy nutrient NUMBERS (203/204/205/208), not the modern ids
 *   · both write serving units uppercase ('GRM'/'MLT') where everything else is lowercase
 *
 * — and each one silently produced a food worth nothing at all.
 *
 * Re-capture with `npx tsx scripts/capture-food-fixtures.ts` when a provider changes shape. For
 * whether they have changed shape, `scripts/smoke-food-sources.ts` asks them live.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mapUsdaFoodDetail } from './usda-map.ts';
import { mapFatSecretFood } from './fatsecret-map.ts';
import { checkNormalizedFood, type NormalizedFood } from './normalized.ts';

const DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '__fixtures__');
const load = (name: string): { search: unknown; detail: unknown } =>
  JSON.parse(readFileSync(path.join(DIR, `${name}.json`), 'utf8'));

/** Everything an adapter's output must satisfy, whichever source produced it. */
function expectConforms(food: NormalizedFood | null): asserts food is NormalizedFood {
  expect(food).not.toBeNull();
  expect(food!.name.trim()).not.toBe('');
  expect(['g', 'ml', 'item']).toContain(food!.base_unit);
  expect(food!.servings.length).toBeGreaterThan(0);
  expect(food!.default_serving).toBeGreaterThanOrEqual(0);
  expect(food!.default_serving).toBeLessThan(food!.servings.length);
  for (const s of food!.servings) {
    expect(s.amount_g).toBeGreaterThan(0);
    expect(s.label.trim()).not.toBe('');
  }
  // Every food that reaches the ledger must be able to answer "how many calories?" — the question
  // the entire app is built to ask. A food worth nothing silently deflates the whole day.
  expect(typeof food!.macros_per_base.kcal).toBe('number');
  expect(checkNormalizedFood(food!).filter((p) => p.severity !== 'warn')).toEqual([]);
}

describe('USDA adapter, on real payloads', () => {
  it('Foundation: reads energy from the Atwater factors, the only place it is published', () => {
    const mapped = mapUsdaFoodDetail(load('usda-foundation-atwater').detail);
    expectConforms(mapped);
    expect(mapped.name).toMatch(/peanut/i);
    // 588 general / 551 specific. General, because that is what a nutrition label states — and
    // this ledger's promise is that the same food costs the same across all three sources.
    expect(mapped.macros_per_base.kcal).toBeCloseTo(588, 0);
    expect(mapped.macros_per_base.protein_g).toBeGreaterThan(20);
  });

  it('Branded: reads the legacy nutrient numbers, and the label serving', () => {
    const mapped = mapUsdaFoodDetail(load('usda-branded-legacy').detail);
    expectConforms(mapped);
    expect(mapped.brand).toBeTruthy();
    expect(mapped.macros_per_base.kcal).toBeGreaterThan(400);
    expect(mapped.macros_per_base.sodium_mg).toBeGreaterThan(0);
    // The portion on the packet, not just the 100 g we invent for every food.
    expect(mapped.servings.some((s) => s.amount_g !== 100)).toBe(true);
  });

  it('SR Legacy: carries the micronutrients, which is the dataset’s whole advantage', () => {
    const mapped = mapUsdaFoodDetail(load('usda-sr-legacy-full').detail);
    expectConforms(mapped);
    const micros = ['sodium_mg', 'iron_mg', 'zinc_mg', 'calcium_mg', 'potassium_mg'] as const;
    expect(micros.filter((k) => typeof mapped.macros_per_base[k] === 'number').length).toBeGreaterThanOrEqual(4);
  });

  it('agrees with itself across datasets for the same food', () => {
    // Raw peanuts from Foundation against dry-roast peanuts from Branded. Different datasets,
    // different numbering, different decade — the same food, so within 20%. A mapping bug in
    // either one shows up here as a gap no amount of per-dataset testing would reveal.
    const foundation = mapUsdaFoodDetail(load('usda-foundation-atwater').detail)!;
    const branded = mapUsdaFoodDetail(load('usda-branded-legacy').detail)!;
    const a = foundation.macros_per_base.kcal!;
    const b = branded.macros_per_base.kcal!;
    expect(Math.abs(a - b) / Math.max(a, b)).toBeLessThan(0.2);
  });
});

describe('FatSecret adapter, on real payloads', () => {
  it('maps a branded restaurant item', () => {
    const mapped = mapFatSecretFood(load('fatsecret-branded').detail);
    expectConforms(mapped as never);
    expect(mapped!.brand).toBeTruthy();
  });

  it('maps a generic food', () => {
    const mapped = mapFatSecretFood(load('fatsecret-generic').detail);
    expectConforms(mapped as never);
  });
});

describe('the two sources against each other', () => {
  it('price the same banana within a quarter of each other', () => {
    // The cross-source check the ledger's promise actually rests on: "the same latte costs the
    // same every day" is worth nothing if it costs one thing via USDA and another via FatSecret.
    // Nothing else in the suite would notice one adapter reading a per-serving field as per-100g.
    const fs = mapFatSecretFood(load('fatsecret-generic').detail)!;
    const USDA_BANANA_KCAL_PER_100G = 89;
    const perBase = fs.base_unit === 'item' ? null : fs.macros_per_base.kcal!;
    if (perBase === null) return; // an item-denominated banana is not comparable per 100 g
    expect(Math.abs(perBase - USDA_BANANA_KCAL_PER_100G) / USDA_BANANA_KCAL_PER_100G).toBeLessThan(0.25);
  });
});
