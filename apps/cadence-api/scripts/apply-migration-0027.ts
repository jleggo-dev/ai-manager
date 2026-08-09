/**
 * Apply migrations/cadence/0027_coach_face_and_moments.sql. Additive + idempotent, safe to re-run.
 * Run: node --import tsx apps/cadence-api/scripts/apply-migration-0027.ts
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sql } from '../src/db/sql.ts';

async function main() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
  const ddl = readFileSync(path.join(root, 'migrations/cadence/0027_coach_face_and_moments.sql'), 'utf8');
  await sql.unsafe(ddl);

  const [col] = await sql<{ ok: boolean }[]>`
    select exists (
      select 1 from information_schema.columns
      where table_schema = 'cadence' and table_name = 'users' and column_name = 'coach_face_id'
    ) as ok`;
  console.log('cadence.users.coach_face_id:', col?.ok ? 'exists ✓' : '(missing!)');

  for (const table of ['session_feedback', 'daily_checkins']) {
    const [t] = await sql<{ ok: boolean }[]>`
      select exists (
        select 1 from information_schema.tables
        where table_schema = 'cadence' and table_name = ${table}
      ) as ok`;
    console.log(`cadence.${table}:`, t?.ok ? 'exists ✓' : '(missing!)');
  }

  // THE constraint this migration exists for. Without it a mind session could carry an RPE, and
  // the weekly check-in would silently read felt-state rows as effort data.
  const [chk] = await sql<{ ok: boolean }[]>`
    select exists (
      select 1 from pg_constraint
      where conname = 'session_feedback_kind_matches_answer'
    ) as ok`;
  console.log('kind/answer CHECK:', chk?.ok ? 'present ✓' : '(MISSING — mixed answers can land!)');

  // One answer per session. Re-answering must UPDATE; without this the upsert appends a second
  // opinion and anything averaging these double-counts.
  const [idx] = await sql<{ ok: boolean }[]>`
    select exists (
      select 1 from pg_indexes
      where schemaname = 'cadence' and tablename = 'session_feedback'
        and indexname = 'session_feedback_occurrence_idx'
    ) as ok`;
  console.log('one-answer-per-occurrence index:', idx?.ok ? 'present ✓' : '(MISSING — re-answers append!)');

  // Same reasoning as 0025/0026: a picked portrait and a mood are not dossier data, so these must
  // NOT touch the 0022 watermark — doing so would invalidate the context pack on every tap.
  const [trg] = await sql<{ n: number }[]>`
    select count(*)::int n from pg_trigger t
    join pg_class c on c.oid = t.tgrelid join pg_namespace ns on ns.oid = c.relnamespace
    where ns.nspname = 'cadence' and c.relname in ('session_feedback', 'daily_checkins') and not t.tgisinternal`;
  console.log('pack_touch triggers:', trg?.n === 0 ? 'none ✓ (correct)' : `${trg?.n} (unexpected!)`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
