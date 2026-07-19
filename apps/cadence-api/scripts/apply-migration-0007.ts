/**
 * Apply migrations/cadence/0007_weekly_trigger.sql. Purely additive (IF NOT EXISTS), safe to re-run.
 * Run: node --import tsx apps/cadence-api/scripts/apply-migration-0007.ts
 */
import { sql } from '../src/db/sql.ts';

async function main() {
  await sql`
    alter table cadence.users
      add column if not exists last_assessed_at timestamptz,
      add column if not exists pending_proposal jsonb`;

  const cols = await sql<{ column_name: string }[]>`
    select column_name from information_schema.columns
    where table_schema = 'cadence' and table_name = 'users'
      and column_name in ('last_assessed_at', 'pending_proposal')`;
  console.log('cadence.users columns present:', cols.map((c) => c.column_name).join(', '));
  await sql.end();
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
