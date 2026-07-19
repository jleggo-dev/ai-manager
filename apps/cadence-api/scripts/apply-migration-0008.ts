/**
 * Apply migrations/cadence/0008_goal_milestones.sql. Purely additive (IF NOT EXISTS), safe to re-run.
 * Run: node --import tsx apps/cadence-api/scripts/apply-migration-0008.ts
 */
import { sql } from '../src/db/sql.ts';

async function main() {
  await sql`alter table cadence.goals add column if not exists milestones jsonb not null default '[]'::jsonb`;
  const [col] = await sql<{ column_name: string; data_type: string }[]>`
    select column_name, data_type from information_schema.columns
    where table_schema = 'cadence' and table_name = 'goals' and column_name = 'milestones'`;
  console.log('goals.milestones:', col ? `${col.data_type} ✓` : '(missing!)');
  await sql.end();
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
