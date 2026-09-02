/**
 * Apply migrations/cadence/0053_meal_parts_and_draft.sql. Additive + idempotent, safe to re-run.
 * Run: node --import tsx apps/cadence-api/scripts/apply-migration-0053.ts
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sql } from '../src/db/sql.ts';

async function main() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
  await sql.unsafe(readFileSync(path.join(root, 'migrations/cadence/0053_meal_parts_and_draft.sql'), 'utf8'));

  const logCols = await sql<{ column_name: string }[]>`
    select column_name from information_schema.columns
     where table_schema = 'cadence' and table_name = 'nutrition_logs'
       and column_name in ('parts', 'state', 'closes_at')`;
  console.log(
    'nutrition_logs columns:',
    ['parts', 'state', 'closes_at']
      .map((c) => `${c}=${logCols.some((r) => r.column_name === c) ? 'present' : 'MISSING!'}`)
      .join(' '),
  );

  const userCols = await sql<{ column_name: string }[]>`
    select column_name from information_schema.columns
     where table_schema = 'cadence' and table_name = 'users'
       and column_name in ('pending_food_sweep', 'last_food_sweep_at')`;
  console.log(
    'users columns:',
    ['pending_food_sweep', 'last_food_sweep_at']
      .map((c) => `${c}=${userCols.some((r) => r.column_name === c) ? 'present' : 'MISSING!'}`)
      .join(' '),
  );

  const idx = await sql<{ indexname: string }[]>`
    select indexname from pg_indexes
     where schemaname = 'cadence' and tablename = 'nutrition_logs' and indexname = 'nutrition_open_idx'`;
  console.log('nutrition_open_idx:', idx.length ? 'present' : '(missing!)');
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
