/**
 * Apply migrations/cadence/0017_food_and_recipes.sql. Additive + idempotent, safe to re-run.
 * Run: node --import tsx apps/cadence-api/scripts/apply-migration-0017.ts
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sql } from '../src/db/sql.ts';

async function main() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
  const ddl = readFileSync(path.join(root, 'migrations/cadence/0017_food_and_recipes.sql'), 'utf8');
  await sql.unsafe(ddl);

  const [foods] = await sql<{ ok: boolean }[]>`
    select to_regclass('cadence.foods') is not null as ok`;
  const [usage] = await sql<{ ok: boolean }[]>`
    select to_regclass('cadence.food_usage') is not null as ok`;
  const [dietary] = await sql<{ ok: boolean }[]>`
    select exists (
      select 1 from information_schema.columns
      where table_schema = 'cadence' and table_name = 'users' and column_name = 'dietary_profile'
    ) as ok`;
  const [recipeId] = await sql<{ ok: boolean }[]>`
    select exists (
      select 1 from information_schema.columns
      where table_schema = 'cadence' and table_name = 'nutrition_logs' and column_name = 'recipe_id'
    ) as ok`;
  const [src] = await sql<{ def: string }[]>`
    select pg_get_constraintdef(oid) as def from pg_constraint
    where conrelid = 'cadence.recipes'::regclass and conname = 'recipes_source_check'`;

  console.log('cadence.foods:', foods?.ok ? 'exists ✓' : '(missing!)');
  console.log('cadence.food_usage:', usage?.ok ? 'exists ✓' : '(missing!)');
  console.log('users.dietary_profile:', dietary?.ok ? 'exists ✓' : '(missing!)');
  console.log('nutrition_logs.recipe_id:', recipeId?.ok ? 'exists ✓' : '(missing!)');
  console.log(
    'recipes.source:',
    src?.def?.includes('ai_from_chat') ? "includes 'ai_from_chat' ✓" : src?.def,
  );
  await sql.end();
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
