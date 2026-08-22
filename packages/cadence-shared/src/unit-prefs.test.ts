/**
 * Owner, 2026-08-22, describing his own units: pounds for himself, grams for food, cups for food
 * volume, feet and inches for height, kilometres for distance. A single metric/imperial switch
 * cannot express that, which is the whole reason this exists — so most of these tests are about
 * axes NOT dragging each other around.
 */
import { describe, it, expect } from 'vitest';
import { resolveUnit, MIXED_DEFAULT, UNIT_AXES, axisOptions, type UnitPrefs } from './unit-prefs.ts';

describe('resolveUnit', () => {
  it('honours an explicit choice per axis', () => {
    const prefs: UnitPrefs = { body_weight: 'lb', food_mass: 'g', food_volume: 'cup', height: 'ft_in', distance: 'km' };
    expect(resolveUnit(prefs, 'body_weight')).toBe('lb');
    expect(resolveUnit(prefs, 'food_mass')).toBe('g');
    expect(resolveUnit(prefs, 'food_volume')).toBe('cup');
    expect(resolveUnit(prefs, 'height')).toBe('ft_in');
    expect(resolveUnit(prefs, 'distance')).toBe('km');
  });

  /** The point of the whole module: pounds for a body must not make grams into ounces. */
  it('does not let one axis drag another', () => {
    const prefs: UnitPrefs = { system: 'imperial', food_mass: 'g' };
    expect(resolveUnit(prefs, 'body_weight')).toBe('lb'); // from the system fallback
    expect(resolveUnit(prefs, 'food_mass')).toBe('g'); // explicitly kept metric
  });

  /** A fallback speaks for axes nobody set. It never overrules a choice. */
  it('an explicit choice beats the system fallback in both directions', () => {
    expect(resolveUnit({ system: 'imperial', distance: 'km' }, 'distance')).toBe('km');
    expect(resolveUnit({ system: 'metric', body_weight: 'lb' }, 'body_weight')).toBe('lb');
  });

  it('falls back to the system for anything unset', () => {
    expect(resolveUnit({ system: 'imperial' }, 'height')).toBe('ft_in');
    expect(resolveUnit({ system: 'metric' }, 'height')).toBe('cm');
  });

  it('is metric when there is nothing to go on at all', () => {
    for (const axis of UNIT_AXES) {
      expect(resolveUnit(null, axis), axis).toBe(axisOptions(axis)[0]);
    }
    expect(resolveUnit(undefined, 'body_weight')).toBe('kg');
    expect(resolveUnit({}, 'food_volume')).toBe('ml');
  });

  /**
   * `baseline.weight_unit` predates this module and every existing user has it — the weigh-in flow
   * and Review both write it. Dropping it would silently re-metricate everyone who ever weighed in.
   */
  describe('legacy baseline.weight_unit', () => {
    it.each(['lb', 'lbs', 'LBS'])('is honoured for body weight (%s)', (legacy) => {
      expect(resolveUnit({}, 'body_weight', legacy)).toBe('lb');
    });

    it('loses to an explicit new-style choice', () => {
      expect(resolveUnit({ body_weight: 'kg' }, 'body_weight', 'lbs')).toBe('kg');
    });

    it('beats the system fallback — it IS a choice the user made', () => {
      expect(resolveUnit({ system: 'metric' }, 'body_weight', 'lbs')).toBe('lb');
    });

    it('is ignored for every other axis', () => {
      expect(resolveUnit({}, 'food_mass', 'lbs')).toBe('g');
      expect(resolveUnit({}, 'distance', 'lbs')).toBe('km');
    });
  });

  it('ignores a value that is not one of the two options', () => {
    expect(resolveUnit({ body_weight: 'stone' } as unknown as UnitPrefs, 'body_weight')).toBe('kg');
  });
});

describe('MIXED_DEFAULT', () => {
  /**
   * Not pure metric, deliberately: that would tell a North American their weight in kilos on day
   * one — the exact complaint this module answers, applied to everyone by default.
   */
  it('is the owner’s own mix, and every axis is decided', () => {
    expect(MIXED_DEFAULT).toMatchObject({
      body_weight: 'lb',
      height: 'ft_in',
      food_mass: 'g',
      food_volume: 'cup',
      distance: 'km',
    });
    for (const axis of UNIT_AXES) {
      expect(resolveUnit(MIXED_DEFAULT, axis), axis).toBeTruthy();
    }
  });

  it('resolves to itself — no axis is left to the fallback', () => {
    expect(resolveUnit(MIXED_DEFAULT, 'body_weight')).toBe('lb');
    expect(resolveUnit(MIXED_DEFAULT, 'food_mass')).toBe('g');
  });
});
