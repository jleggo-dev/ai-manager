import postgres from 'postgres';
import { cadenceConfig } from '../config.ts';

/**
 * Direct Postgres client for the Cadence DB, via the Supabase pooler.
 * App data lives in the `cadence` schema (tables are schema-qualified, `cadence.*`),
 * which is intentionally NOT exposed to the Data API — a trusted backend talks to
 * Postgres directly. Pooler-safe: `prepare: false` (works with the transaction pooler).
 */
export const sql = postgres(cadenceConfig.databaseUrl, {
  prepare: false,
  ssl: 'require',
});

/**
 * jsonb helper: `sql.json` with a relaxed input type. Our domain objects are
 * plain JSON-serializable but don't structurally match porsager's index-signature
 * `JSONValue`, so we assert at this single seam.
 */
export const json = (value: unknown) => sql.json(value as Parameters<typeof sql.json>[0]);
