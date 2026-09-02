import { describe, it, expect } from 'vitest';
import {
  isMacrosSource,
  isMealKind,
  MACROS_SOURCES,
  MEAL_KINDS,
  type MacrosSource,
  type MealKind,
} from './nutrition.ts';

/**
 * Both of these unions are derived from their array, so the values and the type cannot disagree.
 * What these pin is the other half: that the guards accept every canonical value, so nothing
 * downstream has to write the list out a second time to parse it.
 *
 * Both lists have been copied by hand before. `MealKind` was enumerated in six web files plus a
 * duplicate declaration of the type itself, and `Macros['source']` was mirrored two-values-short in
 * the web client, which silently dropped the ledger and research provenances on the way in.
 */
describe('isMealKind', () => {
  it('accepts every canonical meal slot', () => {
    for (const kind of MEAL_KINDS) expect(isMealKind(kind)).toBe(true);
  });

  it('keeps the slots in the order a day runs, so a picker built from it needs no sorting', () => {
    expect([...MEAL_KINDS]).toEqual(['breakfast', 'lunch', 'dinner', 'snack', 'drink', 'other']);
  });

  it('rejects anything that is not a slot', () => {
    for (const v of ['brunch', 'Breakfast', '', null, undefined, 7, {}]) expect(isMealKind(v)).toBe(false);
  });

  it('narrows to MealKind so a parsed value needs no cast', () => {
    const raw: unknown = 'dinner';
    if (!isMealKind(raw)) throw new Error('expected a meal kind');
    const kind: MealKind = raw;
    expect(kind).toBe('dinner');
  });
});

describe('isMacrosSource', () => {
  it('accepts every canonical provenance, including ledger and research', () => {
    for (const source of MACROS_SOURCES) expect(isMacrosSource(source)).toBe(true);
    expect(isMacrosSource('ledger')).toBe(true);
    expect(isMacrosSource('research')).toBe(true);
  });

  it('rejects anything that is not a provenance', () => {
    for (const v of ['guess', 'AI', '', null, undefined, 0]) expect(isMacrosSource(v)).toBe(false);
  });

  it('narrows to MacrosSource so a parsed value needs no cast', () => {
    const raw: unknown = 'ledger';
    if (!isMacrosSource(raw)) throw new Error('expected a macros source');
    const source: MacrosSource = raw;
    expect(source).toBe('ledger');
  });
});
