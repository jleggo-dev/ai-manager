/**
 * Which places the weather sheet may change — the one rule, tabled. Positives and near-misses:
 * a device-set place must never grow a CHANGE, and a place with no record must fall the way
 * `readSource`'s label heuristic already falls in Settings.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { writeSource } from '../settings/location-source.ts';
import { canChangeCity } from './useCitySetter.ts';

describe('canChangeCity', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  const cases: [string, 'device' | 'city' | null, { label?: string } | null, boolean][] = [
    ['nothing on file yet', null, null, true],
    ['typed city, recorded', 'city', { label: 'Montreal' }, true],
    ['device place, recorded', 'device', { label: 'Montreal' }, false],
    ['device place without a label, recorded', 'device', {}, false],
    ['no record, labelled → reads as a typed city', null, { label: 'Montreal' }, true],
    ['no record, bare coordinates → reads as the device', null, {}, false],
    ['record says city even though the label is empty', 'city', {}, true],
  ];

  it.each(cases)('%s', (_name, stored, loc, expected) => {
    writeSource(stored);
    expect(canChangeCity(loc)).toBe(expected);
  });
});
