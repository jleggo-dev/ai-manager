/**
 * Apply migrations/cadence/0006_p1_nomenclature.sql. Verifies the real CHECK-constraint names
 * (goals.status, equipment.category) before dropping, and skips the episodes column rename if
 * already applied. Idempotent-ish and safe to re-run.
 * Run: node --import tsx apps/cadence-api/scripts/apply-migration-0006.ts
 */
import { sql } from '../src/db/sql.ts';

async function checkName(table: string, needle: string): Promise<string | null> {
  const rows = await sql<{ conname: string; def: string }[]>`
    select conname, pg_get_constraintdef(oid) as def
    from pg_constraint
    where conrelid = ${`cadence.${table}`}::regclass and contype = 'c'`;
  return rows.find((r) => r.def.includes(needle))?.conname ?? null;
}

async function columnExists(table: string, col: string): Promise<boolean> {
  const rows = await sql`
    select 1 from information_schema.columns
    where table_schema = 'cadence' and table_name = ${table} and column_name = ${col}`;
  return rows.length > 0;
}

async function main() {
  // 1. goals.status locked → committed
  await sql`update cadence.goals set status = 'committed' where status = 'locked'`;
  const statusCheck = await checkName('goals', "'locked'");
  if (statusCheck) await sql.unsafe(`alter table cadence.goals drop constraint ${statusCheck}`);
  await sql`alter table cadence.goals add constraint goals_status_check
    check (status in ('captured','confirmed','committed','parked','completed','abandoned'))`.catch((e) => {
    if (!String(e).includes('already exists')) throw e;
  });
  console.log(`goals.status: dropped ${statusCheck ?? '(none)'} → committed CHECK in place`);

  // 2. equipment.category broaden
  const equipCheck = await checkName('equipment', "'footwear'");
  if (equipCheck) await sql.unsafe(`alter table cadence.equipment drop constraint ${equipCheck}`);
  await sql`alter table cadence.equipment add constraint equipment_category_check
    check (category in ('footwear','cardio','strength','accessory','reading','practice','craft','study','other'))`.catch((e) => {
    if (!String(e).includes('already exists')) throw e;
  });
  console.log(`equipment.category: dropped ${equipCheck ?? '(none)'} → broadened CHECK in place`);

  // 3. episodes.protect_streak → protect_momentum
  if (await columnExists('episodes', 'protect_streak')) {
    await sql`alter table cadence.episodes rename column protect_streak to protect_momentum`;
    console.log('episodes.protect_streak → protect_momentum');
  } else {
    console.log('episodes.protect_momentum already in place');
  }

  // Verify
  const goalDef = await sql<{ def: string }[]>`
    select pg_get_constraintdef(oid) as def from pg_constraint
    where conrelid = 'cadence.goals'::regclass and contype='c' and pg_get_constraintdef(oid) ilike '%committed%'`;
  console.log('goals.status CHECK now:', goalDef[0]?.def ?? '(missing!)');
  await sql.end();
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
