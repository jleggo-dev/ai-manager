/**
 * Apply migrations/cadence/0049_goal_prior_status.sql. Additive + idempotent, safe to re-run.
 * Run: node --import tsx apps/cadence-api/scripts/apply-migration-0049.ts
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sql } from '../src/db/sql.ts';

async function main() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
  await sql.unsafe(readFileSync(path.join(root, 'migrations/cadence/0049_goal_prior_status.sql'), 'utf8'));

  const cols = await sql<{ column_name: string }[]>`
    select column_name from information_schema.columns
     where table_schema = 'cadence' and table_name = 'goals' and column_name = 'prior_status'`;
  console.log('prior_status column:', cols.length ? 'present' : '(missing!)');

}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
