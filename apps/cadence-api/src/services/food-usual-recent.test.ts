import { describe, expect, it } from 'vitest';
import type { NutritionLog } from '@cadence/shared';
import { pageOf, recentAtSlot } from './food-usual-recent.ts';

let seq = 0;
function log(over: Partial<NutritionLog> & Pick<NutritionLog, 'date'>): NutritionLog {
  seq += 1;
  return {
    log_id: `l${seq}`,
    meal: 'breakfast',
    items: [],
    parts: [],
    recipe_id: null,
    ...over,
  } as NutritionLog;
}
const food = (food_id: string | null, name = food_id ?? 'free text', part?: string) =>
  ({ name, food_id, ...(part ? { part } : {}) }) as NutritionLog['items'][number];

describe('recentAtSlot — the Usual shelf, newest first, all of history', () => {
  it('orders by when each thing was LAST logged, not how often', () => {
    const rows = recentAtSlot(
      [
        log({ date: '2026-08-01', items: [food('milk')] }),
        log({ date: '2026-08-02', items: [food('milk')] }),
        log({ date: '2026-08-03', items: [food('milk')] }),
        log({ date: '2026-09-09', items: [food('banana')] }),
      ],
      'breakfast',
    );
    expect(rows.map((r) => r.id)).toEqual(['banana', 'milk']);
    expect(rows[1]).toMatchObject({ count: 3, last_date: '2026-08-03' });
  });

  it('has no window — a meal from months ago is still on the shelf', () => {
    const rows = recentAtSlot([log({ date: '2025-01-01', items: [food('oats')] })], 'breakfast');
    expect(rows.map((r) => r.id)).toEqual(['oats']);
  });

  it('sorts by date itself, and keeps the read order (newest write first) within a day', () => {
    const late = log({ date: '2026-09-07', items: [food('whey')] });
    const early = log({ date: '2026-09-07', items: [food('skyr')] });
    const older = log({ date: '2026-09-01', items: [food('berries')] });
    expect(recentAtSlot([older, late, early], 'breakfast').map((r) => r.id)).toEqual(['whey', 'skyr', 'berries']);
  });

  it('only this slot — lunch does not reach the breakfast shelf', () => {
    const rows = recentAtSlot(
      [
        log({ date: '2026-09-09', meal: 'lunch', items: [food('chilli')] }),
        log({ date: '2026-09-01', items: [food('milk')] }),
      ],
      'breakfast',
    );
    expect(rows.map((r) => r.id)).toEqual(['milk']);
  });

  it('a saved bracket counts as its recipe, its members not again as loose foods', () => {
    const rows = recentAtSlot(
      [
        log({
          date: '2026-09-08',
          items: [food('milk', 'Milk', 'p1'), food('espresso', 'Espresso', 'p1'), food('banana')],
          parts: [{ key: 'p1', recipe_id: 'latte', name: 'Small latte' }] as NutritionLog['parts'],
        }),
      ],
      'breakfast',
    );
    expect(rows.map((r) => `${r.kind}:${r.id}`)).toEqual(['recipe:latte', 'food:banana']);
  });

  it('a whole-recipe log is the recipe', () => {
    const rows = recentAtSlot([log({ date: '2026-09-01', recipe_id: 'bowl', items: [food('yogurt')] })], 'breakfast');
    expect(rows.map((r) => `${r.kind}:${r.id}`)).toEqual(['recipe:bowl']);
  });

  it('skips items never matched to a saved food, and a draft with no items', () => {
    const rows = recentAtSlot(
      [
        log({ date: '2026-10-29', items: null as unknown as NutritionLog['items'] }),
        log({ date: '2026-08-22', items: [food(null, 'large eggs'), food('milk')] }),
      ],
      'breakfast',
    );
    expect(rows.map((r) => r.id)).toEqual(['milk']);
  });

  it('the same food twice in ONE meal counts once', () => {
    const rows = recentAtSlot([log({ date: '2026-09-01', items: [food('milk'), food('milk')] })], 'breakfast');
    expect(rows[0]).toMatchObject({ id: 'milk', count: 1 });
  });
});

describe('pageOf — the cursor', () => {
  const rows = ['a', 'b', 'c', 'd', 'e'];
  it('first page hands back where the next one starts', () => {
    expect(pageOf(rows, 0, 2)).toEqual({ items: ['a', 'b'], next_cursor: '2' });
  });
  it('the last page says there is no more', () => {
    expect(pageOf(rows, 4, 2)).toEqual({ items: ['e'], next_cursor: null });
  });
  it('an exact fit ends cleanly, and a cursor past the end is an empty last page', () => {
    expect(pageOf(rows, 3, 2)).toEqual({ items: ['d', 'e'], next_cursor: null });
    expect(pageOf(rows, 9, 2)).toEqual({ items: [], next_cursor: null });
  });
});
