import { describe, it, expect } from 'vitest';
import { sessionBudget, budgetNote } from './session-budget.ts';

/**
 * The owner's two sentences, as tests (2026-08-17):
 *   "If I'm going to do a 40 min run the run should be 40mins, regardless of if I have to warm-up
 *    before or stretch after."
 *   "If I'm pursuing a 20min meditation session, I want the meditation session to be 20mins (not
 *    15mins, because I need 5 mins to find a quiet place). I still want to know how much time to
 *    budget in my schedule."
 */
describe('sessionBudget — the effort keeps its full length', () => {
  it('gives a 40-minute run all 40 minutes, and budgets 50', () => {
    const b = sessionBudget(40, 'movement');
    expect(b).toEqual({ effort_min: 40, prep_min: 10, total_min: 50 });
  });

  it('gives a 20-minute meditation all 20 minutes — never 15 to make room for settling in', () => {
    expect(sessionBudget(20, 'mind')).toEqual({ effort_min: 20, prep_min: 5, total_min: 25 });
  });

  it('never shortens the effort, whatever the area', () => {
    for (const area of ['movement', 'mind', 'practice', 'nourishment'] as const) {
      expect(sessionBudget(30, area)?.effort_min).toBe(30);
    }
  });

  it('adds nothing to nourishment — logging a meal has no warm-up', () => {
    expect(sessionBudget(15, 'nourishment')).toEqual({ effort_min: 15, prep_min: 0, total_min: 15 });
  });

  it('adds nothing when the area is unknown, rather than inventing overhead for a check-in', () => {
    expect(sessionBudget(10)).toEqual({ effort_min: 10, prep_min: 0, total_min: 10 });
    expect(sessionBudget(10, null)).toEqual({ effort_min: 10, prep_min: 0, total_min: 10 });
  });

  it('caps prep at half the effort so a short practice is not mostly overhead', () => {
    // 6-minute breathing practice: 3 minutes of setup, not 5.
    expect(sessionBudget(6, 'practice')).toEqual({ effort_min: 6, prep_min: 3, total_min: 9 });
    // A 4-minute run gets 2, not 10.
    expect(sessionBudget(4, 'movement')).toEqual({ effort_min: 4, prep_min: 2, total_min: 6 });
  });

  it('rounds a fractional effort and stays whole-minute throughout', () => {
    const b = sessionBudget(24.6, 'movement');
    expect(b).toEqual({ effort_min: 25, prep_min: 10, total_min: 35 });
  });

  it('returns null when there is no duration to reason about', () => {
    expect(sessionBudget(undefined, 'movement')).toBeNull();
    expect(sessionBudget(null, 'movement')).toBeNull();
    expect(sessionBudget(0, 'movement')).toBeNull();
    expect(sessionBudget(-5, 'movement')).toBeNull();
    expect(sessionBudget(Number.NaN, 'movement')).toBeNull();
  });

  it('total is always effort + prep', () => {
    for (const mins of [1, 5, 12, 20, 45, 90, 600]) {
      const b = sessionBudget(mins, 'movement');
      expect(b).not.toBeNull();
      expect(b?.total_min).toBe((b?.effort_min ?? 0) + (b?.prep_min ?? 0));
    }
  });
});

describe('budgetNote', () => {
  it('names the time to set aside when there is extra to allow for', () => {
    expect(budgetNote(sessionBudget(40, 'movement'))).toBe('(allow 50)');
    expect(budgetNote(sessionBudget(20, 'mind'))).toBe('(allow 25)');
  });

  it('stays silent when the effort IS the whole session — "(allow 20)" would be noise', () => {
    expect(budgetNote(sessionBudget(20, 'nourishment'))).toBe('');
    expect(budgetNote(sessionBudget(20))).toBe('');
    expect(budgetNote(null)).toBe('');
  });
});

/**
 * An area this build does not recognise must behave exactly like no area at all.
 *
 * Not hypothetical: an activity's neighbouring column is `category` ("cardio", "strength"), the
 * area arrives from the database through three flattened type copies, and indexing the prep table
 * on an unknown key yields `undefined` — which `Math.min` turns into NaN and the card would have
 * rendered as "allow NaN". Caught by running the real plan through it with `category` in the
 * area's place, which is precisely the mistake a caller makes.
 */
describe('sessionBudget — an area it has never heard of', () => {
  it('treats an unknown area as no area rather than producing NaN', () => {
    const b = sessionBudget(40, 'cardio' as never);
    expect(b).toEqual({ effort_min: 40, prep_min: 0, total_min: 40 });
  });

  it('never returns a non-finite number for any area value', () => {
    for (const area of ['movement', 'mind', 'practice', 'nourishment', 'cardio', '', 'MOVEMENT']) {
      const b = sessionBudget(30, area as never);
      expect(b, area).not.toBeNull();
      expect(Number.isFinite(b?.total_min)).toBe(true);
      expect(Number.isFinite(b?.prep_min)).toBe(true);
    }
  });

  it('still pads a known area', () => {
    expect(sessionBudget(40, 'movement')).toEqual({ effort_min: 40, prep_min: 10, total_min: 50 });
    expect(sessionBudget(20, 'mind')).toEqual({ effort_min: 20, prep_min: 5, total_min: 25 });
  });
});
