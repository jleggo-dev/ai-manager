/**
 * The Nutrients view model exists to keep three promises, and each of them is a way of being wrong
 * that would matter: a ceiling must never be dressed as a goal, a met floor must earn silence
 * rather than a tick, and missing data must never be reported as a shortfall.
 */
import { describe, expect, it } from 'vitest';
import type { Meal } from '../../lib/api.ts';
import { buildNutrientsView, countMeasured, countedLine, hasMicros } from './nutrients.ts';

const meal = (over: Partial<Meal>): Meal =>
  ({ log_id: 'm', date: '2026-08-20', meal: 'lunch', items: [], ...over }) as Meal;

/** A day with real mineral data behind it — iron short, sodium under, the rest comfortable. */
const RICH = {
  kcal: 1900,
  iron_mg: 6,
  zinc_mg: 14,
  vitamin_c_mg: 120,
  calcium_mg: 1300,
  potassium_mg: 3600,
  vitamin_b12_ug: 3,
  fiber_g: 40,
  sodium_mg: 1400,
};

describe('buildNutrientsView', () => {
  it('keeps sodium as the one ceiling and never lets it into the floors', () => {
    const v = buildNutrientsView(RICH, [meal({ macros: RICH })]);
    expect(v.ceiling?.key).toBe('sodium_mg');
    expect(v.ceiling?.direction).toBe('ceiling');
    expect([...v.aiming, ...v.also].some((r) => r.key === 'sodium_mg')).toBe(false);
    expect([...v.aiming, ...v.also].every((r) => r.direction === 'floor')).toBe(true);
  });

  it('features only floors that are actually short — a met one is silence, not a tick', () => {
    const v = buildNutrientsView(RICH, [meal({ macros: RICH })]);
    expect(v.aiming.map((r) => r.key)).toEqual(['iron_mg']);
    expect(v.also.map((r) => r.key)).toContain('zinc_mg'); // met, present, unremarked
  });

  it('says nothing at all when every floor is met', () => {
    const plenty = { ...RICH, iron_mg: 40 };
    expect(buildNutrientsView(plenty, [meal({ macros: plenty })]).aiming).toEqual([]);
  });

  it('shows at most three, shortest first', () => {
    const thin = { kcal: 900, iron_mg: 1, calcium_mg: 100, fiber_g: 2, zinc_mg: 1, vitamin_c_mg: 80 };
    const v = buildNutrientsView(thin, [meal({ macros: thin })]);
    expect(v.aiming).toHaveLength(3);
    expect(v.aiming.map((r) => r.pct)).toEqual([...v.aiming.map((r) => r.pct)].sort((a, b) => a - b));
  });

  /** The trap the whole screen is built to avoid: a hand-typed lunch is not seven deficiencies. */
  it('invents no shortfall when nothing logged carried mineral data', () => {
    const v = buildNutrientsView({ kcal: 800, protein_g: 40 }, [
      meal({ macros: { kcal: 800 }, items: [{ name: 'x' }] }),
    ]);
    expect(v.unmeasured).toBe(true);
    expect(v.aiming).toEqual([]);
    expect(countedLine(v)).toContain('counted its calories, not its minerals');
  });

  it('reads milligram intakes in the thousands as grams, the way a person would say them', () => {
    const v = buildNutrientsView(RICH, [meal({ macros: RICH })]);
    const potassium = v.also.find((r) => r.key === 'potassium_mg');
    expect(potassium?.unit).toBe('g');
    expect(potassium?.targetText).toBe('3.4');
    expect(v.ceiling?.unit).toBe('mg'); // sodium stays in mg — 2,300 is how the label says it
    expect(v.ceiling?.targetText).toBe('2,300');
  });

  it('states a breached ceiling as a fact rather than suppressing it', () => {
    const salty = { ...RICH, sodium_mg: 3000 };
    const v = buildNutrientsView(salty, [meal({ macros: salty })]);
    expect(v.ceiling?.over).toBe(true);
    expect(v.ceiling?.eatenText).toBe('3,000');
  });
});

describe('countMeasured', () => {
  it('counts per item when items carry their own minerals', () => {
    const m = meal({
      macros: { kcal: 400, iron_mg: 3 },
      items: [
        { name: 'lentils', est: { kcal: 200, iron_mg: 3 } },
        { name: 'a roll', est: { kcal: 200 } },
      ],
    });
    expect(countMeasured([m])).toEqual({ measured: 1, total: 2 });
  });

  it('credits meal-level minerals across the meal rather than reporting zero coverage', () => {
    const m = meal({ macros: { kcal: 400, iron_mg: 3 }, items: [{ name: 'a' }, { name: 'b' }] });
    expect(countMeasured([m])).toEqual({ measured: 2, total: 2 });
  });

  it('leaves provisional meals out of both sides, exactly as the day totals do', () => {
    const confirmed = meal({ macros: { kcal: 400, iron_mg: 3 }, items: [{ name: 'a' }] });
    const pending = meal({ log_id: 'p', provisional: true, macros: { kcal: 900 }, items: [{ name: 'b' }] });
    expect(countMeasured([confirmed, pending])).toEqual({ measured: 1, total: 1 });
  });

  it('treats a meal with no item breakdown as one item', () => {
    expect(countMeasured([meal({ macros: { kcal: 300 }, items: [] })])).toEqual({ measured: 0, total: 1 });
  });
});

describe('countedLine', () => {
  it('has nothing to apologise for on an empty day', () => {
    const v = buildNutrientsView({}, []);
    expect(countedLine(v)).toBe('Nothing logged yet, so there is nothing to count from.');
  });

  it('frames partial coverage as reading low rather than as the user falling short', () => {
    const totals = { iron_mg: 4 };
    const meals = [meal({ macros: totals, items: [{ name: 'a', est: { iron_mg: 4 } }, { name: 'b' }] })];
    const line = countedLine(buildNutrientsView(totals, meals));
    expect(line).toContain('Counted from 1 of your 2 items');
    expect(line).toContain('read low rather than wrong');
  });
});

describe('hasMicros', () => {
  it('is false for macros alone and true for anything mineral', () => {
    expect(hasMicros({ kcal: 500, protein_g: 30 })).toBe(false);
    expect(hasMicros({ kcal: 500, iron_mg: 2 })).toBe(true);
    expect(hasMicros(undefined)).toBe(false);
  });
});
