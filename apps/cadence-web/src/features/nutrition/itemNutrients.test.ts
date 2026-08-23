/**
 * What one logged food contributed — brief 05's view model.
 *
 * The judgement call worth pinning: a single item is NOT measured against the day's floors. Asking
 * "am I short of iron?" of one food would draw a peanut as 8% of a target and read as a
 * deficiency it could not possibly be. A plain amount is the honest answer at this scale — and
 * sodium still says which way it runs, because in the incident that built this surface, sodium is
 * the number that went wrong.
 */
import { describe, it, expect } from 'vitest';
import { itemNutrients } from './itemNutrients.ts';

describe('itemNutrients', () => {
  it('leads with macros, in eating order', () => {
    const out = itemNutrients({ kcal: 210, protein_g: 9, carbs_g: 6, fat_g: 18 });
    expect(out.map((n) => n.label)).toEqual(['Calories', 'Protein', 'Carbs', 'Fat']);
    expect(out[0]!.text).toBe('210');
    expect(out[1]!.text).toBe('9 g');
  });

  it('marks sodium as the one to stay under, and nothing else', () => {
    const out = itemNutrients({ kcal: 210, sodium_mg: 225, iron_mg: 1.2 });
    expect(out.filter((n) => n.ceiling).map((n) => n.key)).toEqual(['sodium_mg']);
  });

  it('shows only the micros this food actually carries', () => {
    // Absent is absent — never eight rows of zero, which would read as a deficiency it is not.
    const out = itemNutrients({ kcal: 210, iron_mg: 1.2 });
    expect(out.map((n) => n.key)).toEqual(['kcal', 'iron_mg']);
  });

  it('never lists fibre twice, being both a macro and a tracked floor', () => {
    const keys = itemNutrients({ fiber_g: 14.3 }).map((n) => n.key);
    expect(keys.filter((k) => k === 'fiber_g')).toHaveLength(1);
  });

  it('has nothing to show for a food we hold no numbers for', () => {
    expect(itemNutrients(null)).toEqual([]);
    expect(itemNutrients({})).toEqual([]);
  });
});
