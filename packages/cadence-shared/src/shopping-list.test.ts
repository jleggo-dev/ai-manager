import { describe, it, expect } from 'vitest';
import { categorizeGrocery, deriveShoppingList } from './shopping-list.ts';

describe('categorizeGrocery', () => {
  it('buckets common groceries into the aisle they are sold in', () => {
    expect(categorizeGrocery('chicken thighs')).toBe('protein');
    expect(categorizeGrocery('spinach')).toBe('produce');
    expect(categorizeGrocery('rice')).toBe('pantry');
    expect(categorizeGrocery('cheddar cheese')).toBe('dairy');
    expect(categorizeGrocery('sourdough bread')).toBe('bakery');
  });

  it('falls back to "other" rather than guessing', () => {
    expect(categorizeGrocery('nutritional yeast flakes')).toBe('other');
  });
});

describe('deriveShoppingList', () => {
  it('merges the same ingredient across recipes and adds the quantities up', () => {
    const list = deriveShoppingList([
      { ingredients: [{ name: 'Spinach', qty: 1, unit: 'bag' }] },
      { ingredients: [{ name: 'spinach', qty: 1, unit: 'bag' }] },
    ]);
    expect(list).toHaveLength(1);
    expect(list[0]?.name).toBe('Spinach');
    expect(list[0]?.qty).toBe('2 bag');
    expect(list[0]?.category).toBe('produce');
  });

  it('leaves out what is already on hand', () => {
    const list = deriveShoppingList(
      [
        {
          ingredients: [
            { name: 'eggs', qty: 4, unit: 'item' },
            { name: 'cheddar', qty: 100, unit: 'g' },
          ],
        },
      ],
      [{ name: 'Eggs' }],
    );
    expect(list.map((i) => i.name)).toEqual(['cheddar']);
  });

  it('reads a quantity that arrived as a string — a saved recipe may hold either', () => {
    const list = deriveShoppingList([{ ingredients: [{ name: 'onion', qty: '2' }] }]);
    expect(list[0]?.qty).toBe('2');
  });

  it('never marks a derived row as already got', () => {
    const list = deriveShoppingList([{ ingredients: [{ name: 'rice', qty: 500, unit: 'g' }] }]);
    expect(list.every((i) => i.checked === false)).toBe(true);
  });

  it('is empty when nothing is planned — the list has no life of its own', () => {
    expect(deriveShoppingList([])).toEqual([]);
  });

  /**
   * An amount nobody stated stays unstated here too. The list still says buy the thing — that part
   * is known — but it does not print a number the person never gave.
   */
  it('lists an ingredient with no stated amount, with no invented number', () => {
    const list = deriveShoppingList([{ ingredients: [{ name: 'onion', qty: null, unit: 'item' }] }]);
    expect(list[0]).toMatchObject({ name: 'onion', qty: 'item' });
  });

  it('prints nothing at all for the amount when there is not even a unit', () => {
    const list = deriveShoppingList([{ ingredients: [{ name: 'onion', qty: null }] }]);
    expect(list[0]?.qty).toBe('');
  });

  it('takes the amount from whichever recipe named one', () => {
    const list = deriveShoppingList([
      { ingredients: [{ name: 'onion', qty: null, unit: 'item' }] },
      { ingredients: [{ name: 'onion', qty: 2, unit: 'item' }] },
    ]);
    expect(list[0]?.qty).toBe('2 item');
  });
});
