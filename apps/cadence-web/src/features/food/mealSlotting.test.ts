import { describe, expect, it } from 'vitest';
import type { Meal } from '../../lib/api.ts';
import { foldCandidate, isNamedMeal, mealContentsLine } from './mealSlotting.ts';

const meal = (log_id: string, kind: Meal['meal'], items: string[], kcal?: number): Meal => ({
  log_id,
  date: '2026-08-20',
  meal: kind,
  items: items.map((name) => ({ name })),
  ...(kcal != null ? { macros: { kcal } } : {}),
});

describe('foldCandidate', () => {
  it('offers the day’s latest named meal', () => {
    const meals = [meal('c', 'drink', ['oat latte']), meal('b', 'breakfast', ['yogurt']), meal('a', 'dinner', ['chilli'])];
    expect(foldCandidate(meals, 'c')?.log_id).toBe('b');
  });

  it('never offers the thing that was just logged', () => {
    expect(foldCandidate([meal('b', 'breakfast', ['yogurt'])], 'b')).toBeNull();
  });

  it('has nothing to offer when the day holds only snacks and drinks', () => {
    expect(foldCandidate([meal('a', 'snack', ['almonds']), meal('b', 'drink', ['tea'])], 'c')).toBeNull();
  });

  it('has nothing to offer on an empty day', () => {
    expect(foldCandidate([], 'c')).toBeNull();
  });
});

describe('isNamedMeal', () => {
  it('names the three a day reads back as meals', () => {
    expect(['breakfast', 'lunch', 'dinner'].every((m) => isNamedMeal(m as Meal['meal']))).toBe(true);
    expect(['snack', 'drink', 'other'].some((m) => isNamedMeal(m as Meal['meal']))).toBe(false);
  });
});

describe('mealContentsLine', () => {
  it('says what is in it, since no meal in this repo carries a time', () => {
    expect(mealContentsLine(meal('b', 'breakfast', ['yogurt', 'blueberries', 'granola'], 510))).toBe(
      '3 things so far · 510 kcal',
    );
  });

  it('counts one thing in the singular and drops an absent total', () => {
    expect(mealContentsLine(meal('b', 'breakfast', ['yogurt']))).toBe('1 thing so far');
  });
});
