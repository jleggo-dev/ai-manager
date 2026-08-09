/**
 * The producers all decide "is it the right day, in the right place, at the right hour?" and every
 * one of those is invisible from a single timezone. These are the cases that only appear once
 * someone in Auckland or Los Angeles installs the app.
 */
import { describe, it, expect } from 'vitest';
import { addDays, daysBetween, inMorningWindow, localHour, userToday, zonedTimeToUtc } from './clock.ts';

describe('addDays / daysBetween', () => {
  it('crosses month and year boundaries', () => {
    expect(addDays('2026-08-31', 1)).toBe('2026-09-01');
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('counts whole days between dates', () => {
    expect(daysBetween('2026-08-01', '2026-08-04')).toBe(3);
    expect(daysBetween('2026-08-04', '2026-08-01')).toBe(-3);
    expect(daysBetween('2026-02-26', '2026-03-05')).toBe(7);
  });

  it('degrades rather than throwing on garbage', () => {
    expect(addDays('nonsense', 1)).toBe('nonsense');
    expect(Number.isNaN(daysBetween('nonsense', '2026-08-01'))).toBe(true);
  });
});

describe('userToday', () => {
  it('is the user’s calendar day, not the server’s', () => {
    const t = new Date('2026-08-07T23:30:00Z');
    expect(userToday(t, 'UTC')).toBe('2026-08-07');
    expect(userToday(t, 'Asia/Tokyo')).toBe('2026-08-08'); // already tomorrow there
    expect(userToday(t, 'America/Los_Angeles')).toBe('2026-08-07');
  });

  it('is null for an unknown zone, so the caller holds', () => {
    expect(userToday(new Date(), null)).toBeNull();
    expect(userToday(new Date(), 'Not/AZone')).toBeNull();
  });
});

describe('inMorningWindow', () => {
  it('is 07:00 to noon, local', () => {
    const at = (iso: string) => new Date(iso);
    expect(inMorningWindow(at('2026-08-07T08:00:00Z'), 'UTC')).toBe(true);
    expect(inMorningWindow(at('2026-08-07T06:59:00Z'), 'UTC')).toBe(false);
    expect(inMorningWindow(at('2026-08-07T12:00:00Z'), 'UTC')).toBe(false);
  });

  it('is why a freeze recorded at midnight does not buzz until morning', () => {
    expect(inMorningWindow(new Date('2026-08-07T23:59:00Z'), 'UTC')).toBe(false);
  });

  it('holds on an unknown zone — we cannot prove it is morning', () => {
    expect(inMorningWindow(new Date('2026-08-07T08:00:00Z'), null)).toBe(false);
  });
});

describe('zonedTimeToUtc', () => {
  it('resolves a local wall-clock session to the right instant', () => {
    // 07:00 in London during BST is 06:00Z.
    expect(zonedTimeToUtc('2026-08-10', 7, 0, 'Europe/London')?.toISOString()).toBe('2026-08-10T06:00:00.000Z');
    // …and 07:00Z in January, when the same clock reads GMT.
    expect(zonedTimeToUtc('2026-01-10', 7, 0, 'Europe/London')?.toISOString()).toBe('2026-01-10T07:00:00.000Z');
  });

  it('is right on the side of a DST change, which one offset lookup gets wrong', () => {
    // Clocks go forward in the UK on 2026-03-29; an evening session that day is BST already.
    expect(zonedTimeToUtc('2026-03-29', 18, 0, 'Europe/London')?.toISOString()).toBe('2026-03-29T17:00:00.000Z');
  });

  it('handles zones ahead of and behind UTC', () => {
    expect(zonedTimeToUtc('2026-08-10', 7, 0, 'Asia/Tokyo')?.toISOString()).toBe('2026-08-09T22:00:00.000Z');
    expect(zonedTimeToUtc('2026-08-10', 7, 0, 'America/New_York')?.toISOString()).toBe('2026-08-10T11:00:00.000Z');
  });

  it('returns null rather than pretending an unknown zone is UTC', () => {
    expect(zonedTimeToUtc('2026-08-10', 7, 0, null)).toBeNull();
    expect(zonedTimeToUtc('2026-08-10', 7, 0, 'Not/AZone')).toBeNull();
    expect(zonedTimeToUtc('nonsense', 7, 0, 'UTC')).toBeNull();
  });
});

describe('localHour', () => {
  it('reads the hour off the user’s clock', () => {
    expect(localHour(new Date('2026-08-10T06:00:00Z'), 'Europe/London')).toBe(7);
    expect(localHour(new Date('2026-08-10T06:00:00Z'), null)).toBeNull();
  });
});
