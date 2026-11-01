/**
 * The slot a described meal's words name — the table for a deterministic router (owner,
 * 2026-09-01: every router ships with positives AND near-misses). On the coach-led read nothing
 * else guesses the slot, so a miss here files a meal under "other" and ticks the generic "Food
 * log" occurrence instead of Breakfast; a false hit files a breakfast bar under breakfast.
 */
import { describe, expect, it } from 'vitest';
import { mealSlotInWords, readMealSlot } from './meal-slot-words.ts';

describe('mealSlotInWords — the slot named in the words', () => {
  it.each([
    ['two eggs and toast for breakfast', 'breakfast'],
    ['for breakfast two eggs and toast', 'breakfast'],
    ['For breakfast I had a bagel', 'breakfast'],
    ['Breakfast: two eggs', 'breakfast'],
    ['breakfast — eggs and toast', 'breakfast'],
    ['a salad at lunch today', 'lunch'],
    ['had a wrap for my lunch', 'lunch'],
    ['Lunch was a salad', 'lunch'],
    ['chicken and rice with dinner', 'dinner'],
    ['for dinner tonight, salmon', 'dinner'],
    ['steak for supper', 'dinner'],
    ['after our supper a scoop of ice cream', 'dinner'],
    ['an apple as a snack', 'snack'],
    ['as a snack, some almonds', 'snack'],
    ['almonds for snacks', 'snack'],
    ['a protein bar for breakfast', 'breakfast'],
    ['a dinner roll with dinner', 'dinner'],
  ])('%s → %s', (words, slot) => {
    expect(mealSlotInWords(words)).toBe(slot);
  });

  it.each([
    'a breakfast bar',
    'for a breakfast bar and a coffee',
    'breakfast burrito',
    'lunchbox leftovers',
    'the lunch special',
    'with dinner rolls',
    'a dinner roll',
    'at the dinner party',
    'brunch at noon',
    'had brunch: eggs benedict',
    'a snack bar',
    'two eggs and toast',
    'a latte',
    '',
  ])('%s → none', (words) => {
    expect(mealSlotInWords(words)).toBeNull();
  });
});

describe('readMealSlot — the phrase that named the slot is not food, and comes out of the words', () => {
  it.each([
    ['two eggs and toast for breakfast', 'breakfast', 'two eggs and toast'],
    ['a banana for breakfast', 'breakfast', 'a banana'],
    ['For breakfast I had a bagel', 'breakfast', 'I had a bagel'],
    ['Breakfast: two eggs', 'breakfast', 'two eggs'],
    ['for dinner tonight, salmon', 'dinner', 'tonight, salmon'],
    ['as a snack, some almonds', 'snack', 'some almonds'],
    ['a dinner roll with dinner', 'dinner', 'a dinner roll'],
    ['a salad at lunch today', 'lunch', 'a salad today'],
  ])('%s → %s, words "%s"', (words, slot, rest) => {
    expect(readMealSlot(words)).toEqual({ slot, rest });
  });

  it('leaves the words as given when they name no slot, and keeps them when the slot was all there was', () => {
    expect(readMealSlot('a breakfast bar')).toEqual({ slot: null, rest: 'a breakfast bar' });
    expect(readMealSlot('for breakfast')).toEqual({ slot: 'breakfast', rest: 'for breakfast' });
  });
});
