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

/**
 * The 2026-08-13 device run: THREE cards for one race and two for one weight goal. Each pair
 * below coexisted on a real user's account; each must now merge — and the guards above must
 * still hold, because the fix (folding "an" into "a") is a normalization, not a loosening.
 */
describe('the tripled Ultra Beast (device run, 2026-08-13)', () => {
  it('matches the a/an rewording that split the race into two cards', () => {
    expect(sameGoalTitle('Run an Ultra Beast Spartan Race', 'Run a Spartan Ultra Beast')).toBe(true);
  });

  it('matches the bare race name against the full committed title', () => {
    expect(sameGoalTitle('Run an Ultra Beast Spartan Race', 'Spartan Ultra Beast')).toBe(true);
  });

  it('still cannot see through a true synonym — that fix lives in the prompt, not here', () => {
    // "Lose weight" vs "Drop weight to improve race performance" is lose≈drop, a judgment of
    // MEANING. The matcher stays synonym-free by design; TITLE ANCHORING in capture-extract
    // (the current_goal_cards variable) is what prevents the model minting the second title.
    expect(sameGoalTitle('Lose weight', 'Drop weight to improve race performance')).toBe(false);
  });
});

describe('accent folding', () => {
  // "Écossaise" used to normalize to "cossaise": the accent was not ignored, it became a word
  // boundary that ate the first letter. A stored piece then never matched its unaccented spelling.
  it('folds an accent to its base letter instead of eating it', () => {
    expect(normTitle('Écossaise')).toBe('ecossaise');
    expect(compactTitle('Écossaise')).toBe('ecossaise');
  });

  it('matches accented and unaccented spellings of the same title', () => {
    expect(normTitle('Écossaise')).toBe(normTitle('Ecossaise'));
    expect(sameGoalIdentity('Écossaise (Hummel)', 'Ecossaise (Hummel)')).toBe(true);
    expect(sameGoalTitle('Café pieces', 'Cafe pieces')).toBe(true);
  });

  it('handles the composers a repertoire actually contains', () => {
    expect(normTitle('Dvořák Humoresque')).toBe('dvorak humoresque');
    expect(normTitle('Fauré Sicilienne')).toBe('faure sicilienne');
    expect(normTitle('Grieg — Bjørnson songs')).toBe('grieg bjornson songs');
    expect(normTitle('Chopin Łódź study')).toBe('chopin lodz study');
    expect(normTitle('Straße etude')).toBe('strasse etude');
  });

  it('is identical whether the accent arrives composed (NFC) or decomposed (NFD)', () => {
    const nfc = 'Écossaise'.normalize('NFC');
    const nfd = 'Écossaise'.normalize('NFD');
    expect(nfc).not.toBe(nfd); // the two really are different strings
    expect(normTitle(nfd)).toBe(normTitle(nfc));
    expect(compactTitle(nfd)).toBe(compactTitle(nfc));
  });

  // The safety property that bounds this change: goal identity depends on these functions, and
  // every all-English title must reduce exactly as it did before.
  it('is a strict no-op for ASCII titles', () => {
    for (const t of ['Run a 10k', 'Spartan Ultra-Beast', 'Lose weight', '  Run an Ultra Beast!  ']) {
      expect(normTitle(t)).toBe(
        t
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, ' ')
          .replace(/\ban\b/g, 'a')
          .trim(),
      );
      expect(compactTitle(t)).toBe(t.toLowerCase().replace(/[^a-z0-9]+/g, ''));
    }
  });

  it('still keeps genuinely different goals apart', () => {
    expect(sameGoalTitle('Lose weight', 'Run a 50 km')).toBe(false);
    expect(sameGoalTitle('Étude in C', 'Prélude in C')).toBe(false);
  });
});
