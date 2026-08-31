import { describe, expect, it } from 'vitest';
import type { ProgressPhotoSlot } from '@cadence/shared';
import { buildPhotoPair, nearestWeighInKg, nextPhotoDue } from './progress-photos.ts';

const slot = (date: string, weight_kg: number | null): ProgressPhotoSlot => ({
  date,
  weight_kg,
  url: `https://signed.example/${date}`,
});

describe('nearestWeighInKg', () => {
  const series = [
    { date: '2026-08-20', kg: 82.8 },
    { date: '2026-08-23', kg: 82.6 },
    { date: '2026-08-27', kg: 82.4 },
  ];

  it('stamps the nearest weigh-in within ±3 days', () => {
    expect(nearestWeighInKg(series, '2026-08-24')).toBe(82.6);
    expect(nearestWeighInKg(series, '2026-08-26')).toBe(82.4);
  });

  it('never invents a weight — nothing close enough means null', () => {
    expect(nearestWeighInKg(series, '2026-08-05')).toBeNull();
    expect(nearestWeighInKg([], '2026-08-24')).toBeNull();
  });

  it('breaks a same-distance tie toward the earlier reading, deterministically', () => {
    expect(nearestWeighInKg(series, '2026-08-25')).toBe(82.6); // Aug 23 and Aug 27 both 2 days out
  });
});

describe('nextPhotoDue', () => {
  it('is the last photo plus 28 days', () => {
    expect(nextPhotoDue('2026-08-24')).toBe('2026-09-21');
  });

  it('is null with no photos yet — the card invites the first one instead of counting down', () => {
    expect(nextPhotoDue(null)).toBeNull();
    expect(nextPhotoDue('not-a-date')).toBeNull();
  });
});

describe('buildPhotoPair', () => {
  it('pairs the earliest and latest, with next-due from the latest', () => {
    const pair = buildPhotoPair([slot('2026-01-05', 86.0), slot('2026-05-10', 84.1), slot('2026-08-24', 82.4)]);
    expect(pair).toEqual({
      first: slot('2026-01-05', 86.0),
      latest: slot('2026-08-24', 82.4),
      next_due: '2026-09-21',
      count: 3,
    });
  });

  it('one photo: a first slot, no latest — never the same picture twice', () => {
    const pair = buildPhotoPair([slot('2026-08-24', null)]);
    expect(pair).toEqual({ first: slot('2026-08-24', null), latest: null, next_due: '2026-09-21', count: 1 });
  });

  it('no photos: null (the caller reports the omission with evidence)', () => {
    expect(buildPhotoPair([])).toBeNull();
  });
});
