import { describe, expect, it } from 'vitest';
import { phraseKey, phraseLinksOf } from './food-phrases.ts';

describe('phraseKey — the same words are one key', () => {
  it.each([
    ['Starbucks venti latte', 'starbucks venti latte'],
    ['starbucks  Venti   LATTE', 'starbucks venti latte'],
    ['Caffè Latte (Venti)', 'caffe latte venti'],
    ['150ml 2% mulk', '2% mulk'],
    ['a handful of almonds', 'almonds'],
    ["siggi's creamy skyr plain", 'siggi s creamy skyr plain'],
    ['2 Roma tomatoes', 'roma tomatoes'],
    ['', ''],
  ])('%j → %j', (said, key) => {
    expect(phraseKey(said)).toBe(key);
  });

  it('near-misses stay apart: a different food is a different key', () => {
    expect(phraseKey('peanut butter')).not.toBe(phraseKey('powdered peanut butter'));
    expect(phraseKey('1 cup cooked white rice')).not.toBe(phraseKey('1/2 cup uncooked white rice'));
  });
});

describe('phraseLinksOf — only confirmed rows that name a food teach the memory', () => {
  it('keeps the food, the amount and the words; skips estimates, open rows and repeats', () => {
    expect(
      phraseLinksOf([
        { food_id: 'f1', said: 'Starbucks venti latte', qty: 591, unit: 'ml' },
        { said: 'mystery dish', qty: 1, unit: 'serving' },
        { food_id: 'f2', said: 'a banana' },
        { food_id: 'f3', said: 'starbucks venti latte', qty: 1, unit: 'venti' },
        { food_id: 'f4', said: 'eggs', qty: 2, unit: '' },
      ]),
    ).toEqual([
      { phrase: 'starbucks venti latte', food_id: 'f1', qty: 591, unit: 'ml' },
      { phrase: 'eggs', food_id: 'f4', qty: 2, unit: null },
    ]);
  });
});
