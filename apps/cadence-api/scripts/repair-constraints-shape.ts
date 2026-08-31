/**
 * Repair for the 2026-08-31 dedup mis-write: dedup-captured-facts.ts passed JSON.stringify(...)
 * as a parameter that the sql client encodes AGAIN, so baseline->'constraints' landed as a jsonb
 * STRING (whose text is the correct array) instead of an array — and the phone crashed at boot
 * mapping it. The array is intact inside the string; this parses it back in place. No parameters,
 * so there is nothing to double-encode; idempotent (the WHERE matches only the broken shape).
 */
import { sql } from '../src/db/sql.ts';

const fixed = await sql<Array<{ id: string }>>`
  update cadence.users
  set baseline = jsonb_set(baseline, '{constraints}', (baseline->>'constraints')::jsonb)
  where jsonb_typeof(baseline->'constraints') = 'string'
  returning id`;
console.log(`repaired ${fixed.length} user(s): ${fixed.map((r) => r.id).join(', ') || '(none needed it)'}`);

const check = await sql<Array<{ id: string; ctype: string; n: number | null }>>`
  select id, jsonb_typeof(baseline->'constraints') as ctype,
         case when jsonb_typeof(baseline->'constraints') = 'array'
              then jsonb_array_length(baseline->'constraints') end as n
  from cadence.users where baseline ? 'constraints'`;
for (const r of check) console.log(`${r.id}: constraints is ${r.ctype}${r.n === null ? '' : ` (${r.n} rows)`}`);
process.exit(0);
