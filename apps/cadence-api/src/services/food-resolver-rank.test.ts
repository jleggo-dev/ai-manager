import { describe, it, expect } from 'vitest';
import type { Food } from '@cadence/shared';
import {
  foodLabel,
  inferQuantity,
  inferServingIndex,
  lexicalMatchScore,
  newFoodCandidate,
  rankFoods,
  scoreFood,
  type FoodRankContext,
} from './food-resolver-rank.ts';
import { pickPreselected, type ResolveCandidate } from './food-resolver-types.ts';

function yogurt(overrides: Partial<Food> = {}): Food {
  return {
    food_id: 'f-yogurt',
    owner_user_id: 'user-1',
    visibility: 'private',
    name: 'Nonfat Greek Yogurt',
    brand: 'Fage',
    source: 'manual',
    off_id: null,
    fdc_id: null,
    base_unit: 'g',
    macros_per_base: { kcal: 59, protein_g: 10.3, carbs_g: 3.5, fat_g: 0 },
    servings: [
      { label: '1 container (170g)', unit: 'container', amount_g: 170 },
      { label: '100 g', unit: 'g', amount_g: 100 },
      { label: '1 bowl', unit: 'bowl', amount_g: 200 },
    ],
    default_serving: 0,
    confidence: 1,
    photo_ref: null,
    ...overrides,
  };
}

function egg(overrides: Partial<Food> = {}): Food {
  return {
    food_id: 'f-egg',
    owner_user_id: 'user-1',
    visibility: 'private',
    name: 'Large Egg',
    brand: null,
    source: 'manual',
    off_id: null,
    fdc_id: null,
    base_unit: 'item',
    macros_per_base: { kcal: 72, protein_g: 6.3, carbs_g: 0.4, fat_g: 4.8 },
    servings: [
      { label: '1 egg', unit: 'egg', amount_g: 1 },
      { label: '100 g', unit: 'g', amount_g: 100 },
    ],
    default_serving: 0,
    confidence: 1,
    photo_ref: null,
    ...overrides,
  };
}

function ctx(partial: Partial<FoodRankContext> = {}): FoodRankContext {
  return {
    userId: 'user-1',
    useCountById: new Map(),
    recentRankById: new Map(),
    ...partial,
  };
}

describe('inferQuantity', () => {
  it('defaults to 1', () => {
    expect(inferQuantity('greek yogurt')).toBe(1);
  });

  it('parses a leading count', () => {
    expect(inferQuantity('3 eggs')).toBe(3);
    expect(inferQuantity('2.5 bowls of oatmeal')).toBe(2.5);
  });

  it('parses fractions and halves', () => {
    expect(inferQuantity('half a bagel')).toBe(0.5);
    expect(inferQuantity('1/2 cup oats')).toBe(0.5);
    expect(inferQuantity('quarter sandwich')).toBe(0.25);
  });
});

describe('inferServingIndex', () => {
  it('falls back to default_serving', () => {
    expect(inferServingIndex('yogurt', yogurt())).toBe(0);
  });

  it('matches a unit word in the phrasing', () => {
    expect(inferServingIndex('a bowl of greek yogurt', yogurt())).toBe(2);
  });

  it('matches explicit grams to a serving', () => {
    expect(inferServingIndex('170g yogurt', yogurt())).toBe(0);
    expect(inferServingIndex('100 g yogurt', yogurt())).toBe(1);
  });

  it('matches egg unit for "3 eggs"', () => {
    expect(inferServingIndex('3 eggs', egg())).toBe(0);
  });
});

describe('lexicalMatchScore + rankFoods', () => {
  it('scores exact name/brand matches highest', () => {
    const f = yogurt();
    expect(lexicalMatchScore('nonfat greek yogurt', f)).toBe(1);
    expect(lexicalMatchScore('fage', f)).toBeGreaterThan(0.9);
  });

  it('ranks own + frequent foods above shared strangers', () => {
    const own = yogurt({ food_id: 'own', owner_user_id: 'user-1', name: 'Greek Yogurt', brand: null });
    const shared = yogurt({
      food_id: 'shared',
      owner_user_id: null,
      visibility: 'shared',
      name: 'Greek Yogurt',
      brand: 'Store',
    });
    const ranked = rankFoods('greek yogurt', [shared, own], ctx({ useCountById: new Map([['own', 8]]) }));
    expect(ranked[0]?.food.food_id).toBe('own');
    expect(ranked[0]!.score).toBeGreaterThan(ranked[1]!.score);
  });

  it('drops non-matching foods when query is set', () => {
    const ranked = rankFoods('salmon', [yogurt(), egg()], ctx());
    expect(ranked).toHaveLength(0);
  });

  it('empty query ranks by recency then frequency', () => {
    const a = yogurt({ food_id: 'a', name: 'A' });
    const b = yogurt({ food_id: 'b', name: 'B' });
    const ranked = rankFoods(
      '',
      [a, b],
      ctx({
        recentRankById: new Map([
          ['b', 0],
          ['a', 1],
        ]),
        useCountById: new Map([
          ['a', 10],
          ['b', 1],
        ]),
      }),
    );
    expect(ranked[0]?.food.food_id).toBe('b');
  });

  it('pre-selects serving + quantity on ranked rows', () => {
    const ranked = rankFoods('3 eggs', [egg()], ctx());
    expect(ranked).toHaveLength(1);
    expect(ranked[0]?.inferred_quantity).toBe(3);
    expect(ranked[0]?.preselected_serving).toBe(0);
  });
});

describe('scoreFood ownership boost', () => {
  it('boosts the user-owned copy', () => {
    const own = yogurt({ food_id: 'own', owner_user_id: 'user-1' });
    const shared = yogurt({ food_id: 'shared', owner_user_id: null, visibility: 'shared' });
    const c = ctx();
    expect(scoreFood('fage nonfat greek yogurt', own, c)).toBeGreaterThan(
      scoreFood('fage nonfat greek yogurt', shared, c),
    );
  });
});

describe('newFoodCandidate capture hooks', () => {
  it('routes text-only new to estimate', () => {
    const c = newFoodCandidate({ text: 'chia pudding' });
    expect(c.kind).toBe('new');
    expect(c.capture).toEqual({ path: 'estimate', text: 'chia pudding' });
    expect(c.label).toContain('chia pudding');
  });

  it('routes photo new to parse-label', () => {
    const c = newFoodCandidate({ text: 'Fage', photo: 'data:image/jpeg;base64,xx' });
    expect(c.capture?.path).toBe('parse-label');
    expect(foodLabel(yogurt())).toBe('Nonfat Greek Yogurt (Fage)');
  });
});

describe('pickPreselected with dietary safety', () => {
  it('skips allergen-flagged top candidates', () => {
    const candidates: ResolveCandidate[] = [
      {
        kind: 'food',
        score: 1,
        label: 'Peanut butter',
        food_id: 'pb',
        dietary: { safe: false, flags: [{ severity: 'allergy', term: 'peanut', matched: 'peanut' }] },
      },
      { kind: 'food', score: 0.8, label: 'Almond butter', food_id: 'ab', dietary: { safe: true, flags: [] } },
    ];
    expect(pickPreselected(candidates)?.food_id).toBe('ab');
  });

  it('withholds when two safe candidates are close', () => {
    const candidates: ResolveCandidate[] = [
      { kind: 'food', score: 1, label: 'Yogurt A', food_id: 'a', dietary: { safe: true, flags: [] } },
      { kind: 'food', score: 0.95, label: 'Yogurt B', food_id: 'b', dietary: { safe: true, flags: [] } },
    ];
    expect(pickPreselected(candidates)).toBeNull();
  });
});
