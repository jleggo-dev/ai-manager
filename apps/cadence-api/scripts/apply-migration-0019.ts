/**
 * Apply migrations/cadence/0019_meal_plans.sql. Additive + idempotent, safe to re-run.
 * Run: node --import tsx apps/cadence-api/scripts/apply-migration-0019.ts
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sql } from '../src/db/sql.ts';

async function main() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
  const ddl = readFileSync(path.join(root, 'migrations/cadence/0019_meal_plans.sql'), 'utf8');
  await sql.unsafe(ddl);

  const [notes] = await sql<{ ok: boolean }[]>`
    select exists (
      select 1 from information_schema.columns
      where table_schema = 'cadence' and table_name = 'meal_plans' and column_name = 'notes'
    ) as ok`;
  const [updated] = await sql<{ ok: boolean }[]>`
    select exists (
      select 1 from information_schema.columns
      where table_schema = 'cadence' and table_name = 'meal_plans' and column_name = 'updated_at'
    ) as ok`;
  const [uidx] = await sql<{ ok: boolean }[]>`
    select exists (
      select 1 from pg_indexes
      where schemaname = 'cadence' and indexname = 'meal_plans_user_week_uidx'
    ) as ok`;

  console.log('meal_plans.notes:', notes?.ok ? 'exists ✓' : '(missing!)');
  console.log('meal_plans.updated_at:', updated?.ok ? 'exists ✓' : '(missing!)');
  console.log('meal_plans_user_week_uidx:', uidx?.ok ? 'exists ✓' : '(missing!)');
  await sql.end();
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
