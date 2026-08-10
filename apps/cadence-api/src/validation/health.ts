/**
 * Zod boundary for the client-built health digest (POST /me/health-digest).
 * Bounded everywhere — the digest is an abstraction; anything raw-sample-sized is rejected.
 */
import { z } from 'zod';

const typeName = z.string().trim().min(1).max(80);

const typeSummarySchema = z.object({
  type: typeName,
  count: z.number().int().min(1).max(10_000),
  avgDurationMin: z.number().min(0).max(1_440).nullable(),
  avgDistanceKm: z.number().min(0).max(1_000).nullable(),
  lastISO: z.string().max(40),
});

const recentSchema = z.object({
  type: typeName,
  start: z.string().max(40),
  durationMin: z.number().min(0).max(1_440).nullable(),
  distanceKm: z.number().min(0).max(1_000).nullable(),
});

/**
 * Everyday movement. Same abstraction rule as everything else here: a client sends WEEKLY
 * averages, so the ~90 daily buckets HealthKit hands back can never arrive as ~90 rows — 14 weeks
 * covers the longest window the client asks for, with room for a partial week at either end.
 *
 * `avgPerDay` is capped well above any real person (the record for a day's walking is ~100k) but
 * far below what a faulty sensor reports, so one bad day cannot reject a whole history.
 */
const stepsWeekSchema = z.object({
  weekStartISO: z.string().max(10),
  avgPerDay: z.number().min(0).max(200_000),
  daysObserved: z.number().int().min(0).max(7),
});

const dailyStepsSchema = z.object({
  daysObserved: z.number().int().min(0).max(366),
  avgPerDay: z.number().min(0).max(200_000),
  avgPerDayLast7: z.number().min(0).max(200_000).nullable(),
  byWeek: z.array(stepsWeekSchema).max(14),
});

export const healthDigestSchema = z.object({
  periodDays: z.number().int().min(1).max(366),
  totalWorkouts: z.number().int().min(0).max(100_000),
  weeklyFrequency: z.number().min(0).max(200),
  byType: z.array(typeSummarySchema).max(25),
  recent: z.array(recentSchema).max(10),
  // Optional, and its absence is meaningful: every digest stored before steps existed has none,
  // and a device that refused only the step permission still shares its workouts. Absent means
  // "not read", never "zero" — nothing downstream may fill it in with a 0.
  dailySteps: dailyStepsSchema.optional(),
});

export const healthDigestBodySchema = z.object({
  digest: healthDigestSchema,
  /** Active coach session — when present the digest is also injected as a context turn. */
  sessionId: z.string().trim().min(1).max(100).optional(),
});
