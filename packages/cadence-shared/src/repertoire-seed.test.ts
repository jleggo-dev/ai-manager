/**
 * Table test for the seed's standing set — the guard that keeps a bulk import from inventing
 * anniversaries.
 *
 * Seeding a book writes up to sixty rows in one press. Two of the four standings must never come
 * out of it: `retired` would file a piece as finished that the person has not finished, and the
 * `learned` VERB (which stores `known` and stamps `learned_at`) would date sixty crossings to
 * today and put "you learned sixty pieces this week" in the recap. Neither throws if it slips
 * through — the rows just land wrong — so the set is pinned here with its near-misses.
 */
import { describe, it, expect } from 'vitest';
import { MAX_SEED_ITEMS, SEED_STATUSES, isSeedStatus } from './repertoire-seed.ts';

describe('SEED_STATUSES', () => {
  it('is exactly the three standings a seed may write, in the order the screen reads them', () => {
    expect(SEED_STATUSES).toEqual(['known', 'working', 'queued']);
  });

  for (const status of ['known', 'working', 'queued']) {
    it(`accepts "${status}"`, () => {
      expect(isSeedStatus(status)).toBe(true);
    });
  }

  // `retired` and `learned` are the two that cost something. `parked` is the standing 0054
  // dropped; `learning`/`Known` are the shapes a hand-typed client sends.
  for (const word of ['retired', 'learned', 'parked', 'learning', 'Known', 'queue', 'done', '']) {
    it(`rejects "${word}" — a seed never writes it`, () => {
      expect(isSeedStatus(word)).toBe(false);
    });
  }

  it('rejects non-strings a client or a model could still send as JSON', () => {
    expect(isSeedStatus(null)).toBe(false);
    expect(isSeedStatus(undefined)).toBe(false);
    expect(isSeedStatus(1)).toBe(false);
    expect(isSeedStatus(['known'])).toBe(false);
  });
});

describe('MAX_SEED_ITEMS', () => {
  it('is 60 — the one number the prompt, the service, the route and the screen all cap at', () => {
    expect(MAX_SEED_ITEMS).toBe(60);
  });
});
