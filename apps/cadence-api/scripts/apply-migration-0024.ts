/**
 * Apply migrations/cadence/0024_health_digests.sql. Additive + idempotent, safe to re-run.
 * Run: node --import tsx apps/cadence-api/scripts/apply-migration-0024.ts
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sql } from '../src/db/sql.ts';

async function main() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
  const ddl = readFileSync(path.join(root, 'migrations/cadence/0024_health_digests.sql'), 'utf8');
  await sql.unsafe(ddl);
  const [t] = await sql<{ ok: boolean }[]>`
    select exists (
      select 1 from information_schema.tables where table_schema = 'cadence' and table_name = 'health_digests'
    ) as ok`;
  const [trg] = await sql<{ ok: boolean }[]>`
    select exists (
      select 1 from pg_trigger t join pg_class c on c.oid = t.tgrelid
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'cadence' and c.relname = 'health_digests' and t.tgname = 'pack_touch'
    ) as ok`;
  console.log('cadence.health_digests:', t?.ok ? 'exists ✓' : '(missing!)');
  console.log('pack_touch trigger:', trg?.ok ? 'installed ✓' : '(missing!)');
  await sql.end();
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
