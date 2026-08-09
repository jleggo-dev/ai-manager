/* ════════════════════════════════════════════════════════════════
   On-device notification primitives (pure; no I/O, no platform)
   ════════════════════════════════════════════════════════════════ */

/**
 * The scheduling vocabulary the device speaks: a spec shape, the RRULE/time parsing that turns a
 * committed plan into one, and the ceilings iOS imposes. What gets scheduled — which nudges, in
 * which words, at which tier — lives in `./notifications/`, which builds on these.
 *
 * Why local rather than push: the plan is already on the device, so a reminder for it needs no
 * server, no APNs round trip, and no scheduler. It fires exactly on time, works offline, and
 * costs nothing on any hosting plan. Push is reserved for what only the server can know — a
 * freeze that fired overnight, tomorrow's forecast, an absence.
 *
 * Why REPEATING matters: iOS keeps at most **64 pending** local notifications per app and
 * silently drops the rest. A repeating calendar trigger occupies ONE slot and fires forever, so
 * "Mon/Wed/Fri at 7am" is three slots rather than three-per-week-until-the-cap-is-hit. A typical
 * plan lands around 5-15 slots, comfortably clear of the ceiling — which is only reachable here
 * if a plan has more than 64 distinct weekday/time pairs, and `MAX_LOCAL_NOTIFICATIONS` guards that anyway.
 */

import type { GoalArea } from './types/baseline.ts';
import type { NudgeKind } from './notifications/kinds.ts';

/** iOS's hard ceiling on pending local notifications, app-wide. */
export const IOS_PENDING_LIMIT = 64;

/**
 * Our own ceiling, deliberately below the platform's. Reminders are not the only thing that may
 * ever schedule a local notification, and going over the OS limit fails SILENTLY — the extras
 * simply never fire. Leaving headroom means a future feature cannot quietly break reminders.
 */
export const MAX_LOCAL_NOTIFICATIONS = 48;

/** iOS weekday numbering: 1 = Sunday … 7 = Saturday (NOT 0-based, and NOT Monday-first). */
export type IosWeekday = 1 | 2 | 3 | 4 | 5 | 6 | 7;

export interface LocalNotificationSpec {
  /** Stable across re-syncs so rescheduling replaces rather than duplicates. */
  id: number;
  /** Which nudge this is — carried through to the device so a tap knows what it answered. */
  kind: NudgeKind;
  /** The activity this is about; empty for the plan-level nudges that belong to no single one. */
  activityId: string;
  title: string;
  body: string;
  hour: number;
  minute: number;
  /**
   * Weekly repeat weekday, or null for a one-shot.
   *
   * Both trigger shapes are needed and neither substitutes for the other. A weekly repeat is how a
   * recurring session gets a reminder forever from a single OS slot. A one-shot is how anything
   * that depends on TODAY works at all — yesterday's count, a waypoint date, whether something is
   * still unlogged this evening. A repeat cannot know any of that: it was scheduled once and fires
   * on a calendar, so a "still fits" nudge on a repeat would keep firing on evenings it was wrong
   * about. One-shots are re-derived on every plan sync instead.
   */
  weekday: IosWeekday | null;
  /** One-shot calendar date (YYYY-MM-DD); null for a weekly repeat. Exactly one of the two is set. */
  date: string | null;
  /** iOS category id registering this nudge's long-press actions, when it has any. */
  actionTypeId?: string;
  /**
   * Payload composed at SCHEDULE time and carried on the notification — notably the pre-computed
   * lighter version of today. Never computed when the button is tapped: a tap arrives with the app
   * cold and possibly offline, and a plan worked out in that moment is worked out from whatever
   * was cached.
   */
  extra?: Record<string, unknown>;
}

export interface SchedulableActivity {
  activity_id: string;
  title: string;
  schedule: { recurrence: string; time_of_day?: string };
  /** The goal area behind this activity, when known — picks the copy register, never shown. */
  area?: GoalArea | null;
  /** The activity's free-text category, a second (weaker) signal for the same choice. */
  category?: string | null;
}

/** RRULE BYDAY tokens → iOS weekday numbers. */
const BYDAY_TO_IOS: Record<string, IosWeekday> = { SU: 1, MO: 2, TU: 3, WE: 4, TH: 5, FR: 6, SA: 7 };

/**
 * Parse `time_of_day` into hour/minute. Accepts "07:00", "7:00", "0700", "7". Anything else —
 * including the empty string and prose like "morning" — yields null, and the caller then skips
 * the activity rather than inventing a time. A reminder at a guessed hour is worse than none.
 */
export function parseTimeOfDay(value: string | undefined | null): { hour: number; minute: number } | null {
  const raw = (value ?? '').trim();
  if (!raw) return null;
  const m = /^(\d{1,2})(?::?(\d{2}))?$/.exec(raw);
  if (!m) return null;
  const hour = Number(m[1]);
  const minute = m[2] ? Number(m[2]) : 0;
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) return null;
  if (!Number.isInteger(minute) || minute < 0 || minute > 59) return null;
  return { hour, minute };
}

/**
 * Weekdays an RRULE fires on.
 *
 * Handles the two forms the planner actually emits: `FREQ=WEEKLY;BYDAY=MO,WE,FR` and a bare
 * `FREQ=DAILY` (all seven). Deliberately NOT a general RRULE engine — INTERVAL, COUNT, UNTIL,
 * BYMONTHDAY and the rest are unsupported, and anything unrecognised returns an empty list so
 * the activity is skipped. A partial RRULE implementation that guesses would put reminders on
 * the wrong days, which is worse than no reminder at all.
 */
export function weekdaysFromRrule(rrule: string | undefined | null): IosWeekday[] {
  const text = (rrule ?? '').toUpperCase();
  if (!text) return [];

  // Unsupported modifiers change WHICH occurrences fire; a weekly repeat would be wrong.
  if (/\b(INTERVAL|COUNT|UNTIL|BYMONTHDAY|BYSETPOS|BYWEEKNO|BYYEARDAY)\s*=/.test(text)) return [];

  const byday = /BYDAY=([A-Z,]+)/.exec(text);
  if (byday?.[1]) {
    const days = byday[1]
      .split(',')
      .map((d) => BYDAY_TO_IOS[d.trim()])
      .filter((d): d is IosWeekday => d !== undefined);
    return [...new Set(days)].sort((a, b) => a - b);
  }
  if (/FREQ=DAILY/.test(text)) return [1, 2, 3, 4, 5, 6, 7];
  // FREQ=WEEKLY with no BYDAY is ambiguous (which day?) — skip rather than guess.
  return [];
}

/**
 * Deterministic id per (activity, weekday), so a re-sync REPLACES the same notification instead
 * of stacking duplicates. Must be a positive 32-bit int — that is what the iOS API accepts.
 *
 * A hash can collide; the consequence here is one reminder overwriting another, which is why the
 * caller cancels everything it owns before rescheduling rather than relying on ids alone.
 */
export function localNotificationId(activityId: string, weekday: number): number {
  let h = 2166136261; // FNV-1a
  const key = `${activityId}:${weekday}`;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 2147483646) + 1; // 1..2147483646 — positive, fits a 32-bit signed int
}

/**
 * Minutes-from-midnight for a spec's own clock time — the arithmetic the quiet-hours clamp and the
 * ordering both need, in one place so they cannot disagree about what "before" means.
 */
export function specMinutes(spec: Pick<LocalNotificationSpec, 'hour' | 'minute'>): number {
  return spec.hour * 60 + spec.minute;
}

/** Shift a wall-clock minute count by an offset, wrapping the day. Used to place a nudge relative
 *  to something else on the clock (15 minutes before a session, 45 before quiet hours). */
export function shiftMinutes(minutes: number, delta: number): { hour: number; minute: number } {
  const m = (((minutes + delta) % 1440) + 1440) % 1440;
  return { hour: Math.floor(m / 60), minute: m % 60 };
}
