/**
 * Apply migrations/cadence/0036_activity_commitment_id.sql. Additive + idempotent, safe to re-run.
 * Run: node --import tsx apps/cadence-api/scripts/apply-migration-0036.ts
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sql } from '../src/db/sql.ts';

async function main() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
  const ddl = readFileSync(path.join(root, 'migrations/cadence/0036_activity_commitment_id.sql'), 'utf8');
  await sql.unsafe(ddl);

  const [col] = await sql<{ nullable: string; def: string | null }[]>`
    select is_nullable as nullable, column_default as def
      from information_schema.columns
     where table_schema = 'cadence' and table_name = 'activities' and column_name = 'commitment_id'`;
  console.log('activities.commitment_id:', col ? `exists ✓ (nullable=${col.nullable}, default=${col.def})` : '(missing!)');

  // The backfill's whole job: the same commitment across plan versions must now be ONE id, and
  // same-titled rows inside a single plan must still be different ones.
  const [stats] = await sql<{ rows: number; lineages: number; orphans: number }[]>`
    select count(*)::int as rows,
           count(distinct commitment_id)::int as lineages,
           count(*) filter (where commitment_id is null)::int as orphans
      from cadence.activities`;
  console.log('activities:', stats?.rows, 'rows across', stats?.lineages, 'lineages; unassigned:', stats?.orphans);

  const dupes = await sql<{ plan_id: string; commitment_id: string; n: number }[]>`
    select plan_id, commitment_id, count(*)::int as n
      from cadence.activities
     group by plan_id, commitment_id having count(*) > 1`;
  console.log(
    dupes.length ? `⚠ ${dupes.length} plan(s) have a lineage twice — addressing would be ambiguous` : 'no lineage appears twice in one plan ✓',
  );
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
