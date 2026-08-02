import { describe, it, expect } from 'vitest';
import {
  GROUNDING_GAMES,
  GROUNDING_NAMES,
  groundingDidSomething,
  groundingLogLine,
  groundingSpec,
  groundingSteps,
  isGroundingGame,
} from './grounding.ts';

describe('the game bank', () => {
  it('ships all six games with a plain name each', () => {
    expect(GROUNDING_GAMES).toHaveLength(6);
    for (const g of GROUNDING_GAMES) expect(GROUNDING_NAMES[g]).toBeTruthy();
  });

  it('validates game names', () => {
    expect(isGroundingGame('senses')).toBe(true);
    expect(isGroundingGame('quiz')).toBe(false);
    expect(isGroundingGame(null)).toBe(false);
  });

  it('gives every game at least one step', () => {
    for (const g of GROUNDING_GAMES) expect(groundingSteps(g).length).toBeGreaterThan(0);
  });
});

describe('the four-zone contract', () => {
  it('never puts more than five targets on screen', () => {
    for (const g of GROUNDING_GAMES) {
      for (const s of groundingSteps(g)) {
        if (s.targets !== undefined) expect(s.targets).toBeLessThanOrEqual(5);
      }
    }
  });

  it('always gives zone 4 a label — the forward control is never absent', () => {
    for (const g of GROUNDING_GAMES) {
      for (const s of groundingSteps(g)) expect(s.forward.length).toBeGreaterThan(0);
    }
  });

  // The redline says "max five words", but that is a proxy for "fits one line at 14px" — Design's
  // own countback cue is six. Assert the real constraint so the rule can't be gamed by hyphenation.
  it('keeps the instruction line to a single short line', () => {
    for (const g of GROUNDING_GAMES) {
      for (const s of groundingSteps(g)) {
        if (s.instruction) expect(s.instruction.length).toBeLessThanOrEqual(40);
      }
    }
  });

  it('ends every prompt as a sentence', () => {
    for (const g of GROUNDING_GAMES) {
      for (const s of groundingSteps(g)) expect(s.prompt).toMatch(/[.—]$/);
    }
  });
});

describe('senses', () => {
  it('counts down 5→1 by having fewer targets, never by saying a number', () => {
    const steps = groundingSteps('senses');
    expect(steps.map((s) => s.targets)).toEqual([5, 4, 3, 2, 1]);
  });

  it('has a known length, so it gets a spine', () => {
    expect(groundingSpec('senses').openEnded).toBe(false);
  });
});

describe('letters', () => {
  it('walks the alphabet and offers a skip, because skipping a letter is normal', () => {
    const steps = groundingSteps('letters', 'animals');
    expect(steps[0]?.letter).toBe('A');
    expect(steps[25]?.letter).toBe('Z');
    expect(steps[0]?.secondary).toBe('Skip');
  });

  it('changes the noun with the bank', () => {
    expect(groundingSteps('letters', 'foods')[0]?.prompt).toMatch(/eat/i);
    expect(groundingSteps('letters', 'cities')[0]?.prompt).toMatch(/place/i);
  });

  it('falls back to animals on an unknown bank rather than breaking', () => {
    expect(groundingSteps('letters', 'nonsense')[0]?.prompt).toMatch(/animal/i);
  });

  it('is open-ended, so it gets a static label instead of a bar that cannot fill', () => {
    const spec = groundingSpec('letters', 'animals');
    expect(spec.openEnded).toBe(true);
    expect(spec.label).toBeTruthy();
  });
});

describe('countback — nothing to enter, nothing to check', () => {
  const steps = groundingSteps('countback');

  it('never asks for a number', () => {
    for (const s of steps) expect(s.field).toBe('none');
  });

  it('says plainly that it is not checking', () => {
    expect(steps[0]?.instruction).toMatch(/not checking/i);
  });

  it('repeats the same prompt — the card does not track where you are', () => {
    expect(steps[1]?.prompt).toBe(steps[2]?.prompt);
  });

  it('is open-ended', () => {
    expect(groundingSpec('countback').openEnded).toBe(true);
  });
});

describe('object and cold', () => {
  it('object is one timed step with a sweep and no input', () => {
    const steps = groundingSteps('object');
    expect(steps).toHaveLength(1);
    expect(steps[0]?.field).toBe('arc');
    expect(steps[0]?.seconds).toBe(60);
  });

  it('cold needs no new field at all — the shell survives a payload with nothing to do', () => {
    const steps = groundingSteps('cold');
    expect(steps).toHaveLength(1);
    expect(steps[0]?.field).toBe('none');
  });
});

describe('groundingLogLine — leaving is done, not abandoned', () => {
  it('reads plainly when finished', () => {
    expect(groundingLogLine('senses', 5, 5, false)).toBe('Five senses · done');
  });

  it('credits a partial run without shame', () => {
    expect(groundingLogLine('senses', 3, 5, false)).toBe('Five senses · 3 of 5 · that counts');
  });

  it('never reports a fraction for an open-ended game — there was no target to miss', () => {
    expect(groundingLogLine('letters', 4, 26, true)).toBe('A to Z · done');
    expect(groundingLogLine('countback', 2, 14, true)).toBe('Counting back · done');
  });

  it('never says abandoned, incomplete, or failed', () => {
    for (const n of [0, 1, 3, 5]) {
      const line = groundingLogLine('senses', n, 5, false);
      expect(line).not.toMatch(/abandon|incomplete|fail|only|just/i);
    }
  });

  it('knows whether anything happened', () => {
    expect(groundingDidSomething(0)).toBe(false);
    expect(groundingDidSomething(1)).toBe(true);
  });
});
