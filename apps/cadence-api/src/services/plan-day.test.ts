import { describe, it, expect } from 'vitest';
import { planDayBase } from './plan-day.ts';

/**
 * The demo bug, pinned. On Tuesday 2026-08-18 at 20:41 in Montreal the Plan screen said
 * `TODAY · WED 19 AUG`, because "today" was the UTC calendar date and UTC had already rolled over.
 * The label was the cheap half — this value also picks which day's occurrences are fetched.
 */
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);

describe('planDayBase', () => {
  it('is still Tuesday at 20:41 in Montreal, though UTC has moved on', () => {
    const now = new Date('2026-08-19T00:41:00Z'); // 20:41 Tue 18th, America/Toronto
    expect(iso(planDayBase(now, 'America/Toronto'))).toBe('2026-08-18');
    // What it used to do, and what the owner saw on stage:
    expect(iso(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))).toBe('2026-08-19');
  });

  it('rolls over at local midnight, not UTC midnight', () => {
    expect(iso(planDayBase(new Date('2026-08-19T03:59:00Z'), 'America/Toronto'))).toBe('2026-08-18');
    expect(iso(planDayBase(new Date('2026-08-19T04:01:00Z'), 'America/Toronto'))).toBe('2026-08-19');
  });

  /** The other direction: a zone AHEAD of UTC must not be held back a day. */
  it('is already tomorrow in Auckland while UTC is still yesterday', () => {
    expect(iso(planDayBase(new Date('2026-08-18T20:00:00Z'), 'Pacific/Auckland'))).toBe('2026-08-19');
  });

  /** 94 of 96 rows have no stored zone; the client's header is what saves them. */
  it('falls back to the zone the client sent when none is stored', () => {
    const now = new Date('2026-08-19T00:41:00Z');
    expect(iso(planDayBase(now, null, 'America/Toronto'))).toBe('2026-08-18');
  });

  it('prefers the stored zone over the client hint', () => {
    const now = new Date('2026-08-19T00:41:00Z');
    expect(iso(planDayBase(now, 'America/Toronto', 'Pacific/Auckland'))).toBe('2026-08-18');
  });

  it('falls back to UTC when nothing is known, rather than guessing a zone', () => {
    const now = new Date('2026-08-19T00:41:00Z');
    expect(iso(planDayBase(now, null, null))).toBe('2026-08-19');
  });

  it('ignores a zone string it cannot parse instead of throwing at the screen', () => {
    const now = new Date('2026-08-19T00:41:00Z');
    expect(iso(planDayBase(now, 'Not/AZone', 'America/Toronto'))).toBe('2026-08-18');
    expect(() => planDayBase(now, 'Not/AZone', 'Also/Bogus')).not.toThrow();
  });

  /** Days are added as `base + n * 86_400_000`, so the base must stay UTC-midnight-aligned or a
   *  DST week quietly produces a 23-hour day and two labels collide. */
  it('lands exactly on a UTC midnight so day arithmetic stays whole', () => {
    const b = planDayBase(new Date('2026-03-08T12:00:00Z'), 'America/Toronto'); // US DST spring-forward
    expect(b % 86_400_000).toBe(0);
  });
});
