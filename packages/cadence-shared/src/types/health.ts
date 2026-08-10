/**
 * Health digest — the compact, client-built summary of recent Apple Health activity.
 *
 * HealthKit is on-device only, so the CLIENT reads and aggregates; the server stores the
 * digest and the retrieval registry renders it into coach/broker context. Provenance is
 * "the user shared this" — the digest crosses the wire only after an explicit in-chat
 * confirmation (never on its own).
 */

export interface HealthDigestTypeSummary {
  /** Humanized activity type, e.g. "running", "strength training". */
  type: string;
  count: number;
  avgDurationMin: number | null;
  avgDistanceKm: number | null;
  /** ISO date of the most recent workout of this type. */
  lastISO: string;
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
