/**
 * The committed week, projected for the wrist (watch app W2 — the sync slice).
 *
 * **Every judgement about what reaches the watch is made here**, in TypeScript, unit-tested —
 * the same division of labour `workout-plan.ts` established for the WorkoutKit hand-off. The
 * Swift on both sides of WatchConnectivity decodes this payload and holds opinions about
 * nothing: which sessions a wrist can run, what each one is called, how deep the detail goes,
 * and what gets dropped to fit the transport are all decided before anything is sent.
 *
 * Three constraints shape the projection, and each one is a real limit rather than a taste:
 *
 * - **The transport is small.** `WCSession.updateApplicationContext` carries a single latest-state
 *   dictionary with a hard payload ceiling (Apple documents it in the low hundreds of KB and
 *   throws `WCErrorCodePayloadTooLarge` past it). A committed week of full prescriptions would
 *   flirt with that, so detail is carried only where it can be USED and everything is bounded.
 * - **A dead affordance on a wrist is worse than on a phone.** The watch must never show a row it
 *   cannot open: a session reaches the wrist as playable, or it reaches it as a row that says
 *   what it is and nothing more. `detailed` records which it is, so the watch never has to guess.
 * - **Count what happened.** Subtitles say what a session IS, never what is left of it, and a
 *   past day carries its own outcome so the week face can draw what happened without arithmetic.
 */
import type { OccurrenceSession, OccurrenceStatus, SessionBlock, SessionItem } from './types/occurrence.ts';
import { singleSetPlan, intervalTotalSeconds, type IntervalPlan } from './interval.ts';
import { composeWorkoutPlan, inferActivity, type WorkoutPlanSpec } from './workout-plan.ts';
import { activityIsTracked, activitySpec, type ActivityLocation } from './workout-activities.ts';

/* ── Bounds ───────────────────────────────────────────────────────────────────────────────── */

/** The payload never carries more than a committed week; `/plan` itself only ever shows ±7 days. */
export const WATCH_MAX_DAYS = 8;
/** Days whose prescriptions ride along in full. Today plus tomorrow is what a wrist can act on;
 *  the rest of the week is rows, and the next sync (which happens on every plan read) deepens
 *  them as they come into range. This is the single biggest lever on payload size. */
export const WATCH_DETAIL_DAYS = 2;
export const WATCH_MAX_SESSIONS_PER_DAY = 8;
export const WATCH_MAX_BLOCKS = 6;
export const WATCH_MAX_ITEMS_PER_BLOCK = 12;
/** Names are shown on a 41mm screen; anything past this is a wrapped mess, not information. */
export const WATCH_MAX_NAME_CHARS = 48;

/**
 * The byte ceiling the payload is actually held to.
 *
 * The count caps above bound the SHAPE; this bounds the SIZE, and size is what the transport
 * refuses. `updateApplicationContext` throws `WCErrorCodePayloadTooLarge` past its limit and then
 * delivers NOTHING — so a pathological week must lose detail rather than lose the sync. 48KB sits
 * far under Apple's documented ceiling and far above any real week (a full today+tomorrow with
 * six blocks apiece measures in single-digit KB).
 */
export const WATCH_MAX_PAYLOAD_BYTES = 48_000;

/** Payload format. The watch refuses a version it does not know rather than decoding a guess —
 *  a phone that updated ahead of its watch is the ordinary case, not an error. */
export const WATCH_PAYLOAD_VERSION = 1;

/* ── The shapes that cross the wire ───────────────────────────────────────────────────────── */

/**
 * Which face opens a session — the four the watch has, not the coach's taxonomy.
 *
 * `tracked` is a continuous measured effort (a run, a ride, a swim, a row). Our own live session
 * runs it with distance, pace and heart rate; Apple's Workout app is offered as an alternative
 * rather than being the destination. It was called `run` until native tracking landed, which was
 * wrong the moment a cycling session used it.
 */
export type WatchSessionKind = 'interval' | 'strength' | 'sit' | 'tracked';

export interface WatchExerciseSpec {
  name: string;
  sets?: number;
  reps?: number;
  /** Pre-formatted by the phone ("24 kg") — the watch does no unit conversion and holds no prefs. */
  load?: string;
  durationSec?: number;
}

export interface WatchBlockSpec {
  label: string;
  items: WatchExerciseSpec[];
}

/** The coach's flat interval five, clamped — the watch's `IntervalEngine` re-derives phases from
 *  these exactly as `expandIntervalPhases` does, so both sides walk the same clock. */
export interface WatchIntervalSpec {
  warmupSec: number;
  workSec: number;
  recoverSec: number;
  rounds: number;
  cooldownSec: number;
}

export interface WatchSessionSpec {
  occurrenceId: string;
  title: string;
  kind: WatchSessionKind;
  /** Minutes of the session as prescribed — for the row, never a countdown. */
  minutes: number;
  subtitle: string;
  status: OccurrenceStatus;
  /** Whether the prescription rode along. False = a row the watch shows but must not offer to
   *  start; the wrist says "open it on your phone" instead of opening an empty player. */
  detailed: boolean;
  /**
   * The activity, from `inferActivity` — carried on EVERY session, not only ones that composed a
   * WorkoutKit spec.
   *
   * The live tracker needs it to configure `HKWorkoutSession`, and reading it off the composed
   * workout would have meant an "Evening run" with no prescription tracking as `.other` with no
   * route: a run filed in Health as an unnamed workout, which is the exact defect the wider
   * vocabulary was built to fix.
   */
  activity: string;
  /** Where it happens, which is what decides whether a route is recorded at all. */
  location: ActivityLocation;
  blocks?: WatchBlockSpec[];
  interval?: WatchIntervalSpec;
  /** `tracked` only — the composed WorkoutKit spec, so the wrist can offer Apple's Workout app
   *  as an ALTERNATIVE to running it ourselves. Built by `composeWorkoutPlan`, the same tested
   *  composer the phone's hand-off row uses. Absent when the session did not compose to something
   *  Apple can run — our own tracker still handles it. */
  workout?: WorkoutPlanSpec;
}

export interface WatchDaySpec {
  date: string;
  weekday: string;
  isToday: boolean;
  sessions: WatchSessionSpec[];
}

export interface WatchWeekPayload {
  version: number;
  generatedAt: string;
  days: WatchDaySpec[];
}

/** One occurrence as the projection needs it — the intersection of what `/plan`'s week rows and
 *  the occurrence store already hold, so no caller has to fetch anything new to build a payload. */
export interface WatchOccurrenceInput {
  occurrence_id: string;
  title: string;
  date: string;
  status: OccurrenceStatus;
  /** 'system' rows are the app's own tracking anchors (the per-meal food log, the weigh-in), not
   *  things anybody performs. They have no face on the wrist and are dropped — see `isForWrist`. */
  kind?: 'user' | 'system';
  duration_min?: number | null;
  session?: OccurrenceSession | null;
}

export interface WatchWeekInput {
  todayISO: string;
  occurrences: WatchOccurrenceInput[];
  /** Stamped by the caller. Passed in rather than read from the clock so the projection stays
   *  pure and its tests stay deterministic. */
  generatedAt: string;
}

/* ── Classification ───────────────────────────────────────────────────────────────────────── */

/** Kept in lockstep with `workout-plan.ts` — the same two sets, for the same reasons. A sit is
 *  not exercise; an inert step carries no work at all. */
const MINDFUL_TOOLS = new Set(['breathing', 'meditate', 'grounding', 'feeling_log', 'journal']);
const INERT_TOOLS = new Set(['read', 'checkoff', 'photo']);

/** An item is an interval step if it carries `interval_work_sec`, tagged or not — the same
 *  load-bearing rule the phone player and the composer use. A model that filled the numbers and
 *  forgot the tag still prescribed an interval. */
function isIntervalItem(i: SessionItem): boolean {
  return i.tool === 'interval' || typeof i.interval_work_sec === 'number';
}

function isMindful(i: SessionItem): boolean {
  return !!i.tool && MINDFUL_TOOLS.has(i.tool);
}

function allItems(session: OccurrenceSession | null | undefined): SessionItem[] {
  return session?.blocks?.flatMap((b) => b.items ?? []) ?? [];
}

/**
 * Which of the four faces opens this session.
 *
 * Order is the whole design. Interval wins first because the flat five are an unambiguous
 * prescription and the player is the app's hero face. A session made only of mind steps is a
 * sit — checked BEFORE the hand-off words so "walking meditation" opens the sit, not Apple's
 * Workout app. Distance-over-ground hands off. Everything else is a strength timer, which is
 * also the honest fallback for a session with no prescription at all: it is the one face that
 * degrades to a list of names without lying about what it has.
 */
export function watchSessionKind(title: string, session: OccurrenceSession | null | undefined): WatchSessionKind {
  const items = allItems(session);
  if (items.some(isIntervalItem)) return 'interval';
  if (items.length > 0 && items.every((i) => isMindful(i) || (i.tool && INERT_TOOLS.has(i.tool)))) {
    if (items.some(isMindful)) return 'sit';
  }
  // Distance is decisive on its own: work prescribed by how far is a measured effort, whatever it
  // is called.
  if (items.some((i) => typeof i.distance_km === 'number' && i.distance_km > 0)) return 'tracked';
  // Otherwise ask the SAME table the composer asks. Deriving this from a second word list is how
  // two answers to one question drift apart.
  const text = `${title} ${items.map((i) => i.name).join(' ')}`.toLowerCase();
  return activityIsTracked(inferActivity(text)) ? 'tracked' : 'strength';
}

/* ── Projection ───────────────────────────────────────────────────────────────────────────── */

function trim(name: string): string {
  const clean = name.trim();
  return clean.length > WATCH_MAX_NAME_CHARS ? `${clean.slice(0, WATCH_MAX_NAME_CHARS - 1)}…` : clean;
}

/** The interval prescription, run through the shared engine's clamp on the way out. */
function intervalOf(session: OccurrenceSession | null | undefined): WatchIntervalSpec | undefined {
  const item = allItems(session).find(isIntervalItem);
  if (!item) return undefined;
  // `singleSetPlan` clamps on the way through, so what comes out is always a plan the player
  // would actually walk — never raw coach output.
  const plan: IntervalPlan = singleSetPlan({
    warmupSec: item.interval_warmup_sec,
    workSec: item.interval_work_sec,
    recoverSec: item.interval_recover_sec,
    rounds: item.interval_rounds,
    cooldownSec: item.interval_cooldown_sec,
  });
  const set = plan.sets[0];
  if (!set) return undefined;
  return {
    warmupSec: plan.warmupSec,
    workSec: set.workSec,
    recoverSec: set.recoverSec,
    rounds: set.rounds,
    cooldownSec: plan.cooldownSec,
  };
}

/** An item stripped to what a wrist shows: a name and its quantities. `detail`, `video_query`,
 *  every cue and every mind-tool parameter stay on the phone — they have no face on the watch,
 *  and each one is payload spent on something nobody can read there. */
function exerciseOf(i: SessionItem): WatchExerciseSpec {
  const spec: WatchExerciseSpec = { name: trim(i.name) };
  if (typeof i.sets === 'number' && i.sets > 0) spec.sets = i.sets;
  if (typeof i.reps === 'number' && i.reps > 0) spec.reps = i.reps;
  if (typeof i.load === 'string' && i.load.trim()) spec.load = trim(i.load);
  if (typeof i.duration_min === 'number' && i.duration_min > 0) {
    spec.durationSec = Math.round(i.duration_min * 60);
  }
  return spec;
}

function blocksOf(session: OccurrenceSession): WatchBlockSpec[] {
  return session.blocks
    .slice(0, WATCH_MAX_BLOCKS)
    .map((b: SessionBlock) => ({
      label: trim(b.label ?? ''),
      items: (b.items ?? []).slice(0, WATCH_MAX_ITEMS_PER_BLOCK).map(exerciseOf),
    }))
    .filter((b) => b.items.length > 0);
}

/**
 * Prescribed minutes — what the user was told the session is.
 *
 * An interval session answers from the walked clock (`intervalTotalSeconds` over the clamped
 * plan), so the wrist and the phone player agree to the second. Everything else sums the items'
 * own durations, and falls back to the commitment's `duration_min` when a prescription carries
 * no times at all. Zero is a legitimate answer — a session of pure rep work has no clock — and
 * the subtitle simply omits it rather than inventing one.
 */
function minutesOf(input: WatchOccurrenceInput, interval: WatchIntervalSpec | undefined): number {
  if (interval) {
    const seconds = intervalTotalSeconds(
      singleSetPlan({
        warmupSec: interval.warmupSec,
        workSec: interval.workSec,
        recoverSec: interval.recoverSec,
        rounds: interval.rounds,
        cooldownSec: interval.cooldownSec,
      }),
    );
    return Math.round(seconds / 60);
  }
  const summed = allItems(input.session).reduce(
    (acc, i) => acc + (typeof i.duration_min === 'number' && i.duration_min > 0 ? i.duration_min : 0),
    0,
  );
  if (summed > 0) return Math.round(summed);
  return typeof input.duration_min === 'number' && input.duration_min > 0 ? Math.round(input.duration_min) : 0;
}

/**
 * The row's second line.
 *
 * Says what the session IS — never what is left of it, never a score. A done session says so
 * plainly, because on a week face the outcome is the information; "count what happened" is the
 * rule, and what happened is exactly one word.
 */
export function watchSubtitle(spec: {
  kind: WatchSessionKind;
  minutes: number;
  status: OccurrenceStatus;
  interval?: WatchIntervalSpec;
  blocks?: WatchBlockSpec[];
}): string {
  if (spec.status === 'done') return 'done';
  if (spec.status === 'skipped') return 'skipped';
  const bits: string[] = [];
  if (spec.minutes > 0) bits.push(`${spec.minutes} min`);
  if (spec.kind === 'interval' && spec.interval) {
    bits.push(`${spec.interval.rounds} ${spec.interval.rounds === 1 ? 'round' : 'rounds'}`);
  } else if (spec.kind === 'tracked') {
    // It read "opens Workout" while a run was Apple's to run. We track these ourselves now, so
    // the row names the session rather than another app. With no prescribed minutes there is
    // nothing to state but the invitation.
    if (spec.minutes === 0) bits.push('track it');
  } else if (spec.blocks?.length) {
    const count = spec.blocks.reduce((acc, b) => acc + b.items.length, 0);
    if (count > 0) bits.push(`${count} ${count === 1 ? 'thing' : 'things'}`);
  }
  return bits.join(' · ');
}

function sessionOf(input: WatchOccurrenceInput, detailed: boolean): WatchSessionSpec {
  const interval = detailed ? intervalOf(input.session) : undefined;
  // Kind is decided from the prescription whenever one was read, even on a day whose detail does
  // not ride along — a run row must show its hand-off arrow on Friday too. Only the payload is
  // shallow out there; the classification is not.
  const kind = watchSessionKind(input.title, input.session);
  const blocks =
    detailed && kind !== 'interval' && kind !== 'tracked' && input.session ? blocksOf(input.session) : undefined;
  // A tracked session can also be opened in Apple's Workout app, which needs a composed workout
  // rather than our prescription. Same composer the phone's hand-off row uses.
  const workout =
    detailed && kind === 'tracked'
      ? (composeWorkoutPlan(input.occurrence_id, input.title, input.session) ?? undefined)
      : undefined;
  const minutes = minutesOf(input, interval);
  // Inferred from the same text and the same table the composer uses, so the tracker configures
  // the session as the activity it actually is even when nothing composed.
  const text = `${input.title} ${allItems(input.session)
    .map((i) => i.name)
    .join(' ')}`.toLowerCase();
  const activity = inferActivity(text);
  const spec: WatchSessionSpec = {
    occurrenceId: input.occurrence_id,
    title: trim(input.title),
    kind,
    minutes,
    status: input.status,
    activity,
    location: activitySpec(activity)?.location ?? 'unknown',
    // Startable means the wrist has what it would need to run this. A TRACKED session needs
    // nothing but the occurrence id — our live session measures, it does not follow a script — so
    // it is always startable, even on a day whose prescriptions did not ride along. A guided one
    // needs its five or its blocks; without them the row says what it is and sends you to the
    // phone, which is the honest answer and the one a wrist can least afford to fake.
    detailed: kind === 'tracked' ? true : !!interval || !!blocks?.length,
    subtitle: '',
  };
  if (interval) spec.interval = interval;
  if (blocks?.length) spec.blocks = blocks;
  if (workout) spec.workout = workout;
  spec.subtitle = watchSubtitle({ kind, minutes, status: input.status, interval, blocks });
  return spec;
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** The weekday for a `YYYY-MM-DD` string, read as a calendar date rather than an instant — parsing
 *  it as UTC and formatting in local time is the classic off-by-one that puts Monday's session on
 *  Sunday's row for anyone west of Greenwich. */
function weekdayOf(dateISO: string): string {
  const [y, m, d] = dateISO.split('-').map(Number);
  if (!y || !m || !d) return '';
  return WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()] ?? '';
}

/** Whole days between two `YYYY-MM-DD` dates — negative for a past date. UTC on both sides, so
 *  DST never makes a day 23 hours long and rounds the answer wrong. */
function daysBetween(fromISO: string, toISO: string): number {
  const at = (s: string) => {
    const [y, m, d] = s.split('-').map(Number);
    return Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1);
  };
  return Math.round((at(toISO) - at(fromISO)) / 86_400_000);
}

/**
 * Does this occurrence belong on a wrist at all?
 *
 * System rows — the per-meal food log, the weigh-in — are tracking anchors the app ticks, not
 * work anybody performs, and there is no watch face that could open one. A wrist has room for
 * roughly three rows; spending one on "Food log" is spending it on a dead end.
 *
 * `kind` is optional on the input, and an absent one counts as a real commitment: a caller that
 * does not know had better show the session than hide it.
 */
function isForWrist(occ: WatchOccurrenceInput): boolean {
  return occ.kind !== 'system';
}

/** A session stripped back to its row — named and classified, but no longer startable. */
function shed(spec: WatchSessionSpec): WatchSessionSpec {
  if (!spec.blocks && !spec.interval && !spec.workout) return spec;
  const bare: WatchSessionSpec = { ...spec, detailed: false };
  delete bare.blocks;
  delete bare.interval;
  delete bare.workout;
  // The subtitle was built from detail that is now gone; rebuild it so it cannot promise
  // "3 things" the payload no longer carries.
  bare.subtitle = watchSubtitle({ kind: bare.kind, minutes: bare.minutes, status: bare.status });
  return bare;
}

/**
 * Hold the payload under the byte ceiling, shedding detail from the far end first.
 *
 * The order is the product decision: a week that will not fit loses TOMORROW's prescriptions
 * before today's, and loses the tail of a day before its first session. What it never loses is a
 * row — the week list stays complete, so the watch shows the whole shape and simply cannot start
 * the sessions it was not given. That is the honest failure: fewer playable sessions, never a
 * missing day, and never a silent transport refusal that delivers nothing at all.
 */
function fitToBudget(payload: WatchWeekPayload): WatchWeekPayload {
  const size = (p: WatchWeekPayload) => JSON.stringify(p).length;
  if (size(payload) <= WATCH_MAX_PAYLOAD_BYTES) return payload;

  const days = payload.days.map((d) => ({ ...d, sessions: [...d.sessions] }));
  // Furthest day first, and within a day the last session first.
  for (let d = days.length - 1; d >= 0; d--) {
    const day = days[d];
    if (!day) continue;
    for (let s = day.sessions.length - 1; s >= 0; s--) {
      if (size({ ...payload, days }) <= WATCH_MAX_PAYLOAD_BYTES) return { ...payload, days };
      const session = day.sessions[s];
      if (session) day.sessions[s] = shed(session);
    }
  }
  return { ...payload, days };
}

/**
 * Build the payload the phone hands to the watch.
 *
 * Days come back in date order and INCLUDE empty ones: a rest day is a designed face ("Today's
 * clear. Rest is part of the rhythm."), and the watch can only draw it if the day is present to
 * be drawn. Dropping empty days here would turn the rest-day board into an off-by-one where
 * Thursday's card sits under Wednesday's heading.
 *
 * Past days keep their outcomes so the week face counts what happened without a second fetch;
 * they never carry prescriptions, because nothing on the wrist can act on a session that is
 * already behind you.
 */
export function buildWatchWeek(input: WatchWeekInput): WatchWeekPayload {
  const byDate = new Map<string, WatchOccurrenceInput[]>();
  for (const occ of input.occurrences) {
    if (!occ?.date || !occ.occurrence_id) continue;
    if (!isForWrist(occ)) continue;
    const offset = daysBetween(input.todayISO, occ.date);
    if (offset < -WATCH_MAX_DAYS || offset >= WATCH_MAX_DAYS) continue;
    const list = byDate.get(occ.date) ?? [];
    list.push(occ);
    byDate.set(occ.date, list);
  }

  const dates = [...byDate.keys()].sort();
  // Fill the gaps so the week is contiguous — a day with nothing on it is a rest day, and the
  // watch draws it as one.
  const days: WatchDaySpec[] = [];
  const first = dates[0];
  const last = dates[dates.length - 1];
  if (first && last) {
    for (let offset = 0; offset <= daysBetween(first, last) && days.length < WATCH_MAX_DAYS; offset++) {
      const [y, m, d] = first.split('-').map(Number);
      const date = new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, (d ?? 1) + offset)).toISOString().slice(0, 10);
      const ahead = daysBetween(input.todayISO, date);
      const detailed = ahead >= 0 && ahead < WATCH_DETAIL_DAYS;
      const sessions = (byDate.get(date) ?? [])
        .slice(0, WATCH_MAX_SESSIONS_PER_DAY)
        .map((occ) => sessionOf(occ, detailed));
      days.push({ date, weekday: weekdayOf(date), isToday: ahead === 0, sessions });
    }
  }

  return fitToBudget({ version: WATCH_PAYLOAD_VERSION, generatedAt: input.generatedAt, days });
}
