/**
 * The Leftovers shelf is a deterministic read over brackets — the wrong number is a quiet
 * number, so every rule gets a row: the window, the batch, the portions that come off it, the
 * draft as a source, and the zero that drops it.
 */
import { describe, expect, it } from 'vitest';
import type { Recipe } from '@cadence/shared';
import { daysBetween, deriveLeftovers, leftoverLine, type LeftoverSource } from './leftovers.ts';

const TODAY = '2026-10-28';

const recipe = (id: string, name: string, kcal = 380): Recipe => ({
  recipe_id: id,
  name,
  source: 'user',
  servings: 4,
  ingredients: [],
  steps: [],
  macros_per_serving: { kcal },
  tags: [],
  saved: true,
});

const meal = (
  log_id: string,
  date: string,
  parts: Array<{ recipe_id: string; yield?: number; logged?: number; name?: string | null }>,
): LeftoverSource => ({
  log_id,
  date,
  parts: parts.map((p, i) => ({
    key: `${log_id}-${i}`,
    name: p.name ?? null,
    recipe_id: p.recipe_id,
    yield_servings: p.yield ?? 1,
    servings_logged: p.logged ?? 1,
  })),
});

describe('daysBetween', () => {
  it.each([
    ['2026-10-28', '2026-10-28', 0],
    ['2026-10-24', '2026-10-28', 4],
    ['2026-10-23', '2026-10-28', 5],
    ['2026-10-29', '2026-10-28', -1],
    ['2026-09-30', '2026-10-01', 1],
  ])('%s → %s is %i days', (from, to, days) => {
    expect(daysBetween(from, to)).toBe(days);
  });
});

describe('deriveLeftovers', () => {
  const stew = recipe('r-stew', 'Lentil stew');

  it('a batch cooked in multiples shows the portions nobody has logged', () => {
    const out = deriveLeftovers(
      [meal('m1', '2026-10-26', [{ recipe_id: 'r-stew', yield: 4, logged: 1 }])],
      [stew],
      TODAY,
    );
    expect(out).toEqual([
      { recipe_id: 'r-stew', name: 'Lentil stew', yield: 4, left: 3, cookedOn: '2026-10-26', kcal: 380 },
    ]);
  });

  it('every portion logged on or after the cook comes off the batch', () => {
    const out = deriveLeftovers(
      [
        meal('m1', '2026-10-26', [{ recipe_id: 'r-stew', yield: 4, logged: 1 }]),
        meal('m2', '2026-10-27', [{ recipe_id: 'r-stew', yield: 4, logged: 2 }]),
      ],
      [stew],
      TODAY,
    );
    expect(out[0]?.left).toBe(1);
  });

  it('is gone at zero', () => {
    const out = deriveLeftovers(
      [
        meal('m1', '2026-10-26', [{ recipe_id: 'r-stew', yield: 2, logged: 1 }]),
        meal('m2', '2026-10-27', [{ recipe_id: 'r-stew', logged: 1 }]),
      ],
      [stew],
      TODAY,
    );
    expect(out).toEqual([]);
  });

  it('ages out after four days — a five-day-old batch is not a leftover', () => {
    const four = deriveLeftovers([meal('m1', '2026-10-24', [{ recipe_id: 'r-stew', yield: 4 }])], [stew], TODAY);
    const five = deriveLeftovers([meal('m1', '2026-10-23', [{ recipe_id: 'r-stew', yield: 4 }])], [stew], TODAY);
    expect(four).toHaveLength(1);
    expect(five).toEqual([]);
  });

  it('a one-portion recipe is never a leftover, however often it is logged', () => {
    const out = deriveLeftovers([meal('m1', '2026-10-27', [{ recipe_id: 'r-stew', yield: 1 }])], [stew], TODAY);
    expect(out).toEqual([]);
  });

  it('a loose bracket with no recipe is not a leftover', () => {
    const src: LeftoverSource = {
      log_id: 'm1',
      date: '2026-10-27',
      parts: [{ key: 'a', name: null, yield_servings: 4, servings_logged: 1 }],
    };
    expect(deriveLeftovers([src], [stew], TODAY)).toEqual([]);
  });

  it('every bracket carries the yield, so a batch is read off the count: four of four is finished', () => {
    const out = deriveLeftovers(
      [
        meal('m1', '2026-10-25', [{ recipe_id: 'r-stew', yield: 4, logged: 3 }]),
        meal('m2', '2026-10-27', [{ recipe_id: 'r-stew', yield: 4, logged: 1 }]),
      ],
      [stew],
      TODAY,
    );
    expect(out).toEqual([]);
  });

  it('a fifth portion starts a new batch, cooked the day it landed, with three to go', () => {
    const out = deriveLeftovers(
      [
        meal('m1', '2026-10-25', [{ recipe_id: 'r-stew', yield: 4, logged: 3 }]),
        meal('m2', '2026-10-26', [{ recipe_id: 'r-stew', yield: 4, logged: 1 }]),
        meal('m3', '2026-10-27', [{ recipe_id: 'r-stew', yield: 4, logged: 1 }]),
      ],
      [stew],
      TODAY,
    );
    expect(out).toEqual([expect.objectContaining({ cookedOn: '2026-10-27', left: 3 })]);
  });

  it('a batch logged two portions at a time still dates from its first portion', () => {
    const out = deriveLeftovers(
      [
        meal('m1', '2026-10-26', [{ recipe_id: 'r-stew', yield: 4, logged: 2 }]),
        meal('m2', '2026-10-27', [{ recipe_id: 'r-stew', yield: 4, logged: 1 }]),
      ],
      [stew],
      TODAY,
    );
    expect(out).toEqual([expect.objectContaining({ cookedOn: '2026-10-26', left: 1 })]);
  });

  it('the open draft is a source — a portion in the cart already comes off the batch', () => {
    const out = deriveLeftovers(
      [
        meal('m1', '2026-10-26', [{ recipe_id: 'r-stew', yield: 4, logged: 1 }]),
        meal('draft', TODAY, [{ recipe_id: 'r-stew', logged: 1 }]),
      ],
      [stew],
      TODAY,
    );
    expect(out[0]?.left).toBe(2);
  });

  it('falls back to the bracket name when the recipe has left the cookbook', () => {
    const out = deriveLeftovers(
      [meal('m1', '2026-10-27', [{ recipe_id: 'r-gone', yield: 3, name: 'Chili' }])],
      [],
      TODAY,
    );
    expect(out[0]).toMatchObject({ name: 'Chili', kcal: null, left: 2 });
  });

  it('newest batch first', () => {
    const out = deriveLeftovers(
      [
        meal('m1', '2026-10-25', [{ recipe_id: 'r-a', yield: 3 }]),
        meal('m2', '2026-10-27', [{ recipe_id: 'r-b', yield: 3 }]),
      ],
      [recipe('r-a', 'A'), recipe('r-b', 'B')],
      TODAY,
    );
    expect(out.map((l) => l.name)).toEqual(['B', 'A']);
  });
});

describe('leftoverLine', () => {
  it('names the day, or "today"', () => {
    const base = { recipe_id: 'r', name: 'Stew', yield: 4, left: 2, kcal: null };
    expect(leftoverLine({ ...base, cookedOn: '2026-10-26' }, TODAY)).toBe('2 of 4 left · Mon');
    expect(leftoverLine({ ...base, cookedOn: TODAY }, TODAY)).toBe('2 of 4 left · today');
  });
});
