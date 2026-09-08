/**
 * Apply migrations/cadence/0058_plan_week_started_at.sql. Additive + idempotent, safe to re-run.
 * Run: node --import tsx apps/cadence-api/scripts/apply-migration-0058.ts
 *
 * Deploy order matters (the PR's checklist): `insertPlan` names the column, so this must land
 * BEFORE the API that ships with it. The backfill sets every existing plan's week to start when
 * it was generated — exactly the behaviour the app had until now — so nothing about a live user's
 * week moves on apply; the clock only starts to differ from `generated_at` at their next commit.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sql } from '../src/db/sql.ts';

async function main() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
  await sql.unsafe(readFileSync(path.join(root, 'migrations/cadence/0058_plan_week_started_at.sql'), 'utf8'));

  const cols = await sql<{ column_name: string; data_type: string }[]>`
    select column_name, data_type from information_schema.columns
     where table_schema = 'cadence' and table_name = 'plans' and column_name = 'week_started_at'`;
  console.log('plans.week_started_at:', cols[0] ? `present (${cols[0].data_type})` : 'MISSING!');

  const [counts] = await sql<{ total: number; unset: number; active: number; active_matches: number }[]>`
    select count(*)::int as total,
           count(*) filter (where week_started_at is null)::int as unset,
           count(*) filter (where status = 'active')::int as active,
           count(*) filter (where status = 'active' and week_started_at = generated_at)::int as active_matches
      from cadence.plans`;
  console.log(
    `plans: ${counts?.total} total, ${counts?.unset} with week_started_at unset (expect 0), ` +
      `${counts?.active} active of which ${counts?.active_matches} backfilled to generated_at`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
