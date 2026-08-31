/**
 * One-time cleanup for duplicates the pre-2026-08-31 matchers let in: constraints split by a
 * plural or a moved stopword, and equipment rows split by number wording ("two 50lb dumbbells"
 * beside "2x50lb dumbbells"). Re-runs are safe — a clean file merges to itself.
 *
 *   node --import tsx apps/cadence-api/scripts/dedup-captured-facts.ts           # dry run: report only
 *   node --import tsx apps/cadence-api/scripts/dedup-captured-facts.ts --apply   # write the merges
 *
 * Constraints: each user's list is self-merged through mergeConstraints (first row keeps its id;
 * the fuller label survives). Equipment: rows grouped by sameEquipmentName; the EARLIEST row in a
 * group survives (stable id), the rest are deleted. Nothing here invents data — it only folds
 * retellings of one fact into one row, the same rule every future write now applies.
 */
import { json, sql } from '../src/db/sql.ts';
import { mergeConstraints } from '../src/services/constraint-merge.ts';
import { sameEquipmentName } from '../src/services/fact-tokens.ts';
import type { Constraint } from '@cadence/shared';

const APPLY = process.argv.includes('--apply');

interface UserRow {
  id: string;
  constraints: Constraint[] | null;
}

interface EquipRow {
  equipment_id: string;
  user_id: string;
  name: string;
  created_at: string;
}

async function dedupConstraints(): Promise<void> {
  const users = await sql<UserRow[]>`
    select id, baseline->'constraints' as constraints from cadence.users
    where jsonb_array_length(coalesce(baseline->'constraints', '[]'::jsonb)) > 1`;
  for (const u of users) {
    const before = u.constraints ?? [];
    const after = mergeConstraints([], before);
    if (after.length === before.length) continue;
    console.log(`user ${u.id}: constraints ${before.length} → ${after.length}`);
    for (const c of before) {
      if (!after.some((a) => a.id === c.id)) console.log(`  folded: "${c.label}"`);
    }
    for (const a of after) console.log(`  keeps:  "${a.label}"${a.status ? ` (${a.status})` : ''}`);
    if (APPLY) {
      // `json()`, never a pre-stringified param: the client encodes params itself, and stringifying
      // first double-encoded this very write on 2026-08-31 — constraints landed as a jsonb STRING
      // and the phone crashed at boot mapping it (see scripts/repair-constraints-shape.ts).
      await sql`
        update cadence.users set baseline = jsonb_set(baseline, '{constraints}', ${json(after)})
        where id = ${u.id}`;
      console.log('  written');
    }
  }
}

async function dedupEquipment(): Promise<void> {
  const rows = await sql<EquipRow[]>`
    select equipment_id, user_id, name, created_at from cadence.equipment order by user_id, created_at asc`;
  const byUser = new Map<string, EquipRow[]>();
  for (const r of rows) {
    const list = byUser.get(r.user_id) ?? [];
    list.push(r);
    byUser.set(r.user_id, list);
  }
  for (const [userId, list] of byUser) {
    const kept: EquipRow[] = [];
    for (const r of list) {
      const dupOf = kept.find((k) => sameEquipmentName(k.name, r.name));
      if (!dupOf) {
        kept.push(r);
        continue;
      }
      console.log(`user ${userId}: equipment "${r.name}" is a retelling of "${dupOf.name}" — dropping the later row`);
      if (APPLY) {
        await sql`delete from cadence.equipment where equipment_id = ${r.equipment_id}`;
        console.log('  deleted');
      }
    }
  }
}

console.log(APPLY ? 'APPLY run — writing merges.' : 'Dry run — reporting only (pass --apply to write).');
await dedupConstraints();
await dedupEquipment();
console.log('done');
process.exit(0);
