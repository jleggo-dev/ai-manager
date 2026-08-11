/**
 * API-P2 — the sameness rule, and specifically where it must REFUSE to fire. A goal wrongly
 * merged is something the user said out loud and then watched disappear, so the negative cases
 * below are the load-bearing half of this file.
 */
import { describe, it, expect } from 'vitest';
import { compactTitle, normTitle, sameGoalIdentity, sameGoalTitle } from './goal-identity.ts';

describe('goal identity', () => {
  it('normalizes case, punctuation and spacing', () => {
    expect(normTitle('  Run a 10K!  ')).toBe('run a 10k');
    expect(compactTitle('Spartan Ultra-Beast')).toBe('spartanultrabeast');
  });

  it('treats a moved word boundary as the same NAME, not a new goal', () => {
    expect(sameGoalIdentity('Spartan Ultrabeast', 'Spartan Ultra Beast')).toBe(true);
    expect(sameGoalIdentity('spartan ultra-beast!', 'Spartan Ultrabeast')).toBe(true);
  });

  it('does not treat a more specific goal as the same NAME (identity is strict)', () => {
    // Strictness matters where a user has already confirmed one of the two.
    expect(sameGoalIdentity('Run a 10k', 'Run a 10k this spring')).toBe(false);
  });
});

describe('sameGoalTitle (the pre-confirmation merge rule)', () => {
  it('matches the observed re-extractions of one race', () => {
    expect(sameGoalTitle('Spartan Ultrabeast', 'Spartan Ultra Beast')).toBe(true);
    expect(sameGoalTitle('Spartan Ultrabeast', 'Complete the Spartan Ultra Beast in Quebec')).toBe(true);
  });

  it('matches a title that only gained qualifiers, wherever they were inserted', () => {
    expect(sameGoalTitle('Run a 10k', 'Run a 10k this spring')).toBe(true);
    expect(sameGoalTitle('Lose weight', 'Lose some weight')).toBe(true);
  });

  it('keeps distinct goals apart even when they share an area and a verb', () => {
    expect(sameGoalTitle('Lose weight', 'Run a 50 km')).toBe(false);
    expect(sameGoalTitle('Run a 10k', 'Run a marathon')).toBe(false);
    expect(sameGoalTitle('Meditate daily', 'Read 12 books')).toBe(false);
    expect(sameGoalTitle('Sleep 7 hours', 'Sleep less on my phone')).toBe(false);
  });

  it('refuses one-word evidence — a bare word inside another goal proves nothing', () => {
    // The previous plain-substring rule quietly said true here: "grow strong".includes("row").
    expect(sameGoalTitle('Row', 'Grow strong')).toBe(false);
    expect(sameGoalTitle('Run', 'Run a marathon')).toBe(false);
  });

  it('refuses a short compact fragment as containment evidence', () => {
    // "ride" sits inside "bridge" — long enough to be a word, far too short to be a name.
    expect(sameGoalTitle('Ride', 'Cross the bridge run')).toBe(false);
  });

  it('is false for an empty or punctuation-only title', () => {
    expect(sameGoalTitle('', 'Run a 10k')).toBe(false);
    expect(sameGoalTitle('   !!  ', 'Run a 10k')).toBe(false);
  });
});
