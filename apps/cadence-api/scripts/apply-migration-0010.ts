/**
 * Apply migrations/cadence/0010_occurrence_session.sql. Purely additive (IF NOT EXISTS), safe to re-run.
 * Run: node --import tsx apps/cadence-api/scripts/apply-migration-0010.ts
 */
import { sql } from '../src/db/sql.ts';

async function main() {
  await sql`alter table cadence.occurrences add column if not exists session jsonb`;
  await sql`alter table cadence.occurrences add column if not exists log jsonb`;
  const cols = await sql<{ column_name: string; data_type: string }[]>`
    select column_name, data_type from information_schema.columns
    where table_schema = 'cadence' and table_name = 'occurrences' and column_name in ('session', 'log')
    order by column_name`;
  for (const c of cols) console.log(`occurrences.${c.column_name}: ${c.data_type} ✓`);
  if (cols.length !== 2) console.log('(missing columns!)');
  await sql.end();
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
