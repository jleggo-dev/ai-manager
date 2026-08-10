/**
 * Apply migrations/cadence/0030_goal_brief.sql. Additive + idempotent, safe to re-run.
 * Run: node --import tsx apps/cadence-api/scripts/apply-migration-0030.ts
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sql } from '../src/db/sql.ts';

async function main() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
  const ddl = readFileSync(path.join(root, 'migrations/cadence/0030_goal_brief.sql'), 'utf8');
  await sql.unsafe(ddl);

  const [col] = await sql<{ ok: boolean }[]>`
    select exists (
      select 1 from information_schema.columns
      where table_schema = 'cadence' and table_name = 'goals' and column_name = 'brief'
    ) as ok`;
  console.log('cadence.goals.brief:', col?.ok ? 'exists ✓' : '(missing!)');

  // Nullable is the design: a goal whose owner hasn't said much yet is a normal goal, and a
  // NOT NULL here would push someone into inventing a brief to save a row.
  const [nullable] = await sql<{ yes: string }[]>`
    select is_nullable as yes from information_schema.columns
    where table_schema = 'cadence' and table_name = 'goals' and column_name = 'brief'`;
  console.log('nullable:', nullable?.yes === 'YES' ? 'YES ✓' : `${nullable?.yes} (unexpected!)`);

  // Existing rows keep their null — this migration backfills nothing and must not.
  const [counts] = await sql<{ total: number; with_brief: number }[]>`
    select count(*)::int as total, count(brief)::int as with_brief from cadence.goals`;
  console.log(`goals: ${counts?.total ?? 0} total, ${counts?.with_brief ?? 0} with a brief`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
