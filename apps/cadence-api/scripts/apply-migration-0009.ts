/**
 * Apply migrations/cadence/0009_pending_plan.sql. Purely additive (IF NOT EXISTS), safe to re-run.
 * Run: node --import tsx apps/cadence-api/scripts/apply-migration-0009.ts
 */
import { sql } from '../src/db/sql.ts';

async function main() {
  await sql`alter table cadence.users add column if not exists pending_plan jsonb`;
  const [col] = await sql<{ column_name: string; data_type: string }[]>`
    select column_name, data_type from information_schema.columns
    where table_schema = 'cadence' and table_name = 'users' and column_name = 'pending_plan'`;
  console.log('users.pending_plan:', col ? `${col.data_type} ✓` : '(missing!)');
  await sql.end();
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
