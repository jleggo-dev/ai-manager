/**
 * Apply migrations/cadence/0031_plan_rationale.sql. Additive + idempotent, safe to re-run.
 * Run: node --import tsx apps/cadence-api/scripts/apply-migration-0031.ts
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sql } from '../src/db/sql.ts';

async function main() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
  const ddl = readFileSync(path.join(root, 'migrations/cadence/0031_plan_rationale.sql'), 'utf8');
  await sql.unsafe(ddl);

  const [cols] = await sql<{ rationale: boolean; suggested: boolean }[]>`
    select
      exists (select 1 from information_schema.columns
        where table_schema = 'cadence' and table_name = 'plans' and column_name = 'rationale') as rationale,
      exists (select 1 from information_schema.columns
        where table_schema = 'cadence' and table_name = 'activities' and column_name = 'suggested') as suggested`;
  console.log('cadence.plans.rationale:', cols?.rationale ? 'exists ✓' : '(missing!)');
  console.log('cadence.activities.suggested:', cols?.suggested ? 'exists ✓' : '(missing!)');

  // Pre-migration rows keep null/false — nothing is backfilled, and nothing must be.
  const [counts] = await sql<{ plans: number; with_rationale: number; suggested: number }[]>`
    select
      (select count(*)::int from cadence.plans) as plans,
      (select count(rationale)::int from cadence.plans) as with_rationale,
      (select count(*)::int from cadence.activities where suggested) as suggested`;
  console.log(
    `plans: ${counts?.plans ?? 0} total, ${counts?.with_rationale ?? 0} with a rationale; ` +
      `suggested activities: ${counts?.suggested ?? 0}`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
