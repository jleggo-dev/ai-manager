/**
 * Apply migrations/cadence/0005_area_constraints.sql (goals.category→area + baseline
 * constraints unification). Verifies the legacy CHECK constraint name first so the drop
 * can't silently miss, and prints the resulting column/constraint state.
 * Run: node --import tsx apps/cadence-api/scripts/apply-migration-0005.ts
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sql } from '../src/db/sql.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

async function main() {
  const checks = await sql<{ conname: string; def: string }[]>`
    select conname, pg_get_constraintdef(oid) as def
    from pg_constraint
    where conrelid = 'cadence.goals'::regclass and contype = 'c'`;
  console.log('goals CHECK constraints before:');
  for (const c of checks) console.log(`  ${c.conname}: ${c.def}`);

  const legacy = checks.find((c) => c.def.includes("'fitness'"));
  const file = readFileSync(path.join(root, 'migrations/cadence/0005_area_constraints.sql'), 'utf8');
  let ddl = file;
  if (legacy && legacy.conname !== 'goals_category_check') {
    console.log(`legacy check is named ${legacy.conname} — adjusting DROP`);
    ddl = ddl.replace('goals_category_check', legacy.conname);
  }
  if (!legacy) console.log('no legacy fitness CHECK found (already migrated?) — running anyway (idempotent-ish)');

  await sql.unsafe(ddl);

  const after = await sql<{ conname: string; def: string }[]>`
    select conname, pg_get_constraintdef(oid) as def
    from pg_constraint
    where conrelid = 'cadence.goals'::regclass and contype = 'c'`;
  console.log('goals CHECK constraints after:');
  for (const c of after) console.log(`  ${c.conname}: ${c.def}`);
  const cols = await sql<{ column_name: string }[]>`
    select column_name from information_schema.columns
    where table_schema = 'cadence' and table_name = 'goals' and column_name in ('area','category')`;
  console.log('goals area/category columns:', cols.map((c) => c.column_name).join(', '));
  await sql.end();
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
