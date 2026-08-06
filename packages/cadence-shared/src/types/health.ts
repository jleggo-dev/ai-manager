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

export interface HealthDigest {
  /** Look-back window the digest covers. */
  periodDays: number;
  totalWorkouts: number;
  /** Workouts per week across the covered period (1 decimal). */
  weeklyFrequency: number;
  byType: HealthDigestTypeSummary[];
  /** Most recent few workouts, newest first. */
  recent: HealthDigestRecent[];
}
