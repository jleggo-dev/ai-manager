/**
 * The Leftovers shelf is a deterministic read over recent meals — the wrong meal is a quiet
 * wrong, so every rule gets a row: the window (both edges, and the user's own), the order, what
 * is not a leftover (open, empty, the draft, a repeat), and how a meal is named.
 */
import { describe, expect, it } from 'vitest';
import type { MealItem, MealKind, MealPart } from '@cadence/shared';
import { daysBetween, deriveLeftovers, leftoverLine, mealName, type LeftoverSource } from './leftovers.ts';

const TODAY = '2026-10-28';

const meal = (
  log_id: string,
  date: string,
  kind: MealKind,
  names: string[],
  extra: Partial<LeftoverSource> = {},
): LeftoverSource => ({
  log_id,
  date,
  meal: kind,
  items: names.map((name) => ({ name, est: { kcal: 100 } })),
  macros: { kcal: names.length * 100, protein_g: 10 },
  state: 'closed',
  ...extra,
});

describe('daysBetween', () => {
  it.each([
    ['2026-10-28', '2026-10-28', 0],
    ['2026-10-21', '2026-10-28', 7],
    ['2026-10-20', '2026-10-28', 8],
    ['2026-10-29', '2026-10-28', -1],
    ['2026-09-30', '2026-10-01', 1],
  ])('%s → %s is %i days', (from, to, days) => {
    expect(daysBetween(from, to)).toBe(days);
  });
});

describe('deriveLeftovers', () => {
  it('a meal logged recently is a leftover, priced and named as it was logged', () => {
    const out = deriveLeftovers([meal('m1', '2026-10-27', 'dinner', ['Lentil stew'])], TODAY, 7);
    expect(out).toEqual([
      expect.objectContaining({
        log_id: 'm1',
        name: 'Lentil stew',
        date: '2026-10-27',
        meal: 'dinner',
        kcal: 100,
        macros: { kcal: 100, protein_g: 10 },
      }),
    ]);
  });

  it('most recent at the top — newer day first, the later slot first within a day', () => {
    const out = deriveLeftovers(
      [
        meal('a', '2026-10-25', 'dinner', ['Chili']),
        meal('b', '2026-10-27', 'breakfast', ['Oats']),
        meal('c', '2026-10-27', 'dinner', ['Stew']),
        meal('d', '2026-10-27', 'lunch', ['Wrap']),
      ],
      TODAY,
      7,
    );
    expect(out.map((l) => l.name)).toEqual(['Stew', 'Wrap', 'Oats', 'Chili']);
  });

  it.each([
    [7, '2026-10-21', 1],
    [7, '2026-10-20', 0],
    [3, '2026-10-25', 1],
    [3, '2026-10-24', 0],
    [14, '2026-10-14', 1],
  ])('a %i-day window: a meal on %s → %i on the shelf', (window, date, n) => {
    expect(deriveLeftovers([meal('m', date, 'dinner', ['Stew'])], TODAY, window)).toHaveLength(n);
  });

  it('a meal dated in the future is not a leftover', () => {
    expect(deriveLeftovers([meal('m', '2026-10-29', 'dinner', ['Stew'])], TODAY, 7)).toEqual([]);
  });

  it('an open meal has not been eaten yet — not a leftover', () => {
    expect(deriveLeftovers([meal('m', TODAY, 'lunch', ['Wrap'], { state: 'open' })], TODAY, 7)).toEqual([]);
  });

  it('a legacy row with no state counts as logged', () => {
    expect(deriveLeftovers([meal('m', TODAY, 'lunch', ['Wrap'], { state: undefined })], TODAY, 7)).toHaveLength(1);
  });

  it('the draft in front of you is never its own leftover', () => {
    expect(deriveLeftovers([meal('draft', TODAY, 'lunch', ['Wrap'])], TODAY, 7, 'draft')).toEqual([]);
  });

  it('an empty meal is not a leftover', () => {
    expect(deriveLeftovers([meal('m', TODAY, 'lunch', [])], TODAY, 7)).toEqual([]);
  });

  it('the same meal twice shows once — the newest stands for it', () => {
    const out = deriveLeftovers(
      [meal('old', '2026-10-25', 'dinner', ['Stew']), meal('new', '2026-10-27', 'lunch', ['stew'])],
      TODAY,
      7,
    );
    expect(out.map((l) => l.log_id)).toEqual(['new']);
  });

  it('kcal falls back to the rows when the meal carries no total', () => {
    const out = deriveLeftovers([meal('m', TODAY, 'lunch', ['A', 'B'], { macros: undefined })], TODAY, 7);
    expect(out[0]).toMatchObject({ kcal: 200, macros: {} });
  });
});

describe('mealName', () => {
  const items = (rows: Array<[string, string?]>): MealItem[] =>
    rows.map(([name, part]) => ({ name, ...(part ? { part } : {}) }));

  it.each<[string, MealItem[], MealPart[], string]>([
    ['one item', items([['Toast']]), [], 'Toast'],
    [
      'a named bracket reads as its name',
      items([
        ['lentils', 'p'],
        ['onion', 'p'],
      ]),
      [{ key: 'p', name: 'Lentil stew' }],
      'Lentil stew',
    ],
    [
      'a bracket and a loose item',
      items([['lentils', 'p'], ['onion', 'p'], ['Side salad']]),
      [{ key: 'p', name: 'Lentil stew' }],
      'Lentil stew · Side salad',
    ],
    [
      'an unnamed bracket reads by its members',
      items([
        ['yogurt', 'p'],
        ['chia', 'p'],
      ]),
      [{ key: 'p', name: null }],
      'yogurt · chia',
    ],
    ['four things: the first two and a count', items([['A'], ['B'], ['C'], ['D']]), [], 'A · B + two more'],
    ['the same item twice is said once', items([['Coffee'], ['coffee']]), [], 'Coffee'],
  ])('%s', (_label, its, parts, want) => {
    expect(mealName(its, parts)).toBe(want);
  });
});

describe('leftoverLine', () => {
  it.each([
    [TODAY, 'lunch', 'today · lunch'],
    ['2026-10-27', 'dinner', 'yesterday · dinner'],
    ['2026-10-26', 'dinner', 'Mon · dinner'],
    ['2026-10-20', 'breakfast', '20 Oct · breakfast'],
  ] as const)('%s %s → "%s"', (date, kind, want) => {
    expect(leftoverLine({ date, meal: kind }, TODAY)).toBe(want);
  });
});
