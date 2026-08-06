/**
 * Apply migrations/cadence/0025_weather_cache.sql. Additive + idempotent, safe to re-run.
 * Run: node --import tsx apps/cadence-api/scripts/apply-migration-0025.ts
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sql } from '../src/db/sql.ts';

async function main() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
  const ddl = readFileSync(path.join(root, 'migrations/cadence/0025_weather_cache.sql'), 'utf8');
  await sql.unsafe(ddl);
  const [t] = await sql<{ ok: boolean }[]>`
    select exists (
      select 1 from information_schema.tables where table_schema = 'cadence' and table_name = 'weather_cache'
    ) as ok`;
  // Guard the two properties the migration header argues for: no pack_touch trigger (weather is
  // ambient, not dossier data) and no user column (rows are shared per place, not per person).
  const [trg] = await sql<{ n: number }[]>`
    select count(*)::int n from pg_trigger t
    join pg_class c on c.oid = t.tgrelid join pg_namespace ns on ns.oid = c.relnamespace
    where ns.nspname = 'cadence' and c.relname = 'weather_cache' and not t.tgisinternal`;
  const [uid] = await sql<{ n: number }[]>`
    select count(*)::int n from information_schema.columns
    where table_schema = 'cadence' and table_name = 'weather_cache' and column_name = 'user_id'`;
  console.log('cadence.weather_cache:', t?.ok ? 'exists ✓' : '(missing!)');
  console.log('no pack_touch trigger:', trg?.n === 0 ? 'confirmed ✓' : `(${trg?.n} trigger(s)!)`);
  console.log('not user-scoped:', uid?.n === 0 ? 'confirmed ✓' : '(has user_id!)');
  await sql.end();
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
