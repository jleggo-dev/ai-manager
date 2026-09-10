/**
 * Which places the weather sheet may change — the one rule, tabled. Positives and near-misses:
 * a device-set place must never grow a CHANGE, a place whose provenance is UNKNOWN must not
 * either (that guess is what offered CHANGE on the owner's device-set city, 2026-09-09), and the
 * server's record outranks whatever this phone remembers.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { writeSource } from '../settings/location-source.ts';
import { canChangeCity } from './useCitySetter.ts';

type Src = 'device' | 'city';

describe('canChangeCity', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  const cases: [string, Src | null, { label?: string; source?: Src } | null, boolean][] = [
    ['nothing on file yet', null, null, true],
    ['typed city, recorded on this phone', 'city', { label: 'Montreal' }, true],
    ['device place, recorded on this phone', 'device', { label: 'Montreal' }, false],
    ['device place without a label, recorded', 'device', {}, false],
    ['record says city even though the label is empty', 'city', {}, true],
    // No record anywhere: the label used to make this "typed", and a device fix carries one.
    ['no record, labelled → unknown, so no door', null, { label: 'Montreal' }, false],
    ['no record, bare coordinates → unknown, so no door', null, {}, false],
    // The server's record, kept with the place since 2026-09-10, is the one that survives a new
    // phone and an account switch — and it wins over a stale local one.
    ['server says device, no local record', null, { label: 'Montreal', source: 'device' }, false],
    ['server says city, no local record', null, { label: 'Montreal', source: 'city' }, true],
    ['server says device, this phone still says city', 'city', { label: 'Montreal', source: 'device' }, false],
    ['server says city, this phone still says device', 'device', { label: 'Montreal', source: 'city' }, true],
  ];

  it.each(cases)('%s', (_name, stored, loc, expected) => {
    writeSource(stored);
    expect(canChangeCity(loc)).toBe(expected);
  });
});
