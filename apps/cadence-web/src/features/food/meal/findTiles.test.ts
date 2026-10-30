import { describe, expect, it } from 'vitest';
import { findTiles, tileMatches } from './findTiles.ts';
import type { ShelfTile } from './useShelves.ts';

const tile = (id: string, name: string, sub?: string, kind: ShelfTile['kind'] = 'food'): ShelfTile => ({
  key: `${kind}-${id}`,
  kind,
  id,
  name,
  sub,
  kcal: 100,
});

/** Positives AND near-misses: a filter that claims the wrong tile adds the wrong food on a tap. */
describe('tileMatches', () => {
  it.each([
    ['egg', 'Eggs on toast', '2 eggs · sourdough'],
    ['gre yog', 'Greek yogurt, 2%', '1 cup'],
    ['YOGURT', 'Greek yogurt, 2%', undefined],
    ['caffe', 'Caffè latte', undefined],
    ['oat', 'Flat white', 'oat milk'], // the line under the name counts
    ['2', 'Greek yogurt, 2%', undefined],
  ])('%j finds %j', (q, name, sub) => {
    expect(tileMatches({ name, sub }, q)).toBe(true);
  });

  it.each([
    ['egg', 'Veggie burger', undefined], // inside a word, not the start of one
    ['yogurt bowl', 'Greek yogurt, 2%', undefined], // every word typed must land
    ['tea', 'Steak', undefined],
    ['', 'Banana', undefined],
    ['   ', 'Banana', undefined],
  ])('%j does not find %j', (q, name, sub) => {
    expect(tileMatches({ name, sub }, q)).toBe(false);
  });
});

describe('findTiles', () => {
  const shelves = {
    usual: [tile('f1', 'Greek yogurt, 2%'), tile('r1', 'Yogurt bowl', 'yogurt · chia', 'recipe')],
    leftovers: [tile('l1', 'Lentil stew', '2 of 4 left', 'leftover')],
    cookbook: [tile('r1', 'Yogurt bowl', 'makes 1', 'recipe'), tile('r2', 'Shakshuka', 'makes 2', 'recipe')],
  };

  it('searches every shelf, in shelf order', () => {
    expect(findTiles(shelves, ['usual', 'leftovers', 'cookbook'], 'yog').map((t) => t.id)).toEqual(['f1', 'r1']);
    expect(findTiles(shelves, ['usual', 'leftovers', 'cookbook'], 'shak').map((t) => t.id)).toEqual(['r2']);
  });

  it('shows a food on two shelves once, from the first shelf it sits on', () => {
    const hits = findTiles(shelves, ['usual', 'leftovers', 'cookbook'], 'bowl');
    expect(hits).toHaveLength(1);
    expect(hits[0]?.sub).toBe('yogurt · chia');
  });

  it('comes back empty when nothing is yours yet — the cue to hand the words to the coach', () => {
    expect(findTiles(shelves, ['usual', 'leftovers', 'cookbook'], 'starbucks latte')).toEqual([]);
  });
});
