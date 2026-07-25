/**
 * Apply migrations/cadence/0018_foods_usda.sql. Additive + idempotent, safe to re-run.
 * Run: node --import tsx apps/cadence-api/scripts/apply-migration-0018.ts
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sql } from '../src/db/sql.ts';

async function main() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
  const ddl = readFileSync(path.join(root, 'migrations/cadence/0018_foods_usda.sql'), 'utf8');
  await sql.unsafe(ddl);

  const [col] = await sql<{ ok: boolean }[]>`
    select exists (
      select 1 from information_schema.columns
      where table_schema = 'cadence' and table_name = 'foods' and column_name = 'fdc_id'
    ) as ok`;
  const [src] = await sql<{ def: string }[]>`
    select pg_get_constraintdef(oid) as def from pg_constraint
    where conrelid = 'cadence.foods'::regclass and conname = 'foods_source_check'`;
  const [idx] = await sql<{ ok: boolean }[]>`
    select exists (
      select 1 from pg_indexes
      where schemaname = 'cadence' and indexname = 'foods_fdc_id_uidx'
    ) as ok`;

  console.log('foods.fdc_id:', col?.ok ? 'exists ✓' : '(missing!)');
  console.log(
    'foods.source:',
    src?.def?.includes("'usda'") ? "includes 'usda' ✓" : src?.def,
  );
  console.log('foods_fdc_id_uidx:', idx?.ok ? 'exists ✓' : '(missing!)');
  await sql.end();
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
