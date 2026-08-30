/**
 * Cheap, deterministic "what can this user's page actually bind right now" signal, fed to the
 * `progress-layout-compose` job so it is never tempted to propose a section nothing exists to
 * show — and checked again, independently, by `progress-layout-validate.ts` afterward (never
 * trust the model's shape beyond the schema; TOOL-HARNESS.md's "a guard reports, it does not
 * silently veto" cuts the other way here too: a section that fails this check is REJECTED with
 * the evidence, not silently dropped).
 *
 * Deliberately coarse — existence in the last `AVAILABILITY_DAYS`, not the full resolver logic
 * that lives in the Wave 1 binding resolvers (e.g. progress-nontemporal-balance.ts). This only
 * has to answer "does a widget of this shape have anything to draw on", not draw it.
 */
import { getUser } from '../repos/users.ts';
import { listWeighInSeries, listLoggedForProgress } from '../repos/occurrences.ts';
import { listWorkoutHistory } from '../repos/workout-history.ts';
import { feedbackInRange } from '../repos/coach-moments.ts';
import { listNutritionLogs } from '../repos/nutrition.ts';

/** Existence, not a display window — generous enough that a real habit reads as available without
 *  scanning a user's entire history on every compose call. */
const AVAILABILITY_DAYS = 180;

const iso = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

export interface ProgressAvailability {
  has_weight: boolean;
  has_workout_history: boolean;
  has_feedback: { mind: boolean; movement: boolean };
  has_food_usage: boolean;
  /** Activity TITLES with at least one logged session — what `dated_sessions.source.activity` may name. */
  activities: string[];
}

/** Fetch + fold — the impure half. `buildAvailability` never trims/decides anything itself beyond
 *  what the four repo reads already answer, so there is no logic here worth unit-testing in
 *  isolation from the fetch; the validator (progress-layout-validate.ts) is where the judgment on
 *  what this summary PERMITS lives, and that half is pure and fixture-tested. */
export async function buildAvailability(userId: string): Promise<ProgressAvailability> {
  const from = iso(Date.now() - AVAILABILITY_DAYS * 86_400_000);
  const today = iso(Date.now());

  const [user, weighIns, loggedRows, workouts, feedback, foodLogs] = await Promise.all([
    getUser(userId),
    listWeighInSeries(userId, AVAILABILITY_DAYS),
    listLoggedForProgress(userId, from),
    // limit 1: existence only, never a real list.
    listWorkoutHistory(userId, AVAILABILITY_DAYS, 1),
    feedbackInRange(userId, from, today),
    listNutritionLogs(userId, from, today),
  ]);

  return {
    // A weigh-in occurrence OR the baseline's own current reading — either means the trend has a
    // starting point (services/progress.ts falls back the same way for the dashboard's own card).
    has_weight: weighIns.length > 0 || typeof user?.baseline?.weight_kg?.current === 'number',
    has_workout_history: workouts.length > 0,
    has_feedback: {
      mind: feedback.some((f) => f.kind === 'mind'),
      movement: feedback.some((f) => f.kind === 'movement'),
    },
    has_food_usage: foodLogs.length > 0,
    activities: [...new Set(loggedRows.map((r) => r.title))],
  };
}
