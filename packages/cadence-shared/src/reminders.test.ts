/**
 * The valuable cases here are the ones that put a reminder on the WRONG day or at a guessed
 * time — both of which look fine in code review and only surface as a phone buzzing at 7am on
 * a rest day.
 */
import { describe, it, expect } from 'vitest';
import {
  buildReminders,
  parseTimeOfDay,
  reminderId,
  weekdaysFromRrule,
  MAX_REMINDERS,
  IOS_PENDING_LIMIT,
  type ReminderActivity,
} from './reminders.ts';

const act = (over: Partial<ReminderActivity> = {}): ReminderActivity => ({
  activity_id: 'a1',
  title: 'Easy run',
  schedule: { recurrence: 'FREQ=WEEKLY;BYDAY=MO,WE,FR', time_of_day: '07:00' },
  ...over,
});

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

describe('reminderId', () => {
  it('is stable, so a re-sync replaces rather than duplicates', () => {
    expect(reminderId('a1', 2)).toBe(reminderId('a1', 2));
  });

  it('differs per activity and per weekday', () => {
    expect(reminderId('a1', 2)).not.toBe(reminderId('a1', 3));
    expect(reminderId('a1', 2)).not.toBe(reminderId('a2', 2));
  });

  it('always yields a positive 32-bit int, which is what the iOS API accepts', () => {
    for (const key of ['a', 'zzzz', 'activity-with-a-very-long-uuid-like-id', '🙂']) {
      for (const wd of [1, 7]) {
        const id = reminderId(key, wd);
        expect(Number.isInteger(id)).toBe(true);
        expect(id).toBeGreaterThan(0);
        expect(id).toBeLessThanOrEqual(2147483647);
      }
    }
  });
});

describe('buildReminders', () => {
  it('produces ONE spec per activity-weekday — repeating, not per occurrence', () => {
    const out = buildReminders([act()]);
    expect(out).toHaveLength(3); // Mon/Wed/Fri, repeating forever = 3 iOS slots
    expect(out.map((r) => r.weekday)).toEqual([2, 4, 6]);
    expect(out.every((r) => r.hour === 7 && r.minute === 0)).toBe(true);
  });

  it('skips activities with an unusable time or recurrence, without throwing', () => {
    const out = buildReminders([
      act({ activity_id: 'ok' }),
      act({ activity_id: 'no-time', schedule: { recurrence: 'FREQ=DAILY', time_of_day: 'whenever' } }),
      act({ activity_id: 'no-rule', schedule: { recurrence: 'FREQ=WEEKLY', time_of_day: '07:00' } }),
    ]);
    expect([...new Set(out.map((r) => r.activityId))]).toEqual(['ok']);
  });

  it('orders by weekday then time, so truncation drops the far end predictably', () => {
    const out = buildReminders([
      act({ activity_id: 'pm', title: 'Lift', schedule: { recurrence: 'FREQ=WEEKLY;BYDAY=MO', time_of_day: '18:00' } }),
      act({ activity_id: 'am', title: 'Run', schedule: { recurrence: 'FREQ=WEEKLY;BYDAY=MO', time_of_day: '06:00' } }),
      act({ activity_id: 'we', title: 'Swim', schedule: { recurrence: 'FREQ=WEEKLY;BYDAY=WE', time_of_day: '06:00' } }),
    ]);
    expect(out.map((r) => r.activityId)).toEqual(['am', 'pm', 'we']);
  });

  it('caps below the iOS ceiling — going over it fails SILENTLY on device', () => {
    expect(MAX_REMINDERS).toBeLessThan(IOS_PENDING_LIMIT);
    const many = Array.from({ length: 40 }, (_, i) =>
      act({ activity_id: `a${i}`, schedule: { recurrence: 'FREQ=DAILY', time_of_day: '07:00' } }),
    );
    expect(buildReminders(many)).toHaveLength(MAX_REMINDERS); // 40 × 7 = 280 → capped
  });

  it('writes copy that states the fact and never implies a failure', () => {
    const bodies = buildReminders([act({ title: 'Easy run' })]).map((r) => r.body);
    expect(bodies[0]).toBe('Easy run today.');
    // Brand: count what happened, never what broke — no streak-shame, no implied failure.
    for (const b of bodies) expect(b).not.toMatch(/miss|streak|don't|behind|fail/i);
  });

  it('handles an empty plan', () => {
    expect(buildReminders([])).toEqual([]);
  });
});
