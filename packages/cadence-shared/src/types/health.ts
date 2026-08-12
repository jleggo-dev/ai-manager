/**
 * Health digest — the compact, client-built summary of recent Apple Health activity.
 *
 * HealthKit is on-device only, so the CLIENT reads and aggregates; the server stores the
 * digest and the retrieval registry renders it into coach/broker context. Provenance is
 * "the user shared this" — the digest crosses the wire only after an explicit in-chat
 * confirmation (never on its own).
 */

/**
 * How far back the RECENT half of every workout summary reaches.
 *
 * Twenty-eight days rather than seven because one week is one bad week — 28 days is "last month"
 * and survives a missed one. The field that carries it is named `last28` on purpose: if this
 * number ever changes the field name must change with it, so a stored digest can never silently
 * mean a different window than the one it was built with.
 */
export const DIGEST_RECENT_DAYS = 28;

/**
 * One personal best, with the day it was set.
 *
 * The date is not decoration. "Your longest run is 12 km" and "your longest run is 12 km, back in
 * March" are different facts that lead to different sessions. A best is also the anti-streak: it
 * counts what happened and it never resets to zero.
 */
export interface HealthDigestBest {
  /** Kilometres for a distance best, minutes for a duration best. */
  value: number;
  /** YYYY-MM-DD of the session that set it. */
  dateISO: string;
}

/** The same figures as the period-long ones, over the trailing DIGEST_RECENT_DAYS. */
export interface HealthDigestRecentWindow {
  /** Sessions of this type inside the window. Zero is a real answer, not a missing one. */
  count: number;
  avgDurationMin: number | null;
  avgDistanceKm: number | null;
  /** Summed over the sessions that actually recorded a distance. */
  totalDistanceKm: number | null;
}

export interface HealthDigestTypeSummary {
  /** Humanized activity type, e.g. "running", "strength training". */
  type: string;
  count: number;
  avgDurationMin: number | null;
  avgDistanceKm: number | null;
  /** ISO date of the most recent workout of this type. */
  lastISO: string;
  /**
   * Recency beside the baseline — the shape `dailySteps` has always had (`avgPerDayLast7` next to
   * the 90-day mean) and workouts never did. Two numbers side by side ARE the direction of travel:
   * a flat 90-day mean cannot tell a build-up from a taper, which is how someone running 5–6 km
   * five times in a week was told he averages 4.3 km.
   *
   * Optional because every digest stored before this shipped has none. Absent means "this digest
   * predates the field", never "they did nothing lately" — that case is `count: 0`.
   */
  last28?: HealthDigestRecentWindow;
  /** Longest single session by distance over the whole period. Null when none recorded one. */
  bestDistanceKm?: HealthDigestBest | null;
  /** Longest single session by time over the whole period. */
  bestDurationMin?: HealthDigestBest | null;
}

export interface HealthDigestRecent {
  type: string;
  start: string; // ISO
  durationMin: number | null;
  distanceKm: number | null;
}

/** One calendar week of step activity — the trend shape, never the daily samples. */
export interface HealthDigestStepsWeek {
  /** ISO date (YYYY-MM-DD) of the Monday that starts the week. */
  weekStartISO: string;
  avgPerDay: number;
  daysObserved: number;
}

/**
 * Everyday movement, which for most people is the larger half of what they actually do.
 *
 * Workouts alone describe someone who presses "start" on a watch. Somebody walking 16k steps a
 * day and never recording a workout reads as sedentary through the workout lens, and the plan
 * they get is built for a person who does not exist. Bounded like everything else here: weekly
 * averages, not the ~90 daily buckets HealthKit hands back.
 */
export interface HealthDigestSteps {
  /** Days in the period with any step data at all — the denominator for `avgPerDay`. */
  daysObserved: number;
  avgPerDay: number;
  /** Same average over the trailing week, so a recent ramp or drop-off is visible. */
  avgPerDayLast7: number | null;
  /** Oldest → newest. Capped; see DIGEST_STEPS_MAX_WEEKS on the client builder. */
  byWeek: HealthDigestStepsWeek[];
}

export interface HealthDigest {
  /** Look-back window the digest covers. */
  periodDays: number;
  totalWorkouts: number;
  /** Workouts per week across the covered period (1 decimal). */
  weeklyFrequency: number;
  byType: HealthDigestTypeSummary[];
  /** Most recent few workouts, newest first. */
  recent: HealthDigestRecent[];
  /**
   * Optional because every digest stored before steps existed has none, and because a device
   * that refuses the step permission must still be able to share its workouts. Absent means
   * "we did not read it", NOT "they did not move" — nothing downstream may treat it as zero.
   */
  dailySteps?: HealthDigestSteps;
}
