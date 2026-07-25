import { describe, it, expect } from 'vitest';
import { pickPreselected, type ResolveCandidate } from './food-resolver-types.ts';

describe('pickPreselected', () => {
  it('returns null when only the new-food escape hatch is present', () => {
    const candidates: ResolveCandidate[] = [{ kind: 'new', score: 0, label: 'Add "x"' }];
    expect(pickPreselected(candidates)).toBeNull();
  });

  it('pre-selects a sole food candidate', () => {
    const candidates: ResolveCandidate[] = [
      { kind: 'food', score: 1, label: 'Yogurt', food_id: 'a', preselected_serving: 0 },
      { kind: 'new', score: 0, label: 'Add "yogurt"' },
    ];
    expect(pickPreselected(candidates)?.food_id).toBe('a');
  });

  it('pre-selects when the top candidate is clearly ahead', () => {
    const candidates: ResolveCandidate[] = [
      { kind: 'food', score: 1, label: 'Yogurt', food_id: 'a' },
      { kind: 'food', score: 0.85, label: 'Other', food_id: 'b' },
    ];
    expect(pickPreselected(candidates)?.food_id).toBe('a');
  });

  it('withholds pre-select when candidates are close (disambiguate)', () => {
    const candidates: ResolveCandidate[] = [
      { kind: 'food', score: 1, label: 'Yogurt A', food_id: 'a' },
      { kind: 'food', score: 0.95, label: 'Yogurt B', food_id: 'b' },
    ];
    expect(pickPreselected(candidates)).toBeNull();
  });

  it('never pre-selects an allergen-flagged candidate', () => {
    const candidates: ResolveCandidate[] = [
      {
        kind: 'food',
        score: 1,
        label: 'Peanut butter',
        food_id: 'pb',
        dietary: { safe: false, flags: [{ severity: 'allergy', term: 'peanuts', matched: 'peanut' }] },
      },
      { kind: 'new', score: 0, label: 'Add "peanut"' },
    ];
    expect(pickPreselected(candidates)).toBeNull();
  });
});
