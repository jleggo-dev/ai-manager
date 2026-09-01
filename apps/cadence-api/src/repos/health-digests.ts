import type { HealthDigest } from '@cadence/shared';
import { sql } from '../db/sql.ts';

/** Client-built Apple Health summaries (migration 0024). Latest row wins; history is kept for
 *  provenance ("what did the coach know, when") rather than replay. */

export async function insertHealthDigest(userId: string, digest: HealthDigest, source = 'healthkit'): Promise<void> {
  await sql`
    insert into cadence.health_digests (user_id, period_days, source, digest)
    values (${userId}, ${digest.periodDays}, ${source}, ${sql.json(JSON.parse(JSON.stringify(digest)))})`;
}

export async function latestHealthDigest(
  userId: string,
): Promise<{ digest: HealthDigest; createdAt: string; source: string } | null> {
  const rows = await sql<{ digest: HealthDigest; created_at: string; source: string }[]>`
    select digest, created_at, source from cadence.health_digests
    where user_id = ${userId} order by created_at desc limit 1`;
  const r = rows[0];
  return r ? { digest: r.digest, createdAt: r.created_at, source: r.source } : null;
}

export interface StoredHealthDigest {
  digest: HealthDigest;
  /** postgres.js returns timestamptz as a Date at runtime — the type now says so (see iso-day.ts). */
  createdAt: string | Date;
}

/**
 * The digest SERIES, newest first — the reason this table has always been insert-only.
 *
 * Every row is a rolling 90-day window, so consecutive rows overlap almost entirely and a single
 * one can only ever say "here is the average". The series is what turns that into a history:
 * comparing windows taken weeks apart is how "building" and "fading" become visible at all, and
 * neither is a thing any one snapshot can show. `latestHealthDigest` stays the right call for
 * anything that just wants today's picture.
 */
export async function listHealthDigests(userId: string, limit = 30): Promise<StoredHealthDigest[]> {
  const rows = await sql<{ digest: HealthDigest; created_at: string }[]>`
    select digest, created_at from cadence.health_digests
    where user_id = ${userId} order by created_at desc limit ${limit}`;
  return rows.map((r) => ({ digest: r.digest, createdAt: r.created_at }));
}
