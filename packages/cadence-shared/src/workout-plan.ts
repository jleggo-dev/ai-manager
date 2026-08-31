/**
 * A prescribed session, expressed as something Apple's Workout app can run (A13 v1).
 *
 * The ruling this implements: we do not track runs ourselves. Our phone app COMPOSES the workout —
 * goal, pace, interval structure — hands it to WorkoutKit, and Apple does the tracking on the
 * watch with GPS and heart rate we would otherwise have to build badly. The result lands in
 * HealthKit and we read it back through the path we already have.
 *
 * **Everything decidable is decided here, in TypeScript.** The Swift bridge decodes a
 * `WorkoutPlanSpec` and calls the framework; it makes no judgements, owns no bounds, and has no
 * table of what maps to what. That is deliberate: this file is unit-testable on any machine, and
 * the whole design risk of the feature lives in it. The native side is then small enough to be
 * reviewed by reading it once.
 *
 * **What this file will NOT do: decide what WorkoutKit supports.** `CustomWorkout.supportsActivity`,
 * `.supportsGoal` and `.supportsAlert` are static functions the SDK answers at RUN TIME, per OS
 * version. A hardcoded matrix of allowed activities would be wrong somewhere and would rot
 * everywhere. So we compose the most faithful spec we can and let the device refuse it — the
 * refusal is a fact the caller reports, never a guess we bake in.
 */

import { clampIntervalPlan, singleSetPlan, type IntervalPlan } from './interval.ts';
import { WORKOUT_ACTIVITIES, type WorkoutActivityName } from './workout-activities.ts';
import type { OccurrenceSession, SessionItem } from './types/occurrence.ts';

/* ── The spec the bridge decodes ──────────────────────────────────────────────────────────── */

/**
 * The activity, in WorkoutKit's vocabulary rather than ours.
 *
 * Derived from `workout-activities.ts`, which is also what generates the Swift map — so the union,
 * the inference table and both native switches cannot drift apart. It was eleven names until
 * 2026-08-30; a Pilates, dance, boxing or elliptical session composed to `.other` and reached
 * Apple as an unnamed workout. Mind practices are absent on purpose — see `MINDFUL_TOOLS`.
 */
export type WorkoutActivity = WorkoutActivityName;

/** Where the work happens. WorkoutKit asks, because an outdoor run and a treadmill run are
 *  different workouts to it — different goals are legal, and only one of them uses GPS. */
export type WorkoutLocation = 'outdoor' | 'indoor' | 'unknown';

/**
 * A goal, in the three shapes WorkoutKit's `WorkoutGoal` gives us that we can actually fill.
 *
 * `.open` is absent by design. An open goal is "record something, stop when you like", which is
 * what the Workout app already does without us — scheduling one would put our name on a card that
 * prescribes nothing. When we cannot say what the work IS, we compose no workout at all.
 */
export type WorkoutGoalSpec = { kind: 'distance'; km: number } | { kind: 'time'; seconds: number };

/** One step inside an interval block. `purpose` is WorkoutKit's `IntervalStep.Purpose`. */
export interface IntervalStepSpec {
  purpose: 'work' | 'recovery';
  goal: WorkoutGoalSpec;
}

/** `IntervalBlock(steps:iterations:)` — the steps, and how many times they repeat back to back. */
export interface IntervalBlockSpec {
  steps: IntervalStepSpec[];
  iterations: number;
}

/** The three composition types we fill. `SwimBikeRunWorkout` is out of scope for v1. */
export type WorkoutBody =
  /** Distance AND time together — "5 k in 28 minutes". WorkoutKit's `PacerWorkout`. */
  | { type: 'pacer'; distanceKm: number; durationSec: number }
  /** One goal. WorkoutKit's `SingleGoalWorkout`. */
  | { type: 'goal'; goal: WorkoutGoalSpec }
  /** Warm-up + blocks + cool-down. WorkoutKit's `CustomWorkout`. */
  | {
      type: 'custom';
      warmup?: WorkoutGoalSpec;
      blocks: IntervalBlockSpec[];
      cooldown?: WorkoutGoalSpec;
    };

export interface WorkoutPlanSpec {
  /** Deterministic and derived from the occurrence — see `workoutPlanId`. */
  id: string;
  /** What the Workout app puts on the card, under our icon. The occurrence's own title. */
  displayName: string;
  activity: WorkoutActivity;
  location: WorkoutLocation;
  body: WorkoutBody;
}

/* ── The join key ─────────────────────────────────────────────────────────────────────────── */

/**
 * The plan id, from the occurrence id. **This is the contract A14 consumes.**
 *
 * `WorkoutPlan.init(_:id:)` lets us choose the UUID, and `HKWorkout.workoutPlan` hands it back off
 * a completed workout — so a session finished on the watch is matched to the occurrence it came
 * from by ID, not guessed at by timestamp and type. That is the single most valuable thing
 * WorkoutKit gives us and the reason this function exists as a named seam rather than inline.
 *
 * Identity is the mapping, and identity is the point: the same occurrence composes to the same
 * plan id forever, which makes scheduling idempotent under replan (schedule the same id twice and
 * the second replaces the first, rather than leaving a stale Thursday on the watch). Callers must
 * go through this function so the derivation can change without any of them caring.
 */
export function workoutPlanId(occurrenceId: string): string {
  return occurrenceId;
}

/* ── What is not a workout ────────────────────────────────────────────────────────────────── */

/**
 * Tools that must never become a WorkoutKit workout, however long they run.
 *
 * A sit is not exercise. HealthKit models it as `mindfulSession` and WorkoutKit has no activity for
 * it, so composing one would file a meditation under training — and then the watch would count
 * calories for it. Requirement 2 wants heart rate during a sit as a CALM signal; that is a
 * mindfulness read, never a workout, and never a target. Hearth, not scoreboard.
 */
const MINDFUL_TOOLS = new Set(['breathing', 'meditate', 'grounding', 'feeling_log', 'journal']);

/** Tools whose item carries no physical work at all — nothing to hand to a watch. */
const INERT_TOOLS = new Set(['read', 'checkoff', 'photo']);

/* ── Activity inference ───────────────────────────────────────────────────────────────────── */

/** Longest match wins, so "trail run" reads as running and "rowing machine" as rowing. Order
 *  within a tier does not matter; the table is scanned whole and the longest key that hits is
 *  taken, which keeps "row" from stealing "rowing machine". */
/**
 * The inference table, precompiled.
 *
 * Each cue is anchored at a WORD BOUNDARY and matches as a prefix, so "run" finds "running" and
 * "runs" but not "th-run-…"; the boundary is the whole point. Plain substring matching was the
 * shipped behaviour until 2026-08-30 and it was wrong in a way nobody would notice from the
 * outside: "Throwing drills" contains "row", so a med-ball session composed to ROWING and was
 * handed to Apple as one.
 *
 * Compiled once at module load rather than per call — the table is a few hundred cues now, and
 * `inferActivity` runs for every session in a week projection.
 */
const ACTIVITY_WORDS: ReadonlyArray<readonly [RegExp, WorkoutActivity, number]> = WORKOUT_ACTIVITIES.flatMap((a) =>
  a.words.map((w) => [new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`), a.name, w.length] as const),
);

/** Words that mean the work does not happen outside, whatever the activity is. */
const INDOOR_WORDS = ['treadmill', 'indoor', 'stationary', 'gym', 'machine', 'erg', 'pool'];

/** Where each activity happens unless the text says otherwise — the catalog's own answer. */
const LOCATION_BY_ACTIVITY = new Map<string, WorkoutLocation>(WORKOUT_ACTIVITIES.map((a) => [a.name, a.location]));

/**
 * The activity a piece of text describes, or `other`.
 *
 * Exported because `watch-week.ts` classifies wrist sessions from the SAME table: which face opens
 * a session and which activity it composes to are two answers to one question, and deriving them
 * separately is how they drift.
 */
export function inferActivity(text: string): WorkoutActivity {
  let best: WorkoutActivity = 'other';
  let bestLen = 0;
  // Longest cue wins, so "rowing machine" beats "row" and "cross country ski" beats "ski". The
  // table is scanned whole rather than short-circuited for exactly that reason.
  for (const [pattern, activity, length] of ACTIVITY_WORDS) {
    if (length > bestLen && pattern.test(text)) {
      best = activity;
      bestLen = length;
    }
  }
  return best;
}

function inferLocation(text: string, activity: WorkoutActivity): WorkoutLocation {
  if (INDOOR_WORDS.some((w) => text.includes(w))) return 'indoor';
  const known = LOCATION_BY_ACTIVITY.get(activity);
  if (known && known !== 'unknown') return known;
  // Strength, HIIT and core are usually indoors, but "usually" is not knowledge — and WorkoutKit
  // treats location as a real dimension of what is legal. `unknown` lets the bridge pass
  // `.unknown`, which is WorkoutKit's own answer for "do not care".
  return 'unknown';
}

/* ── The composition ──────────────────────────────────────────────────────────────────────── */

/** Every item that could carry physical work — mind tools and inert steps dropped. */
function physicalItems(session: OccurrenceSession): SessionItem[] {
  return session.blocks
    .flatMap((b) => b.items)
    .filter((i) => !(i.tool && (MINDFUL_TOOLS.has(i.tool) || INERT_TOOLS.has(i.tool))));
}

/** An item is an interval step if it carries `interval_work_sec`, tagged or not. That field is
 *  load-bearing by the same rule the player uses (`types/occurrence.ts`): a model that filled the
 *  numbers and forgot the tag still prescribed an interval. */
function isIntervalItem(i: SessionItem): boolean {
  return i.tool === 'interval' || typeof i.interval_work_sec === 'number';
}

function intervalPlanOf(i: SessionItem): IntervalPlan {
  return singleSetPlan({
    warmupSec: i.interval_warmup_sec,
    workSec: i.interval_work_sec,
    recoverSec: i.interval_recover_sec,
    rounds: i.interval_rounds,
    cooldownSec: i.interval_cooldown_sec,
  });
}

/**
 * An interval plan, as `CustomWorkout`'s warm-up + blocks + cool-down.
 *
 * Two mismatches between our model and WorkoutKit's, both resolved here rather than in Swift:
 *
 * - **EMOM has no recovery step.** `recoverSec: 0` means the chime marks each work start and the
 *   rest is whatever is left. A zero-length `.recovery` step is not that; it is a step the watch
 *   would tick past instantly. So a zero recovery emits a work-only step, exactly as
 *   `expandIntervalPhases` omits the phase.
 * - **`restBetweenSetsSec` has no home in WorkoutKit's model** — it is not a block and not a step.
 *   Dropping it would silently shorten a session the user was already shown, so instead it becomes
 *   a leading `.recovery` step on every block after the first. The watch then walks the same
 *   wall-clock the player would have walked, which is the only property that matters here.
 */
function customBodyFromPlan(plan: IntervalPlan): WorkoutBody {
  const p = clampIntervalPlan(plan);
  const blocks: IntervalBlockSpec[] = [];
  p.sets.forEach((set, idx) => {
    // The rest gets its OWN single-iteration block. Folding it into the set's block as a leading
    // step would repeat it once per round — a 60s breather between two sets would become sixty
    // seconds of standing still inside every round of the second set. `expandIntervalPhases` puts
    // it outside the round loop for the same reason; this is that structure in WorkoutKit's shape.
    if (idx > 0 && p.restBetweenSetsSec > 0) {
      blocks.push({
        steps: [{ purpose: 'recovery', goal: { kind: 'time', seconds: p.restBetweenSetsSec } }],
        iterations: 1,
      });
    }
    const steps: IntervalStepSpec[] = [{ purpose: 'work', goal: { kind: 'time', seconds: set.workSec } }];
    if (set.recoverSec > 0) {
      steps.push({ purpose: 'recovery', goal: { kind: 'time', seconds: set.recoverSec } });
    }
    blocks.push({ steps, iterations: set.rounds });
  });
  return {
    type: 'custom',
    ...(p.warmupSec > 0 ? { warmup: { kind: 'time' as const, seconds: p.warmupSec } } : {}),
    blocks,
    ...(p.cooldownSec > 0 ? { cooldown: { kind: 'time' as const, seconds: p.cooldownSec } } : {}),
  };
}

/**
 * Distance and duration for the session as a whole.
 *
 * Summed across items rather than taken from one, because a run is often prescribed as a warm-up
 * item plus a main item and the thing the user was told is the total.
 */
function totals(items: SessionItem[]): { km: number; sec: number } {
  let km = 0;
  let sec = 0;
  for (const i of items) {
    if (typeof i.distance_km === 'number' && i.distance_km > 0) km += i.distance_km;
    if (typeof i.duration_min === 'number' && i.duration_min > 0) sec += i.duration_min * 60;
  }
  return { km, sec };
}

/**
 * Compose an interval plan — prescribed OR edited — into a workout Apple can run.
 *
 * Its own entry point rather than a private step of `composeWorkoutPlan`, because the plan someone
 * sends to their watch should be the plan they are looking at. The coach only ever prescribes one
 * set, but `IntervalEditSheet` lets anyone add up to `MAX_SETS` before starting, and a hand-added
 * second set is exactly the case `restBetweenSetsSec` exists for. Handing the watch the
 * *prescription* after the user edited it would be the quiet kind of wrong.
 */
export function workoutFromIntervalPlan(
  occurrenceId: string,
  title: string,
  plan: IntervalPlan,
  text?: string,
): WorkoutPlanSpec {
  // Never null, and that is a property of `clampIntervalPlan` rather than an accident: it fills a
  // missing or empty set list with the default HIIT shape, so every interval plan has at least one
  // set of at least `MIN_WORK_SEC`. An interval item therefore ALWAYS composes to something the
  // watch can run — the "maps to nothing" cases all live upstream, in `composeWorkoutPlan`.
  const p = clampIntervalPlan(plan);
  const activity = inferActivity(text ?? title.toLowerCase());
  return {
    id: workoutPlanId(occurrenceId),
    displayName: title,
    activity,
    location: inferLocation(text ?? title.toLowerCase(), activity),
    body: customBodyFromPlan(p),
  };
}

/**
 * Compose a prescribed session into a workout Apple can run — or `null` when it maps to nothing.
 *
 * **`null` is a real answer and callers must honour it.** The affordance ("send this to your
 * watch") must not render at all for a session that composes to nothing; a dead button is exactly
 * the class of defect the device rounds keep finding. Sessions that legitimately return `null`:
 * a pure mind practice, a checkoff list, a strength session with no time on it.
 *
 * The mapping, in order:
 * - any interval item → `CustomWorkout` from the first one (the coach prescribes one set; a
 *   second is hand-added in the edit sheet, and WorkoutKit takes both the same way)
 * - distance AND time → `PacerWorkout` — "5 k in 28 minutes", the shape with a pace target
 * - distance only → `SingleGoalWorkout(.distance)`
 * - time only → `SingleGoalWorkout(.time)`; this is what carries requirement 2's heart rate for
 *   resistance work, where there is no distance to aim at
 * - anything else → `null`, never an open goal
 */
export function composeWorkoutPlan(
  occurrenceId: string,
  title: string,
  session: OccurrenceSession | null | undefined,
): WorkoutPlanSpec | null {
  if (!session?.blocks?.length) return null;
  const items = physicalItems(session);
  if (!items.length) return null;

  const text = `${title} ${items.map((i) => `${i.name} ${i.detail ?? ''}`).join(' ')}`.toLowerCase();
  const activity = inferActivity(text);
  const base = {
    id: workoutPlanId(occurrenceId),
    displayName: title,
    activity,
    location: inferLocation(text, activity),
  };

  const interval = items.find(isIntervalItem);
  if (interval) return workoutFromIntervalPlan(occurrenceId, title, intervalPlanOf(interval), text);

  const { km, sec } = totals(items);
  if (km > 0 && sec > 0) return { ...base, body: { type: 'pacer', distanceKm: km, durationSec: sec } };
  if (km > 0) return { ...base, body: { type: 'goal', goal: { kind: 'distance', km } } };
  if (sec > 0) return { ...base, body: { type: 'goal', goal: { kind: 'time', seconds: sec } } };
  return null;
}
