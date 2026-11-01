import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('../repos/foods.ts', () => ({ getFoodsByIds: vi.fn(async () => []) }));
vi.mock('../repos/food-phrases.ts', () => ({
  recallFoodPhrases: vi.fn(),
  rememberFoodPhrase: vi.fn(async () => undefined),
}));

import { getFoodsByIds } from '../repos/foods.ts';
import { rememberFoodPhrase } from '../repos/food-phrases.ts';
import { confirmedPickRows, learnVisibleRows, phraseKey, phraseLinksOf } from './food-phrases.ts';

beforeEach(() => {
  vi.mocked(getFoodsByIds).mockReset().mockResolvedValue([]);
  vi.mocked(rememberFoodPhrase).mockReset().mockResolvedValue(undefined);
});

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

/**
 * The chat door's confirm learns from what the person confirmed, never from what code guessed:
 * a row the client sent with a food the ledger then priced from is a confirmed pick; a row the
 * ledger matched by name on its own is not; a question row has no link and no words.
 */
describe('confirmedPickRows — only a confirmed pick teaches, paired by position', () => {
  const pricedLatte = { name: 'Caffè Latte (Venti)', qty: 1, unit: 'venti', est: { kcal: 250 }, food_id: 'f-latte' };

  it('a picked row the ledger priced from the same food is learned, with its words', () => {
    expect(confirmedPickRows([pricedLatte], [{ food_id: 'f-latte', said: 'Starbucks venti latte' }])).toEqual([
      { ...pricedLatte, said: 'Starbucks venti latte' },
    ]);
  });

  it('a row the ledger matched by name, with no client food_id, is not', () => {
    expect(confirmedPickRows([pricedLatte], [{ said: 'Starbucks venti latte' }])).toEqual([]);
  });

  it('a question row (no link, no words) is not — even once a chip gave it an amount and a name match priced it', () => {
    expect(confirmedPickRows([{ name: 'milk', qty: 1, unit: 'glass', food_id: 'f-milk' }], [{}])).toEqual([]);
  });

  it('a client food_id the ledger did not price from (it fell through to a match) is not', () => {
    expect(
      confirmedPickRows([{ ...pricedLatte, food_id: 'f-other' }], [{ food_id: 'f-latte', said: 'latte' }]),
    ).toEqual([]);
  });

  it('a count mismatch pairs nothing', () => {
    expect(confirmedPickRows([pricedLatte, pricedLatte], [{ food_id: 'f-latte', said: 'latte' }])).toEqual([]);
  });
});

describe('learnVisibleRows — the draft door teaches only a food this person can see', () => {
  const rows = [
    { food_id: 'f-mine', said: 'my parfait', qty: 1, unit: 'serving' },
    { food_id: 'f-stranger', said: 'their parfait', qty: 1, unit: 'serving' },
    { said: 'no link', qty: 1, unit: 'serving' },
  ];

  it('writes the visible food and skips the one the read did not return', async () => {
    vi.mocked(getFoodsByIds).mockResolvedValueOnce([{ food_id: 'f-mine' } as never]);
    await learnVisibleRows('u1', rows);
    expect(getFoodsByIds).toHaveBeenCalledWith('u1', ['f-mine', 'f-stranger']);
    expect(rememberFoodPhrase).toHaveBeenCalledTimes(1);
    expect(rememberFoodPhrase).toHaveBeenCalledWith('u1', {
      phrase: 'my parfait',
      food_id: 'f-mine',
      qty: 1,
      unit: 'serving',
    });
  });

  it('with no linked row there is no read and nothing written', async () => {
    await learnVisibleRows('u1', [rows[2]!]);
    expect(getFoodsByIds).not.toHaveBeenCalled();
    expect(rememberFoodPhrase).not.toHaveBeenCalled();
  });

  it('a failed foods read learns nothing and never throws', async () => {
    vi.mocked(getFoodsByIds).mockRejectedValueOnce(new Error('db down'));
    await expect(learnVisibleRows('u1', rows)).resolves.toBeUndefined();
    expect(rememberFoodPhrase).not.toHaveBeenCalled();
  });
});
