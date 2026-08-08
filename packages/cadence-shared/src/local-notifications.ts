/* ════════════════════════════════════════════════════════════════
   Plan → local notification reminders (pure; no I/O, no platform)
   ════════════════════════════════════════════════════════════════ */

/**
 * Translates a committed plan's activities into **repeating** on-device reminder specs.
 *
 * Why local rather than push: the plan is already on the device, so a reminder for it needs no
 * server, no APNs round trip, and no scheduler. It fires exactly on time, works offline, and
 * costs nothing on any hosting plan. Push is reserved for what only the server can know — a
 * re-plan, a week away, a recap being ready.
 *
 * Why REPEATING matters: iOS keeps at most **64 pending** local notifications per app and
 * silently drops the rest. A repeating calendar trigger occupies ONE slot and fires forever, so
 * "Mon/Wed/Fri at 7am" is three slots rather than three-per-week-until-the-cap-is-hit. A typical
 * plan lands around 5-15 slots, comfortably clear of the ceiling — which is only reachable here
 * if a plan has more than 64 distinct weekday/time pairs, and `MAX_LOCAL_NOTIFICATIONS` guards that anyway.
 */

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
  activityId: string;
  title: string;
  body: string;
  weekday: IosWeekday;
  hour: number;
  minute: number;
}

export interface SchedulableActivity {
  activity_id: string;
  title: string;
  schedule: { recurrence: string; time_of_day?: string };
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
 * Copy for one reminder. Deterministic, not LLM-written: a notification is the lowest-context,
 * highest-stakes surface Cadence has, and it must never imply the user failed at something.
 * Brand rules that apply here — count what happened never what broke, no streak-shame, plain
 * words — leave very little room, which is exactly why this is a template and not a prompt.
 */
export function localNotificationCopy(activityTitle: string): { title: string; body: string } {
  return { title: 'Cadence', body: `${activityTitle} today.` };
}

/**
 * Expand activities into reminder specs. Activities without a usable time or an unsupported
 * recurrence are skipped silently — this runs on every plan load, so it must degrade rather
 * than throw.
 *
 * Ordered by weekday then time so truncation at MAX_LOCAL_NOTIFICATIONS drops the far end of the week
 * predictably instead of an arbitrary subset.
 */
export function buildLocalNotifications(activities: SchedulableActivity[]): LocalNotificationSpec[] {
  const out: LocalNotificationSpec[] = [];
  for (const a of activities) {
    const time = parseTimeOfDay(a.schedule?.time_of_day);
    if (!time) continue;
    for (const weekday of weekdaysFromRrule(a.schedule?.recurrence)) {
      const { title, body } = localNotificationCopy(a.title);
      out.push({
        id: localNotificationId(a.activity_id, weekday),
        activityId: a.activity_id,
        title,
        body,
        weekday,
        hour: time.hour,
        minute: time.minute,
      });
    }
  }
  out.sort((x, y) => x.weekday - y.weekday || x.hour - y.hour || x.minute - y.minute);
  return out.slice(0, MAX_LOCAL_NOTIFICATIONS);
}
