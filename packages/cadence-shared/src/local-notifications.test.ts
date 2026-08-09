/**
 * The valuable cases here are the ones that put a reminder on the WRONG day or at a guessed
 * time — both of which look fine in code review and only surface as a phone buzzing at 7am on
 * a rest day.
 */
import { describe, it, expect } from 'vitest';
import {
  parseTimeOfDay,
  localNotificationId,
  shiftMinutes,
  specMinutes,
  weekdaysFromRrule,
  MAX_LOCAL_NOTIFICATIONS,
  IOS_PENDING_LIMIT,
} from './local-notifications.ts';

describe('weekdaysFromRrule', () => {
  it('maps BYDAY to iOS numbering — Sunday is 1, not 0, and not Monday-first', () => {
    expect(weekdaysFromRrule('FREQ=WEEKLY;BYDAY=MO,WE,FR')).toEqual([2, 4, 6]);
    expect(weekdaysFromRrule('FREQ=WEEKLY;BYDAY=SU')).toEqual([1]);
    expect(weekdaysFromRrule('FREQ=WEEKLY;BYDAY=SA')).toEqual([7]);
  });

  it('expands FREQ=DAILY to all seven', () => {
    expect(weekdaysFromRrule('FREQ=DAILY')).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it('SKIPS rules whose modifiers change which occurrences fire', () => {
    // A weekly repeat would fire on weeks the rule excludes — wrong days, silently.
    expect(weekdaysFromRrule('FREQ=WEEKLY;INTERVAL=2;BYDAY=MO')).toEqual([]);
    expect(weekdaysFromRrule('FREQ=WEEKLY;BYDAY=MO;COUNT=4')).toEqual([]);
    expect(weekdaysFromRrule('FREQ=WEEKLY;BYDAY=MO;UNTIL=20261231T000000Z')).toEqual([]);
    expect(weekdaysFromRrule('FREQ=MONTHLY;BYMONTHDAY=1')).toEqual([]);
  });

  it('skips FREQ=WEEKLY with no BYDAY rather than guessing a day', () => {
    expect(weekdaysFromRrule('FREQ=WEEKLY')).toEqual([]);
  });

  it('is case-insensitive and dedupes', () => {
    expect(weekdaysFromRrule('freq=weekly;byday=mo,mo,we')).toEqual([2, 4]);
  });

  it('returns empty for missing/garbage input instead of throwing', () => {
    expect(weekdaysFromRrule(undefined)).toEqual([]);
    expect(weekdaysFromRrule('')).toEqual([]);
    expect(weekdaysFromRrule('nonsense')).toEqual([]);
  });
});

describe('parseTimeOfDay', () => {
  it('accepts the forms the planner emits', () => {
    expect(parseTimeOfDay('07:00')).toEqual({ hour: 7, minute: 0 });
    expect(parseTimeOfDay('7:30')).toEqual({ hour: 7, minute: 30 });
    expect(parseTimeOfDay('0715')).toEqual({ hour: 7, minute: 15 });
    expect(parseTimeOfDay('18')).toEqual({ hour: 18, minute: 0 });
  });

  it('refuses prose rather than inventing an hour', () => {
    // "morning" must not become 09:00 — a guessed reminder time is worse than none.
    expect(parseTimeOfDay('morning')).toBeNull();
    expect(parseTimeOfDay('')).toBeNull();
    expect(parseTimeOfDay(undefined)).toBeNull();
  });

  it('rejects out-of-range values', () => {
    expect(parseTimeOfDay('24:00')).toBeNull();
    expect(parseTimeOfDay('12:60')).toBeNull();
  });
});

describe('localNotificationId', () => {
  it('is stable, so a re-sync replaces rather than duplicates', () => {
    expect(localNotificationId('a1', 2)).toBe(localNotificationId('a1', 2));
  });

  it('differs per activity and per weekday', () => {
    expect(localNotificationId('a1', 2)).not.toBe(localNotificationId('a1', 3));
    expect(localNotificationId('a1', 2)).not.toBe(localNotificationId('a2', 2));
  });

  it('always yields a positive 32-bit int, which is what the iOS API accepts', () => {
    for (const key of ['a', 'zzzz', 'activity-with-a-very-long-uuid-like-id', '🙂']) {
      for (const wd of [1, 7]) {
        const id = localNotificationId(key, wd);
        expect(Number.isInteger(id)).toBe(true);
        expect(id).toBeGreaterThan(0);
        expect(id).toBeLessThanOrEqual(2147483647);
      }
    }
  });
});

describe('shiftMinutes / specMinutes', () => {
  it('places a nudge relative to another clock time', () => {
    expect(shiftMinutes(7 * 60, -15)).toEqual({ hour: 6, minute: 45 });
    expect(shiftMinutes(21 * 60, -45)).toEqual({ hour: 20, minute: 15 });
  });

  it('wraps the day in BOTH directions rather than going negative', () => {
    // A 00:10 session's 15-minute lead is 23:55 the night before, not minute -5.
    expect(shiftMinutes(10, -15)).toEqual({ hour: 23, minute: 55 });
    expect(shiftMinutes(23 * 60 + 50, 20)).toEqual({ hour: 0, minute: 10 });
  });

  it('round-trips through specMinutes', () => {
    expect(specMinutes(shiftMinutes(9 * 60 + 30, 0))).toBe(9 * 60 + 30);
  });
});

describe('the iOS ceiling', () => {
  it('stays below the platform limit — going over it fails SILENTLY on device', () => {
    expect(MAX_LOCAL_NOTIFICATIONS).toBeLessThan(IOS_PENDING_LIMIT);
  });
});
