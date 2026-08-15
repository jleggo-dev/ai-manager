/**
 * Matching a RECORDED workout to the session that was planned for it.
 *
 * `completion_source: 'healthkit'` has been written onto activities since the plan schema
 * existed, validated on every synthesis — and nothing ever read it. So a long run that the watch
 * recorded, that reached `workout_history`, that the coach could see, sat `pending` on the plan
 * forever: the app knew you had run and still asked you to tell it you had run (owner,
 * 2026-08-15 — "the 85min run that I finished is not marked as done").
 *
 * Pure, so the judgement is testable without a database. Two rules and both are deliberately
 * conservative, because a wrongly-ticked session is worse than an un-ticked one — it writes a
 * false record of someone's week, and they may never notice to correct it:
 *  - the activity must SAY it completes from a device (`completion_source: 'healthkit'`)
 *  - the recorded activity type must plausibly be that session's kind
 * No fuzzy title matching, no "closest thing that day". If two sessions could claim the same
 * workout, nothing is ticked and the person is left to say which — a coin flip here is a lie.
 */

/** Activity-category words → the HealthKit workout types that can complete them. */
const KIND_MATCHES: Array<{ category: RegExp; types: RegExp }> = [
  { category: /\b(run|running|jog)/i, types: /\b(run|running|jog)/i },
  { category: /\b(walk|walking|hike|hiking)/i, types: /\b(walk|walking|hike|hiking)/i },
  { category: /\b(cycl|bike|biking|ride|riding|spin)/i, types: /\b(cycl|bike|biking|ride|riding|spin)/i },
  { category: /\b(swim|swimming)/i, types: /\b(swim|swimming)/i },
  { category: /\b(row|rowing|erg)/i, types: /\b(row|rowing)/i },
  { category: /\b(strength|lift|lifting|weights|resistance)/i, types: /\b(strength|traditional|functional|weight)/i },
  { category: /\b(yoga|mobility|stretch)/i, types: /\b(yoga|flexibility|mind ?(and )?body|stretch|mobility|pilates)/i },
  {
    category: /\b(hiit|interval|circuit|conditioning|mixed)/i,
    types: /\b(hiit|interval|circuit|cross ?training|mixed|functional)/i,
  },
];

export interface MatchableActivity {
  activity_id: string;
  title: string;
  category?: string | null;
  completion_source?: string | null;
}

export interface RecordedWorkout {
  type: string;
  duration_min?: number | null;
  distance_km?: number | null;
}

/** Could this recorded workout have BEEN that planned session? */
export function workoutMatchesActivity(workout: RecordedWorkout, activity: MatchableActivity): boolean {
  if (activity.completion_source !== 'healthkit') return false;
  const type = (workout.type ?? '').trim();
  if (!type) return false;
  // The category is the reliable field; the title is prose the coach wrote and can say anything
  // ("Long run - building time on feet"), so it is only a fallback when no category was set.
  const subject = `${activity.category ?? ''} ${activity.category ? '' : activity.title}`;
  return KIND_MATCHES.some((m) => m.category.test(subject) && m.types.test(type));
}

/**
 * Which planned session, if any, this workout completes. Returns null when nothing matches AND
 * when more than one could — ambiguity is a question for the user, never a guess.
 */
export function matchWorkoutToActivity(
  workout: RecordedWorkout,
  candidates: MatchableActivity[],
): MatchableActivity | null {
  const hits = candidates.filter((a) => workoutMatchesActivity(workout, a));
  return hits.length === 1 ? hits[0]! : null;
}

/** The numbers worth keeping on the occurrence, so the log shows what was actually done. */
export function workoutValue(workout: RecordedWorkout): Record<string, number> {
  const out: Record<string, number> = {};
  if (typeof workout.duration_min === 'number' && workout.duration_min > 0) {
    out.duration_min = Math.round(workout.duration_min);
  }
  if (typeof workout.distance_km === 'number' && workout.distance_km > 0) {
    out.distance_km = Math.round(workout.distance_km * 100) / 100;
  }
  return out;
}
