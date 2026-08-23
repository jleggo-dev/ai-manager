/**
 * The repairs the dill-pickle incident needed, pinned as tests.
 *
 * A pack of dill-pickle-SEASONED peanuts was captioned "These are dill pickles, seasoned peanuts
 * from couchetard or K." The comma made the parse read two products. It logged both — and since
 * A23 both are PINNED, so the wrong name resolves again tomorrow unless a correction reaches the
 * food behind the log. The calories were nearly right (591 vs ~567 per 100g); the phantom pickle
 * nearly tripled the sodium. "We might not have the right name but we definitely have the right
 * nutrients" is the whole shape of this: keep the numbers, fix the label.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mergeItems, renameItem, totalsFromItems, reachBackToPin } from './meal-corrections.ts';

const renameOwnFood = vi.hoisted(() => vi.fn());
vi.mock('../repos/foods.ts', () => ({ renameOwnFood }));

const peanuts = {
  name: 'seasoned peanuts',
  brand: 'couchetard or K.',
  qty: 35.5,
  unit: 'g',
  est: { kcal: 210, protein_g: 9, fat_g: 18, sodium_mg: 225 },
  food_id: 'pin-peanuts',
};
const pickles = { name: 'dill pickles', est: { kcal: 5, sodium_mg: 450 }, food_id: 'pin-pickles' };

// Block body, NOT `() => mock.mockReset()` — that arrow returns the mock, vitest reads a returned
// function as a teardown hook, and calls it after every test. The throwing case then throws in
// teardown and the test fails while its assertion passed.
beforeEach(() => {
  renameOwnFood.mockReset();
});

describe('renameItem', () => {
  it('fixes the label and keeps every number', () => {
    const out = renameItem([peanuts], 0, 'Dill Pickle Peanuts');
    expect(out[0]!.name).toBe('Dill Pickle Peanuts');
    expect(out[0]!.est).toEqual(peanuts.est);
    expect(out[0]!.qty).toBe(35.5);
  });

  it('refuses to blank a name', () => {
    expect(renameItem([peanuts], 0, '   ')).toEqual([peanuts]);
  });

  it('leaves the vendor alone unless asked, and can clear a messy one', () => {
    expect(renameItem([peanuts], 0, 'Peanuts')[0]!.brand).toBe('couchetard or K.');
    expect(renameItem([peanuts], 0, 'Peanuts', 'Couche-Tard')[0]!.brand).toBe('Couche-Tard');
    expect(renameItem([peanuts], 0, 'Peanuts', null)[0]!.brand).toBeUndefined();
  });
});

describe('mergeItems', () => {
  it('folds the nutrients in, not just the row', () => {
    // Deleting the phantom row while keeping the meal total would leave its sodium behind — the
    // exact failure this whole surface exists to prevent.
    const [only] = mergeItems([peanuts, pickles], 1, 0);
    expect(only!.name).toBe('seasoned peanuts');
    expect(only!.est).toMatchObject({ kcal: 215, sodium_mg: 675, protein_g: 9, fat_g: 18 });
  });

  it('does not sum the amount — two rows of one food are one portion read twice', () => {
    const [only] = mergeItems([peanuts, { ...pickles, qty: 35.5, unit: 'g' }], 1, 0);
    expect(only!.qty).toBe(35.5);
  });

  it('keeps a vendor either side carried', () => {
    const [only] = mergeItems(
      [
        { ...peanuts, brand: undefined },
        { ...pickles, brand: 'Couche-Tard' },
      ],
      1,
      0,
    );
    expect(only!.brand).toBe('Couche-Tard');
  });

  it('is a no-op when the indices are the same or absent', () => {
    expect(mergeItems([peanuts, pickles], 0, 0)).toHaveLength(2);
    expect(mergeItems([peanuts, pickles], 9, 0)).toHaveLength(2);
  });
});

describe('totalsFromItems', () => {
  it('recomputes the meal after a phantom item is dropped', () => {
    // 675 mg as logged; 225 mg as eaten.
    expect(totalsFromItems([peanuts, pickles])).toMatchObject({ sodium_mg: 675 });
    expect(totalsFromItems([peanuts])).toMatchObject({ sodium_mg: 225, kcal: 210 });
  });

  it('has nothing to say about items carrying no numbers', () => {
    expect(totalsFromItems([{ name: 'a coffee' }])).toBeNull();
  });
});

describe('reachBackToPin', () => {
  it('renames the pinned food so the wrong name stops resolving tomorrow', async () => {
    renameOwnFood.mockResolvedValue({ food_id: 'pin-peanuts' });
    await expect(reachBackToPin('u1', peanuts, 'Dill Pickle Peanuts')).resolves.toBe(true);
    expect(renameOwnFood).toHaveBeenCalledWith('u1', 'pin-peanuts', { name: 'Dill Pickle Peanuts' });
  });

  it('does nothing for an item with no food behind it', async () => {
    await expect(reachBackToPin('u1', { name: 'toast' }, 'Toast')).resolves.toBe(false);
    expect(renameOwnFood).not.toHaveBeenCalled();
  });

  it('reports false rather than throwing when the pin is not theirs to rename', async () => {
    // A shared USDA row: renameOwnFood is scoped to owner_user_id, so it simply matches nothing.
    renameOwnFood.mockResolvedValue(null);
    await expect(reachBackToPin('u1', peanuts, 'Peanuts')).resolves.toBe(false);
  });

  it('never fails the correction the user CAN see to protect the one they cannot', async () => {
    renameOwnFood.mockImplementation(async () => {
      throw new Error('db down');
    });
    expect(await reachBackToPin('u1', peanuts, 'Peanuts')).toBe(false);
  });
});
