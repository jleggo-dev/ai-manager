import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * `research_food` wraps `researchFoodOutcome` (food-research.ts, owned by a different parcel this
 * wave — mocked here rather than exercised for real). What is tested is the translation: usage
 * hints, a refusal reads as a REASON rather than an invitation to guess, and a hit is presented as
 * a fact she relays rather than something the tool itself saved.
 */
vi.mock('../food-research.ts', () => ({ researchFoodOutcome: vi.fn() }));

import { researchFoodOutcome } from '../food-research.ts';
import { RESEARCH_FOOD } from './food-research-function.ts';

beforeEach(() => {
  vi.mocked(researchFoodOutcome).mockReset();
});

describe('research_food.run', () => {
  it('returns null and never calls the lookup when name is blank', async () => {
    const out = await RESEARCH_FOOD.run('u1', { name: '  ' });
    expect(out).toBeNull();
    expect(researchFoodOutcome).not.toHaveBeenCalled();
  });

  it('trims name and forwards a brand when given', async () => {
    vi.mocked(researchFoodOutcome).mockResolvedValue({ result: null, reason: 'nothing to search' } as never);
    await RESEARCH_FOOD.run('u1', { name: '  dried mushrooms  ', brand: 'the wild mushroom co' });
    expect(researchFoodOutcome).toHaveBeenCalledWith('u1', {
      name: 'dried mushrooms',
      brand: 'the wild mushroom co',
    });
  });

  it('passes a null brand rather than an empty string when none is given', async () => {
    vi.mocked(researchFoodOutcome).mockResolvedValue({ result: null, reason: 'nothing to search' } as never);
    await RESEARCH_FOOD.run('u1', { name: 'shallots' });
    expect(researchFoodOutcome).toHaveBeenCalledWith('u1', { name: 'shallots', brand: null });
  });
});

describe('research_food.render', () => {
  it('gives a usage hint for a bare call', () => {
    expect(RESEARCH_FOOD.render(null)).toContain('pass name');
  });

  it('reports a fault distinctly from a usage or refused result', () => {
    const out = RESEARCH_FOOD.render(undefined);
    expect(out).toMatch(/could not.*read/i);
  });

  it('states the refusal reason and forbids inventing a number', () => {
    const out = RESEARCH_FOOD.render({
      result: null,
      reason: 'refused — confidence 0.20 is below the 0.4 floor',
    } as never);
    expect(out).toContain('confidence 0.20 is below the 0.4 floor');
    expect(out).toMatch(/do not invent/i);
  });

  it('presents a hit as a fact to relay, never as something already saved', () => {
    const out = RESEARCH_FOOD.render({
      result: {
        food: {
          name: 'Mixed Dried Mushrooms',
          brand: 'the wild mushroom co',
          base_unit: 'g',
          macros_per_base: { kcal: 267, protein_g: 20, carbs_g: 53, fat_g: 7 },
          servings: [
            { label: '100g', unit: 'g', amount_g: 100 },
            { label: '15 pieces (15g)', unit: 'pieces', amount_g: 15 },
          ],
          confidence: 0.82,
        },
        source_url: 'https://example.com/mushrooms',
      },
      reason: null,
    } as never);
    expect(out).toContain('the wild mushroom co Mixed Dried Mushrooms');
    expect(out).toContain('267 kcal');
    expect(out).toContain('15 pieces (15g)');
    expect(out).toContain('0.82');
    expect(out).toContain('https://example.com/mushrooms');
    expect(out).toContain('nothing was written down');
  });

  it('omits the source line cleanly when no URL came back', () => {
    const out = RESEARCH_FOOD.render({
      result: {
        food: {
          name: 'Generic Bar',
          brand: null,
          base_unit: 'item',
          macros_per_base: { kcal: 200 },
          servings: [{ label: '1 item', unit: 'item', amount_g: 1 }],
          confidence: 0.5,
        },
        source_url: null,
      },
      reason: null,
    } as never);
    expect(out).toContain('Generic Bar');
    expect(out).not.toContain('Source:');
  });

  it('names the other products weighed when alternates came back non-empty', () => {
    const out = RESEARCH_FOOD.render({
      result: {
        food: {
          name: 'Dill Pickle Peanuts',
          brand: 'The Carolina Nut Co.',
          base_unit: 'g',
          macros_per_base: { kcal: 607, protein_g: 25, carbs_g: 25, fat_g: 46.4 },
          servings: [{ label: '100g', unit: 'g', amount_g: 100 }],
          confidence: 0.7,
        },
        source_url: 'https://carolinanut.com/products/dill-pickle',
        alternates: ['Costco Dill Pickle Peanuts', "Nature's Garden Dill Pickle Mix"],
      },
      reason: null,
    } as never);
    expect(out).toContain(
      'Other products that matched the name: Costco Dill Pickle Peanuts, ' + "Nature's Garden Dill Pickle Mix.",
    );
    // Facts, not picks (owner red line): the tool never tells her which one to ask about or offer.
    expect(out).not.toMatch(/\bask (them )?which\b/i);
  });

  it('says nothing about alternates when the list is empty', () => {
    const out = RESEARCH_FOOD.render({
      result: {
        food: {
          name: 'Generic Bar',
          brand: null,
          base_unit: 'item',
          macros_per_base: { kcal: 200 },
          servings: [{ label: '1 item', unit: 'item', amount_g: 1 }],
          confidence: 0.5,
        },
        source_url: null,
        alternates: [],
      },
      reason: null,
    } as never);
    expect(out).not.toContain('Other products that matched the name');
  });
});
