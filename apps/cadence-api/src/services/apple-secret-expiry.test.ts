/**
 * The tripwire itself. Two kinds of test here:
 *  - pure unit tests of the boundary maths (fast, deterministic, pinned clock);
 *  - one LIVE test that reads the committed record and fails as the real deadline approaches.
 *
 * The live one is the point. It is expected to go red on its own one day, with no code change —
 * that is not a flaky test, it is the alarm working.
 */
import { describe, it, expect } from 'vitest';
import {
  checkExpiry,
  daysUntil,
  readExpiryRecord,
  RENEW_WINDOW_DAYS,
  EXPIRY_RECORD_PATH,
} from './apple-secret-expiry.ts';

const at = (iso: string) => new Date(`${iso}T12:00:00Z`);

describe('daysUntil', () => {
  it('counts whole days to the expiry date', () => {
    expect(daysUntil('2027-02-04', at('2027-02-01'))).toBe(3);
    expect(daysUntil('2027-02-04', at('2027-02-04'))).toBe(0);
    expect(daysUntil('2027-02-04', at('2027-02-07'))).toBe(-3);
  });

  it('is timezone-independent — a check that differs on CI and a laptop is worse than none', () => {
    // Same instant, expressed either side of UTC midnight.
    expect(daysUntil('2027-02-04', new Date('2027-02-01T23:30:00Z'))).toBe(3);
    expect(daysUntil('2027-02-04', new Date('2027-02-01T00:30:00Z'))).toBe(3);
  });

  it('throws on an unparseable date rather than silently reporting NaN days', () => {
    expect(() => daysUntil('not-a-date')).toThrow(/Unparseable/);
  });
});

describe('checkExpiry', () => {
  const record = { expiresOn: '2027-02-04', generatedOn: '2026-08-07', serviceId: 'dev.jleggo.cadence.signin' };

  it('passes with runway to spare', () => {
    expect(checkExpiry(record, at('2026-08-07')).ok).toBe(true);
  });

  it('fires exactly ON the renewal window boundary, not a day late', () => {
    const boundary = at('2027-01-05'); // 30 days out
    expect(daysUntil(record.expiresOn, boundary)).toBe(RENEW_WINDOW_DAYS);
    expect(checkExpiry(record, boundary).ok).toBe(false);
    // ...and still passes the day before it opens.
    expect(checkExpiry(record, at('2027-01-04')).ok).toBe(true);
  });

  it('reports an already-expired secret as broken NOW, not as "expiring soon"', () => {
    const past = checkExpiry(record, at('2027-03-01'));
    expect(past.ok).toBe(false);
    expect(past.message).toMatch(/EXPIRED/);
    expect(past.message).toMatch(/broken right now/);
  });

  it('always tells you how to fix it — the alarm is useless without the runbook', () => {
    const msg = checkExpiry(record, at('2027-01-20')).message;
    expect(msg).toContain('generate-apple-secret.ts');
    expect(msg).toContain('apple-signin-secret-expiry.json');
  });
});

describe('LIVE: the committed Sign in with Apple secret', () => {
  it('is recorded at all', () => {
    const record = readExpiryRecord();
    expect(
      record,
      `No expiry record at ${EXPIRY_RECORD_PATH}.\n` +
        'Run: node --import tsx apps/cadence-api/scripts/generate-apple-secret.ts\n' +
        'and commit the file it writes. Without it this tripwire cannot warn anyone.',
    ).not.toBeNull();
  });

  it('is not within the renewal window', () => {
    const record = readExpiryRecord();
    if (!record) return; // the test above owns that failure; don't double-report it
    const status = checkExpiry(record);
    expect(status.ok, status.message).toBe(true);
  });
});
