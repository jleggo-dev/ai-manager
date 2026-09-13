/**
 * Apply migrations/cadence/0059_plan_built_through.sql. Additive + idempotent, safe to re-run.
 * Run: node --import tsx apps/cadence-api/scripts/apply-migration-0059.ts
 *
 * Deploy order matters (same as 0058): `insertPlan` names the column, so this must land BEFORE
 * the API that ships with it. No backfill — null means nothing was built past the check-in, which
 * is true of every existing plan, so nothing about a live user's week moves on apply.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sql } from '../src/db/sql.ts';

async function main() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
  await sql.unsafe(readFileSync(path.join(root, 'migrations/cadence/0059_plan_built_through.sql'), 'utf8'));

  const cols = await sql<{ column_name: string; data_type: string }[]>`
    select column_name, data_type from information_schema.columns
     where table_schema = 'cadence' and table_name = 'plans' and column_name = 'built_through'`;
  console.log('plans.built_through:', cols[0] ? `present (${cols[0].data_type})` : 'MISSING!');
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
