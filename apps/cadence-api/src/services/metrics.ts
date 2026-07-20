import type { Occurrence } from '@cadence/shared';

/**
 * Deterministic metrics computed from the store (spec §B3) — the numbers the
 * report jobs (recap, surface_insights) and situation_assess consume. The app
 * computes these; the LLM only narrates them (it never tallies).
 */

/** Slim shape `rollingConsistency` needs — listOccurrences omits session/log. */
export type ConsistencyOccurrence = Pick<Occurrence, 'date' | 'status'>;

/**
 * Rolling-window consistency: how many of the last `windowDays` days had ≥1 completed
 * occurrence, as kept/window (e.g. "5 of 7"). Replaces streaks per BRAND.md — a missed day
 * lowers the ratio, it NEVER resets progress to zero ("hearth, not scoreboard"). Pure.
 */
export function rollingConsistency(
  occurrences: ConsistencyOccurrence[],
  today = new Date(),
  windowDays = 7,
): { kept: number; window: number } {
  // Normalize each occurrence date to a YYYY-MM-DD string — the DB driver returns `date` columns
  // as JS Date objects, which would never match the ISO strings we probe the set with.
  const doneDays = new Set(
    occurrences.filter((o) => o.status === 'done').map((o) => new Date(o.date).toISOString().slice(0, 10)),
  );
  let kept = 0;
  const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  for (let i = 0; i < windowDays; i++) {
    if (doneDays.has(d.toISOString().slice(0, 10))) kept++;
    d.setUTCDate(d.getUTCDate() - 1);
  }
  return { kept, window: windowDays };
}
