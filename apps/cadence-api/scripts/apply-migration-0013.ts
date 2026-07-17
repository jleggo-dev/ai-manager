/**
 * Apply migrations/cadence/0013_nutrition_observe.sql. Additive + idempotent, safe to re-run.
 * Run: node --import tsx apps/cadence-api/scripts/apply-migration-0013.ts
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sql } from '../src/db/sql.ts';

async function main() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
  const ddl = readFileSync(path.join(root, 'migrations/cadence/0013_nutrition_observe.sql'), 'utf8');
  await sql.unsafe(ddl);
  const [t] = await sql<{ ok: boolean }[]>`
    select exists (
      select 1 from information_schema.columns
      where table_schema = 'cadence' and table_name = 'nutrition_logs' and column_name = 'raw_text'
    ) as ok`;
  const [c] = await sql<{ def: string }[]>`
    select pg_get_constraintdef(oid) as def from pg_constraint
    where conrelid = 'cadence.nutrition_logs'::regclass and conname = 'nutrition_logs_meal_check'`;
  console.log('nutrition_logs.raw_text:', t?.ok ? 'exists ✓' : '(missing!)');
  console.log('meal check:', c?.def?.includes("'drink'") ? "includes 'drink'/'other' ✓" : c?.def);
  await sql.end();
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
