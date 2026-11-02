import { describe, expect, it } from 'vitest';
import type { WeekEntry } from '../../../lib/api.ts';
import { asToggled, dayLabel, dayLetter } from './weekView.ts';

describe('dayLabel', () => {
  it.each([
    ['2026-11-01', 0, 'Today'],
    ['2026-11-02', 1, 'Tomorrow'],
    ['2026-11-03', 2, 'Tue · Nov 3'],
    ['2027-01-01', 6, 'Fri · Jan 1'], // a year boundary does not slip a day
  ])('%s at position %i → %s', (date, position, label) => {
    expect(dayLabel(date, position)).toBe(label);
  });

  it('gives the strip one letter a day', () => {
    expect(['2026-11-01', '2026-11-02', '2026-11-04'].map(dayLetter)).toEqual(['S', 'M', 'W']);
  });
});

describe('asToggled — a change switched off shows the plan as it is now', () => {
  const base = { title: 'Easy run', time: '6:15 am' };
  it.each<[string, WeekEntry, boolean, WeekEntry | null]>([
    ['an unchanged session ignores the toggles', { ...base, kind: 'same' }, false, { ...base, kind: 'same' }],
    ['a change left on reads as itself', { ...base, kind: 'new', index: 0 }, true, { ...base, kind: 'new', index: 0 }],
    ['a session it would add disappears', { ...base, kind: 'new', index: 0 }, false, null],
    ['a session it would move away stays, unchanged', { ...base, kind: 'was', index: 0 }, false, { ...base, kind: 'same', index: 0 }],
    [
      'a retimed session goes back to its old time',
      { ...base, kind: 'changed', index: 0, was_time: '6:30 pm' },
      false,
      { ...base, time: '6:30 pm', kind: 'same', index: 0, was_time: undefined },
    ],
    ['a dropped commitment has no toggle and stays dropped', { ...base, kind: 'was' }, false, { ...base, kind: 'was' }],
  ])('%s', (_label, entry, on, expected) => {
    expect(asToggled(entry, { 0: on })).toEqual(expected);
  });
});
