/**
 * The quiet-hours cases are the point of this file. A wrapping window and a user in a
 * non-UTC zone are exactly where "don't buzz someone at 3am" quietly stops being true, and
 * neither is visible in local testing from one timezone.
 */
import { describe, it, expect } from 'vitest';
import {
  decide,
  effectiveMaxPerDay,
  inQuietHours,
  localMinutes,
  localDate,
  DEFAULT_PREFS,
  type NotificationPrefs,
} from './policy.ts';

const prefs = (over: Partial<NotificationPrefs> = {}): NotificationPrefs => ({
  ...DEFAULT_PREFS,
  enabled: true,
  ...over,
});
const base = { kind: 'session_reminder', sentToday: 0, deviceCount: 1, apnsConfigured: true };

describe('inQuietHours', () => {
  it('handles a window that WRAPS midnight (21:00 → 07:00)', () => {
    const [s, e] = [21 * 60, 7 * 60];
    expect(inQuietHours(22 * 60, s, e)).toBe(true); // 10pm — quiet
    expect(inQuietHours(3 * 60, s, e)).toBe(true); // 3am  — quiet
    expect(inQuietHours(6 * 60 + 59, s, e)).toBe(true); // 06:59 — still quiet
    expect(inQuietHours(7 * 60, s, e)).toBe(false); // 07:00 — window is end-exclusive
    expect(inQuietHours(12 * 60, s, e)).toBe(false); // midday
    expect(inQuietHours(20 * 60 + 59, s, e)).toBe(false); // 20:59 — one minute before
    expect(inQuietHours(21 * 60, s, e)).toBe(true); // 21:00 — start is inclusive
  });

  it('handles a same-day window (01:00 → 06:00)', () => {
    const [s, e] = [60, 6 * 60];
    expect(inQuietHours(3 * 60, s, e)).toBe(true);
    expect(inQuietHours(22 * 60, s, e)).toBe(false);
    expect(inQuietHours(0, s, e)).toBe(false); // midnight is OUTSIDE a 01:00→06:00 window
  });

  it('treats a zero-length window as no quiet hours, not permanent silence', () => {
    // The alternative reading would mute a user forever for setting both fields the same.
    expect(inQuietHours(3 * 60, 9 * 60, 9 * 60)).toBe(false);
  });
});

describe('localMinutes / localDate', () => {
  it('reads wall-clock time in the user’s zone, not the server’s', () => {
    const t = new Date('2026-08-07T23:30:00Z');
    expect(localMinutes(t, 'UTC')).toBe(23 * 60 + 30);
    expect(localMinutes(t, 'America/New_York')).toBe(19 * 60 + 30); // same instant, 7:30pm
    expect(localMinutes(t, 'Asia/Tokyo')).toBe(8 * 60 + 30); // next morning
  });

  it('rolls the local DATE independently of UTC', () => {
    const t = new Date('2026-08-07T23:30:00Z');
    expect(localDate(t, 'UTC')).toBe('2026-08-07');
    expect(localDate(t, 'Asia/Tokyo')).toBe('2026-08-08'); // already tomorrow
  });

  it('returns null for a missing or invalid zone rather than guessing', () => {
    expect(localMinutes(new Date(), null)).toBeNull();
    expect(localMinutes(new Date(), 'Not/AZone')).toBeNull();
    expect(localDate(new Date(), '')).toBeNull();
  });

  it('respects DST — the same UTC instant is a different local hour across the boundary', () => {
    const winter = localMinutes(new Date('2026-01-15T18:00:00Z'), 'Europe/London'); // GMT
    const summer = localMinutes(new Date('2026-07-15T18:00:00Z'), 'Europe/London'); // BST
    expect(winter).toBe(18 * 60);
    expect(summer).toBe(19 * 60);
  });
});

describe('decide', () => {
  const noon = new Date('2026-08-07T12:00:00Z');
  const threeAm = new Date('2026-08-07T03:00:00Z');

  it('sends in the clear', () => {
    expect(decide({ ...base, prefs: prefs(), timezone: 'UTC', now: noon })).toEqual({ send: true });
  });

  it('holds at 3am local, the case this whole module exists for', () => {
    expect(decide({ ...base, prefs: prefs(), timezone: 'UTC', now: threeAm })).toEqual({
      send: false,
      reason: 'quiet_hours',
    });
  });

  it('is quiet by the USER’s clock, not the server’s', () => {
    // Noon UTC is 4am in Los Angeles — sending here is the bug a UTC-only check would ship.
    expect(decide({ ...base, prefs: prefs(), timezone: 'America/Los_Angeles', now: noon }).reason).toBe('quiet_hours');
    expect(decide({ ...base, prefs: prefs(), timezone: 'Europe/London', now: noon }).send).toBe(true);
  });

  it('holds when the timezone is unknown — we cannot prove it is not their night', () => {
    expect(decide({ ...base, prefs: prefs(), timezone: null, now: noon }).reason).toBe('quiet_hours');
  });

  it('defaults to opt-OUT: the OS permission is not standing consent', () => {
    expect(DEFAULT_PREFS.enabled).toBe(false);
    expect(decide({ ...base, prefs: prefs({ enabled: false }), timezone: 'UTC', now: noon }).reason).toBe('disabled');
  });

  it('respects a per-kind mute without muting everything', () => {
    const p = prefs({ kinds: { session_reminder: false } });
    expect(decide({ ...base, prefs: p, timezone: 'UTC', now: noon }).reason).toBe('kind_muted');
    expect(decide({ ...base, prefs: p, kind: 'weekly_recap', timezone: 'UTC', now: noon }).send).toBe(true);
  });

  it('holds a kind the user\u2019s tier does not include, and says so', () => {
    // "few" is three kinds; almost_time is not one of them. The reason must be `tier` rather than
    // a cap or quiet hours, because those imply "later" and this one means "not wanted".
    const d = decide({ ...base, prefs: prefs({ tier: 'few' }), kind: 'almost_time', timezone: 'UTC', now: noon });
    expect(d).toEqual({ send: false, reason: 'tier' });
  });

  it('lets the same kind through once the dial is turned up', () => {
    expect(
      decide({ ...base, prefs: prefs({ tier: 'moderate' }), kind: 'almost_time', timezone: 'UTC', now: noon }).send,
    ).toBe(true);
  });

  it('reports an explicit per-kind mute ahead of the tier \u2014 the more specific answer wins', () => {
    const d = decide({
      ...base,
      prefs: prefs({ tier: 'few', kinds: { weather_move: false } }),
      kind: 'weather_move',
      timezone: 'UTC',
      now: noon,
    });
    expect(d.reason).toBe('kind_muted');
  });

  it('does not tier-gate a kind outside the catalog', () => {
    // The dial speaks for the nine designed nudges. Silently swallowing anything else would hide a
    // wiring bug behind a non-delivery nobody can trace.
    expect(
      decide({ ...base, prefs: prefs({ tier: 'few' }), kind: 'session_reminder', timezone: 'UTC', now: noon }).send,
    ).toBe(true);
  });

  it('derives the day\u2019s cap from the tier', () => {
    // Two at lots, one below it \u2014 regardless of what 0026 left in max_per_day.
    expect(effectiveMaxPerDay(prefs({ tier: 'lots' }))).toBe(2);
    expect(effectiveMaxPerDay(prefs({ tier: 'moderate' }))).toBe(1);
    const p = prefs({ tier: 'lots' });
    expect(decide({ ...base, prefs: p, sentToday: 1, timezone: 'UTC', now: noon }).send).toBe(true);
    expect(decide({ ...base, prefs: p, sentToday: 2, timezone: 'UTC', now: noon }).reason).toBe('daily_cap');
  });

  it('still honours a LOWER stored cap \u2014 the belt-and-braces guard keeps working', () => {
    expect(effectiveMaxPerDay(prefs({ tier: 'lots', maxPerDay: 0 }))).toBe(0);
  });

  it('enforces the daily cap', () => {
    expect(decide({ ...base, prefs: prefs({ maxPerDay: 2 }), sentToday: 2, timezone: 'UTC', now: noon }).reason).toBe(
      'daily_cap',
    );
  });

  it('does not "send" to a user with no registered devices', () => {
    expect(decide({ ...base, prefs: prefs(), deviceCount: 0, timezone: 'UTC', now: noon }).reason).toBe('no_devices');
  });

  it('reports the most ABSOLUTE reason first, so the log is actionable', () => {
    // Muted at 3am with no devices and APNs off: 'not_configured' is the operator-facing truth.
    const d = decide({
      ...base,
      prefs: prefs({ enabled: false }),
      deviceCount: 0,
      apnsConfigured: false,
      timezone: 'UTC',
      now: threeAm,
    });
    expect(d.reason).toBe('not_configured');
  });
});
