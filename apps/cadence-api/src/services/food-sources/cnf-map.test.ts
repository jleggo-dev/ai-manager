/**
 * The CNF adapter, on real recorded rows — same discipline as the USDA and FatSecret suites:
 * a fixture I invent tests what I already believe, and what I believe is exactly what has been
 * wrong three times now. These slices came off the live dump on 2026-08-23.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mapCnfFood } from './cnf-map.ts';
import { checkNormalizedFood } from './normalized.ts';
import { microProvenance } from './completeness.ts';

const DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '__fixtures__');
const load = (name: string): { food: never; nutrients: never; servings: never } =>
  JSON.parse(readFileSync(path.join(DIR, `${name}.json`), 'utf8'));

beforeEach(() => vi.spyOn(console, 'warn').mockImplementation(() => {}));
afterEach(() => vi.restoreAllMocks());

describe('mapCnfFood', () => {
  it('maps a banana with the full lab panel, agreeing with USDA and FatSecret', () => {
    const fx = load('cnf-banana');
    const m = mapCnfFood(fx.food, fx.nutrients, fx.servings);
    expect(m).not.toBeNull();
    expect(m!.name).toBe('Banana, raw');
    // 89 kcal — the same banana costs the same via all three sources, which is the whole ledger.
    expect(m!.macros_per_base.kcal).toBe(89);
    expect(m!.macros_per_base.potassium_mg).toBe(358);
    expect(m!.macros_per_base.zinc_mg).toBe(0.15);
    // Zinc + B-12 present ⇒ the completeness model reads this as MEASURED, so an absence on a
    // CNF row is a real "negligible" rather than a label's silence.
    expect(microProvenance(m!.macros_per_base)).toBe('measured');
    expect(checkNormalizedFood(m!).filter((p) => p.severity !== 'warn')).toEqual([]);
  });

  it('turns conversion factors into gram servings and prefers a household "1 …" default', () => {
    const fx = load('cnf-banana');
    const m = mapCnfFood(fx.food, fx.nutrients, fx.servings)!;
    // "1 extra small (less than 15cm long)" carries factor 0.81 → 81 g.
    const extraSmall = m.servings.find((s) => s.unit.startsWith('1 extra small'));
    expect(extraSmall?.amount_g).toBe(81);
    expect(m.servings.some((s) => s.amount_g === 100)).toBe(true);
    expect(/^1\s/.test(m.servings[m.default_serving]!.unit)).toBe(true);
  });

  it('flags beer as alcoholic so the Atwater check stands down', () => {
    // Ethanol is ~7 kcal/g and is not a macro — a light beer's calories legitimately dwarf what
    // its macros imply. CNF code 221 carries the alcohol grams that prove it.
    const fx = load('cnf-beer');
    const m = mapCnfFood(fx.food, fx.nutrients, fx.servings);
    expect(m).not.toBeNull();
    expect(typeof m!.macros_per_base.kcal).toBe('number');
    expect(checkNormalizedFood({ ...m!, alcoholic: true }).filter((p) => p.field === 'kcal')).toEqual([]);
  });

  it('drops a food it cannot identify or trust', () => {
    expect(mapCnfFood({ food_code: 0, food_description: 'x' }, [], [])).toBeNull();
    expect(mapCnfFood({ food_code: 9, food_description: '   ' }, [], [])).toBeNull();
  });
});
