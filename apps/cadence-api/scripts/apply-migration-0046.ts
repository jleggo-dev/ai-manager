/**
 * Apply migrations/cadence/0046_progress_layouts.sql. Additive + idempotent, safe to re-run.
 * Run: node --import tsx apps/cadence-api/scripts/apply-migration-0046.ts
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sql } from '../src/db/sql.ts';

async function main() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
  await sql.unsafe(readFileSync(path.join(root, 'migrations/cadence/0046_progress_layouts.sql'), 'utf8'));

  const cols = await sql<{ column_name: string }[]>`
    select column_name from information_schema.columns
     where table_schema = 'cadence' and table_name = 'progress_layouts'
     order by ordinal_position`;
  console.log('columns:', cols.map((c) => c.column_name).join(', ') || '(missing!)');

  const idx = await sql<{ indexname: string }[]>`
    select indexname from pg_indexes where schemaname = 'cadence'
       and indexname in ('progress_layouts_user_idx', 'progress_layouts_committed_uidx') order by 1`;
  console.log('indexes:', idx.map((r) => r.indexname).join(', ') || '(none!)');
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
