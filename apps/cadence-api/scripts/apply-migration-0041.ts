/**
 * Apply migrations/cadence/0041_foods_fatsecret.sql. Additive + idempotent, safe to re-run.
 * Run: node --import tsx apps/cadence-api/scripts/apply-migration-0041.ts
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sql } from '../src/db/sql.ts';

async function main() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
  await sql.unsafe(readFileSync(path.join(root, 'migrations/cadence/0041_foods_fatsecret.sql'), 'utf8'));

  const cols = await sql<{ column_name: string }[]>`
    select column_name from information_schema.columns
     where table_schema = 'cadence' and table_name = 'foods'
       and column_name in ('fatsecret_id', 'source_fetched_at')
     order by column_name`;
  console.log('columns:', cols.map((c) => c.column_name).join(', ') || '(missing!)');

  const [chk] = await sql<{ def: string }[]>`
    select pg_get_constraintdef(oid) as def from pg_constraint
     where conrelid = 'cadence.foods'::regclass and conname = 'foods_source_check'`;
  console.log('source check allows fatsecret:', chk?.def.includes('fatsecret') ? '✓' : '(no!)');

  const idx = await sql<{ indexname: string }[]>`
    select indexname from pg_indexes where schemaname = 'cadence'
       and indexname in ('foods_fatsecret_id_uidx', 'foods_fatsecret_stale_idx') order by 1`;
  console.log('indexes:', idx.map((r) => r.indexname).join(', ') || '(none!)');
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
