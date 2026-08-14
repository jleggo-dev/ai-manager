import type { WorkoutHistoryEntry, WorkoutSource } from '@cadence/shared';
import { sql } from '../db/sql.ts';

/**
 * Individual recorded workouts (migration 0033) — the dataset the digest summarizes. Idempotent
 * by construction: (user_id, source, source_id) is unique and inserts land `on conflict do
 * nothing`, so the device can re-push its whole window every refresh and only genuinely new
 * sessions become rows (or trip the pack watermark — skipped conflicts fire no trigger).
 */

export async function upsertWorkoutHistory(
  userId: string,
  source: WorkoutSource,
  entries: WorkoutHistoryEntry[],
): Promise<number> {
  if (!entries.length) return 0;
  const rows = entries.map((e) => ({
    user_id: userId,
    source,
    source_id: e.sourceId,
    type: e.type,
    started_at: e.startISO,
    duration_min: e.durationMin ?? null,
    distance_km: e.distanceKm ?? null,
    avg_hr: e.avgHr ?? null,
    raw: e.recordedBy ? sql.json({ recordedBy: e.recordedBy }) : null,
  }));
  const inserted = await sql<{ workout_id: string }[]>`
    insert into cadence.workout_history ${sql(
      rows,
      'user_id',
      'source',
      'source_id',
      'type',
      'started_at',
      'duration_min',
      'distance_km',
      'avg_hr',
      'raw',
    )}
    on conflict (user_id, source, source_id) do nothing
    returning workout_id`;
  return inserted.length;
}

export interface WorkoutHistoryRow {
  source: WorkoutSource;
  type: string;
  startedAt: string;
  durationMin: number | null;
  distanceKm: number | null;
  avgHr: number | null;
}

/** Newest first, bounded — the registry render caps harder than this. */
export async function listWorkoutHistory(userId: string, days: number, limit = 60): Promise<WorkoutHistoryRow[]> {
  const rows = await sql<
    {
      source: WorkoutSource;
      type: string;
      started_at: string;
      duration_min: string | null;
      distance_km: string | null;
      avg_hr: string | null;
    }[]
  >`
    select source, type, started_at, duration_min, distance_km, avg_hr
    from cadence.workout_history
    where user_id = ${userId} and started_at >= now() - make_interval(days => ${days})
    order by started_at desc limit ${limit}`;
  return rows.map((r) => ({
    source: r.source,
    type: r.type,
    startedAt: r.started_at,
    durationMin: r.duration_min == null ? null : Number(r.duration_min),
    distanceKm: r.distance_km == null ? null : Number(r.distance_km),
    avgHr: r.avg_hr == null ? null : Number(r.avg_hr),
  }));
}
