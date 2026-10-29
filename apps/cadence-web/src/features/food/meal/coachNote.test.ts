import { describe, expect, it } from 'vitest';
import { cartWords, quickLogCoachNote } from './coachNote.ts';

const TODAY = '2026-10-28';

describe('cartWords', () => {
  it('names loose rows and brackets once each, lower-case', () => {
    const items = [{ name: 'Yogurt', part: 'p1' }, { name: 'Chia', part: 'p1' }, { name: 'Flat white' }];
    expect(cartWords(items, [{ key: 'p1', name: 'Yogurt bowl' }])).toBe('yogurt bowl, flat white');
  });
  it('an unnamed bracket is named by its first member', () => {
    expect(
      cartWords(
        [
          { name: 'Eggs', part: 'p1' },
          { name: 'Toast', part: 'p1' },
        ],
        [{ key: 'p1', name: null }],
      ),
    ).toBe('eggs');
  });
});

describe('quickLogCoachNote', () => {
  const base = { meal: 'breakfast' as const, date: TODAY, parts: [], total: { kcal: 412 } };

  it('says which meal, what is in the cart, and where her reads are', () => {
    const note = quickLogCoachNote({ ...base, items: [{ name: 'Eggs on toast' }], logged: false }, TODAY);
    expect(note).toContain('logging their breakfast,');
    expect(note).toContain('In the cart so far, not logged yet: eggs on toast (about 412 kcal).');
    expect(note).toContain('get_food_log');
    expect(note).toContain('get_nutrition');
    expect(note).toContain('goals');
    expect(note).not.toContain(' for 2026-');
  });

  it('a logged meal reads as logged', () => {
    const note = quickLogCoachNote({ ...base, items: [{ name: 'Porridge' }], logged: true }, TODAY);
    expect(note).toContain('in their breakfast');
    expect(note).toContain('Logged: porridge (412 kcal).');
  });

  it('an empty cart says so', () => {
    expect(quickLogCoachNote({ ...base, items: [], logged: false }, TODAY)).toContain('Nothing in it yet.');
  });

  it("another day's meal names the day", () => {
    const note = quickLogCoachNote({ ...base, date: '2026-10-27', items: [], logged: false }, TODAY);
    expect(note).toContain('their breakfast for 2026-10-27');
  });
});
