/* ════════════════════════════════════════════════════════════════
   Plan + prefs → the LOCAL nudge set the device should be holding
   ════════════════════════════════════════════════════════════════ */

import type { GoalArea } from '../types/baseline.ts';
import {
  MAX_LOCAL_NOTIFICATIONS,
  localNotificationId,
  parseTimeOfDay,
  shiftMinutes,
  specMinutes,
  weekdaysFromRrule,
  type IosWeekday,
  type LocalNotificationSpec,
  type SchedulableActivity,
} from '../local-notifications.ts';
import { categoryForKind } from './actions.ts';
import { nudgeCopy } from './copy.ts';
import { tierIncludes, type NudgeKind, type NudgeTier } from './kinds.ts';
import { nudgeRegister } from './pillar.ts';

/**
 * The device holds a SET of nudges, not one reminder per activity.
 *
 * The old builder answered "when is each thing scheduled?" and posted that back. This one answers
 * "what is worth saying, to this person, at their chosen volume?" — which is a different question
 * with a different answer on most days, and usually a much shorter one.
 *
 * Three invariants hold by construction rather than by care downstream:
 *
 *   TIER      — a kind outside the user's tier is never built, so it cannot leak through a bug in
 *               a later filter. The dial is enforced where the notification is made.
 *   QUIET     — every candidate is checked against the quiet window before it is emitted. Nothing
 *               inside quiet hours is ever handed to the OS, so there is no runtime path on which
 *               a local nudge fires at 2am, even if the app is never opened again.
 *   CEILING   — the result is sorted and capped below the iOS limit, which fails SILENTLY when
 *               exceeded (the extras simply never fire, with no error anywhere).
 */

/** ~15 minutes before a timed session: long enough to move, short enough to still be "now". */
const ALMOST_TIME_LEAD_MIN = 15;

/** ~45 minutes before quiet hours — the nudge itself then says "about 40 minutes", rounded. */
const QUIET_LEAD_MIN = 45;

/** The morning slot for nudges that belong to "when you wake up" rather than to a clock time. */
const DEFAULT_MORNING_MIN = 8 * 60;

export interface NudgeWaypoint {
  /** The day being counted toward, in the user's words: "race day", "morning pages". */
  label: string;
  /** YYYY-MM-DD this waypoint should be announced on. */
  date: string;
  /** 6, 3 or 1 week out; 0 for the day before. */
  weeksOut: number;
  area?: GoalArea | null;
  /** A plan fact worth carrying: "Taper starts on the 24th." */
  detail?: string;
  /** Total span of the commitment, when known. */
  totalDays?: number;
}

export interface NudgePlanInput {
  tier: NudgeTier;
  /** Quiet window in local wall-clock minutes; may wrap midnight. */
  quietStartMin: number;
  quietEndMin: number;
  /** Today on the device's own clock. */
  today: string;
  todayWeekday: IosWeekday;
  /** Minutes past local midnight, right now — decides whether today's slots are still ahead. */
  nowMinutes: number;
  activities: SchedulableActivity[];
  /** The committed plan's weekly check-in, when there is one. */
  weeklyCheckin?: { activityId: string; weekday: IosWeekday; hour?: number; minute?: number } | null;
  /** Today's still-unlogged flexible (untimed) activity — the whole trigger for before_quiet_hours. */
  flexibleToday?: SchedulableActivity | null;
  /** Yesterday's count, supplied ONLY when neither a freeze-save nor a detour already explains it. */
  yesterday?: { done: number; planned: number } | null;
  /** Waypoints resolved from goals. The caller passes none during a detour. */
  waypoints?: NudgeWaypoint[];
  /** The coach-prepared lighter version of today, carried in morning_adjust's payload. */
  lighterVariant?: Record<string, unknown> | null;
}

/** Distinct id per (kind, subject, day) so two nudges about the same activity cannot collide. */
function specId(kind: NudgeKind, subject: string, day: string | number): number {
  return localNotificationId(`${kind}:${subject}:${day}`, typeof day === 'number' ? day : 0);
}

/** True when a wall-clock minute falls inside the quiet window. Mirrors the server's `inQuietHours`
 *  exactly, including the "start === end means no quiet hours" reading — a user who set both the
 *  same wanted no window, not permanent silence. */
export function withinQuietHours(minutes: number, startMin: number, endMin: number): boolean {
  if (startMin === endMin) return false;
  return startMin < endMin ? minutes >= startMin && minutes < endMin : minutes >= startMin || minutes < endMin;
}

/** The morning slot, pushed past the end of quiet hours so a 9am riser is not woken at 8. */
function morningMinutes(input: NudgePlanInput): number {
  return Math.max(DEFAULT_MORNING_MIN, input.quietEndMin);
}

/** Emit a spec unless the tier forbids the kind or the clock lands inside quiet hours. */
function emit(
  out: LocalNotificationSpec[],
  input: NudgePlanInput,
  spec: Omit<LocalNotificationSpec, 'actionTypeId'>,
): void {
  if (!tierIncludes(input.tier, spec.kind)) return;
  if (withinQuietHours(specMinutes(spec), input.quietStartMin, input.quietEndMin)) return;
  const category = categoryForKind(spec.kind);
  out.push(category ? { ...spec, actionTypeId: category } : spec);
}

/** almost_time — one repeating slot per (timed activity × weekday it recurs on). */
function addAlmostTime(out: LocalNotificationSpec[], input: NudgePlanInput): void {
  for (const a of input.activities) {
    const time = parseTimeOfDay(a.schedule?.time_of_day);
    if (!time) continue; // untimed activities get no countdown — there is nothing to count to
    const at = shiftMinutes(time.hour * 60 + time.minute, -ALMOST_TIME_LEAD_MIN);
    const register = nudgeRegister({ area: a.area, category: a.category, title: a.title });
    for (const weekday of weekdaysFromRrule(a.schedule?.recurrence)) {
      const copy = nudgeCopy({
        kind: 'almost_time',
        activityId: a.activity_id,
        activityTitle: a.title,
        hour: at.hour,
        minute: at.minute,
        register,
        weekday,
      });
      emit(out, input, {
        id: specId('almost_time', a.activity_id, weekday),
        kind: 'almost_time',
        activityId: a.activity_id,
        ...copy,
        weekday,
        date: null,
        hour: at.hour,
        minute: at.minute,
      });
    }
  }
}

/** weekly_checkin — a repeating morning slot on the day the check-in sits on the plan. */
function addWeeklyCheckin(out: LocalNotificationSpec[], input: NudgePlanInput): void {
  const c = input.weeklyCheckin;
  if (!c) return;
  const at = c.hour != null ? { hour: c.hour, minute: c.minute ?? 0 } : shiftMinutes(morningMinutes(input), 0);
  emit(out, input, {
    id: specId('weekly_checkin', c.activityId, c.weekday),
    kind: 'weekly_checkin',
    activityId: c.activityId,
    ...nudgeCopy({ kind: 'weekly_checkin', weekday: c.weekday }),
    weekday: c.weekday,
    date: null,
    ...at,
  });
}

/** before_quiet_hours — a ONE-SHOT for today, and only while the slot is still ahead of now. */
function addBeforeQuietHours(out: LocalNotificationSpec[], input: NudgePlanInput): void {
  const a = input.flexibleToday;
  if (!a) return;
  const at = shiftMinutes(input.quietStartMin, -QUIET_LEAD_MIN);
  const minutes = at.hour * 60 + at.minute;
  if (minutes <= input.nowMinutes) return; // already past — a nudge about tonight, sent tonight
  emit(out, input, {
    id: specId('before_quiet_hours', a.activity_id, input.today),
    kind: 'before_quiet_hours',
    activityId: a.activity_id,
    ...nudgeCopy({
      kind: 'before_quiet_hours',
      activityId: a.activity_id,
      activityTitle: a.title,
      minutesUntilQuiet: QUIET_LEAD_MIN,
      register: nudgeRegister({ area: a.area, category: a.category, title: a.title }),
      weekday: input.todayWeekday,
    }),
    weekday: null,
    date: input.today,
    ...at,
  });
}

/** morning_adjust — a ONE-SHOT this morning about yesterday, dropped once the morning has gone.
 *  Telling someone at 3pm how yesterday went is a verdict; telling them at 8am is an offer. */
function addMorningAdjust(out: LocalNotificationSpec[], input: NudgePlanInput): void {
  const y = input.yesterday;
  if (!y || y.planned <= 0 || y.done >= y.planned) return;
  const minutes = morningMinutes(input);
  if (minutes <= input.nowMinutes) return;
  emit(out, input, {
    id: specId('morning_adjust', input.today, input.todayWeekday),
    kind: 'morning_adjust',
    activityId: '',
    ...nudgeCopy({ kind: 'morning_adjust', done: y.done, planned: y.planned, weekday: input.todayWeekday }),
    weekday: null,
    date: input.today,
    ...shiftMinutes(minutes, 0),
    // The lighter day travels WITH the notification. Composing it here, while the app has the plan
    // in hand, is the difference between "Lighten today" meaning something and it meaning whatever
    // was cached when the button was pressed.
    extra: { lighter: input.lighterVariant ?? null, yesterday: y },
  });
}

/** milestone_waypoint — one-shots on the waypoint dates the caller resolved from the goal. */
function addWaypoints(out: LocalNotificationSpec[], input: NudgePlanInput): void {
  const minutes = morningMinutes(input);
  for (const w of input.waypoints ?? []) {
    if (w.date < input.today) continue;
    if (w.date === input.today && minutes <= input.nowMinutes) continue;
    emit(out, input, {
      id: specId('milestone_waypoint', w.label, w.date),
      kind: 'milestone_waypoint',
      activityId: '',
      ...nudgeCopy({
        kind: 'milestone_waypoint',
        label: w.label,
        weeksOut: w.weeksOut,
        register: nudgeRegister({ area: w.area, title: w.label }),
        detail: w.detail,
        totalDays: w.totalDays,
        weekday: input.todayWeekday,
      }),
      weekday: null,
      date: w.date,
      ...shiftMinutes(minutes, 0),
    });
  }
}

/**
 * Order for truncation, not for display.
 *
 * Dated one-shots come first, soonest first: they are about a specific day and are worthless a day
 * later, whereas a weekly repeat that loses its slot this sync gets it back on the next one. Then
 * repeats by weekday and time, so a cap drops the far end of the week predictably rather than an
 * arbitrary subset.
 */
function byUrgency(a: LocalNotificationSpec, b: LocalNotificationSpec): number {
  if (a.date && b.date) return a.date.localeCompare(b.date) || specMinutes(a) - specMinutes(b);
  if (a.date) return -1;
  if (b.date) return 1;
  return (a.weekday ?? 0) - (b.weekday ?? 0) || specMinutes(a) - specMinutes(b);
}

/**
 * Build the full local nudge set. Never throws: this runs on every plan load, so a malformed
 * activity or a missing field must degrade to one fewer notification, never to a failed render.
 */
export function buildLocalNudges(input: NudgePlanInput): LocalNotificationSpec[] {
  const out: LocalNotificationSpec[] = [];
  addWeeklyCheckin(out, input);
  addAlmostTime(out, input);
  addWaypoints(out, input);
  addBeforeQuietHours(out, input);
  addMorningAdjust(out, input);
  out.sort(byUrgency);
  return out.slice(0, MAX_LOCAL_NOTIFICATIONS);
}
