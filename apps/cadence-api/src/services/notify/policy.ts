/**
 * Notification policy — the deterministic "may we send this, right now?" decision.
 *
 * Pure and I/O-free so the hard cases are unit-testable: a quiet window that wraps midnight, a
 * user in a timezone where "9pm local" is tomorrow in UTC, and a cron tick that fires late.
 *
 * The bias throughout is toward NOT sending. A push is unrecallable, it lands on a lock screen,
 * and Cadence's whole promise is to be a coach rather than a nag — so every ambiguous case
 * (unknown timezone, missing prefs, malformed window) resolves to "hold", never "send anyway".
 */

import { DEFAULT_NUDGE_TIER, maxPerDayForTier, tierIncludes, type NudgeTier } from '@cadence/shared';

/** Reasons a send is withheld. Persisted on the skipped row so "why didn't I get it?" is answerable. */
export type SkipReason =
  'disabled' | 'kind_muted' | 'tier' | 'quiet_hours' | 'daily_cap' | 'no_devices' | 'not_configured';

export interface NotificationPrefs {
  enabled: boolean;
  /**
   * How much the coach may say. The dial the user actually sets; `kinds` below is the per-nudge
   * escape hatch, not the setting. Cumulative — see @cadence/shared's notification catalog.
   */
  tier: NudgeTier;
  /** Local wall-clock minutes from midnight. */
  quietStartMin: number;
  quietEndMin: number;
  /** Per-kind opt-outs; an absent key means allowed. */
  kinds: Record<string, boolean>;
  maxPerDay: number;
}

export const DEFAULT_PREFS: NotificationPrefs = {
  enabled: false, // opt-in only — the OS prompt is not consent to be messaged forever
  tier: DEFAULT_NUDGE_TIER,
  quietStartMin: 21 * 60,
  quietEndMin: 7 * 60,
  kinds: {},
  maxPerDay: 3,
};

/**
 * The day's send budget: whatever the tier implies, or the stored column, whichever is SMALLER.
 *
 * The tier is the real setting — a user at `few` has asked for one thing a day at most, and that
 * must hold regardless of what 0026's default left in `max_per_day`. Taking the minimum keeps that
 * column doing the job it was added for (a blunt guard a scheduler bug cannot exceed) instead of
 * quietly becoming dead weight that nothing reads.
 */
export function effectiveMaxPerDay(prefs: NotificationPrefs): number {
  return Math.min(prefs.maxPerDay, maxPerDayForTier(prefs.tier));
}

export interface Decision {
  send: boolean;
  reason?: SkipReason;
}

/**
 * Minutes from local midnight for `now` in `timezone`.
 *
 * Uses Intl rather than offset arithmetic so DST is the platform's problem, not ours — an
 * offset cached across a DST boundary is exactly how a 9pm rule becomes an 8pm one twice a year.
 * Returns null on an unknown/invalid zone, which callers must treat as "hold".
 */
export function localMinutes(now: Date, timezone: string | null | undefined): number | null {
  const tz = timezone?.trim();
  if (!tz) return null;
  try {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: tz,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(now);
    const hour = Number(parts.find((p) => p.type === 'hour')?.value);
    const minute = Number(parts.find((p) => p.type === 'minute')?.value);
    if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
    // en-GB renders midnight as 24 in some engines; normalise so 24:00 is 00:00.
    return (hour % 24) * 60 + minute;
  } catch {
    return null;
  }
}

/**
 * True when `minutes` falls inside the quiet window. The window WRAPS: 21:00→07:00 means
 * "late evening through early morning", which is two disjoint ranges in clock arithmetic and
 * the single most likely thing to get backwards.
 *
 * A zero-length window (start === end) means no quiet hours at all, not "always quiet" — the
 * latter would silently mute a user who set both fields the same.
 */
export function inQuietHours(minutes: number, startMin: number, endMin: number): boolean {
  if (startMin === endMin) return false;
  return startMin < endMin
    ? minutes >= startMin && minutes < endMin // same-day window, e.g. 01:00→06:00
    : minutes >= startMin || minutes < endMin; // wraps midnight, e.g. 21:00→07:00
}

/** The user's local calendar date (YYYY-MM-DD) — the bucket the daily cap counts within. */
export function localDate(now: Date, timezone: string | null | undefined): string | null {
  const tz = timezone?.trim();
  if (!tz) return null;
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(now);
  } catch {
    return null;
  }
}

export interface DecisionInput {
  prefs: NotificationPrefs;
  kind: string;
  timezone: string | null | undefined;
  /** Sends already recorded for the user's LOCAL day. */
  sentToday: number;
  deviceCount: number;
  apnsConfigured: boolean;
  now: Date;
}

/**
 * The whole gate, in evaluation order. Order is deliberate: cheapest and most absolute first,
 * so the recorded reason is the most useful one. Someone who muted notifications entirely
 * should read 'disabled', not 'quiet_hours' because the tick happened to run at 3am.
 */
export function decide(input: DecisionInput): Decision {
  const { prefs, kind, timezone, sentToday, deviceCount, apnsConfigured, now } = input;

  if (!apnsConfigured) return { send: false, reason: 'not_configured' };
  if (!prefs.enabled) return { send: false, reason: 'disabled' };
  if (prefs.kinds[kind] === false) return { send: false, reason: 'kind_muted' };
  // The volume dial, above the cap and above quiet hours: a nudge the user did not ask for is not
  // "held until later", it is not wanted at all, and the recorded reason should say so. Ordering
  // it after the explicit per-kind mute keeps the more specific answer when both apply.
  if (!tierIncludes(prefs.tier, kind)) return { send: false, reason: 'tier' };
  if (deviceCount <= 0) return { send: false, reason: 'no_devices' };
  if (sentToday >= effectiveMaxPerDay(prefs)) return { send: false, reason: 'daily_cap' };

  // Unknown timezone → we cannot prove it is not the middle of their night, so we hold.
  // Treated as quiet hours rather than a distinct reason: the user-facing fix is the same
  // (share a location/timezone), and inventing a reason nobody can act on helps no one.
  const minutes = localMinutes(now, timezone);
  if (minutes == null) return { send: false, reason: 'quiet_hours' };
  if (inQuietHours(minutes, prefs.quietStartMin, prefs.quietEndMin)) {
    return { send: false, reason: 'quiet_hours' };
  }

  return { send: true };
}
