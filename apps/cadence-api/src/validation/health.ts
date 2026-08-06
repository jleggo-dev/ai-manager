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

export const healthDigestSchema = z.object({
  periodDays: z.number().int().min(1).max(366),
  totalWorkouts: z.number().int().min(0).max(100_000),
  weeklyFrequency: z.number().min(0).max(200),
  byType: z.array(typeSummarySchema).max(25),
  recent: z.array(recentSchema).max(10),
});

export const healthDigestBodySchema = z.object({
  digest: healthDigestSchema,
  /** Active coach session — when present the digest is also injected as a context turn. */
  sessionId: z.string().trim().min(1).max(100).optional(),
});
