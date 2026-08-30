import { sql, json } from '../db/sql.ts';
import type { RepertoireItem, RepertoireStatus } from '@cadence/shared';

/** Timestamps cast to text — postgres.js returns timestamptz as a JS Date otherwise, and the
 *  shared type (plus the rotation math and every renderer) expects ISO strings. */
export async function listRepertoire(userId: string): Promise<RepertoireItem[]> {
  return sql<RepertoireItem[]>`
    select item_id, user_id, goal_id, label, status, kind, meta,
           started_at::text as started_at, learned_at::text as learned_at,
           last_practiced_at::text as last_practiced_at
    from cadence.repertoire
    where user_id = ${userId} order by status, lower(label)`;
}

/**
 * One row per thing they can name: upsert on (user, lower(label)), so re-mentioning a piece
 * updates its standing instead of duplicating it. A move onto 'known' stamps learned_at ONLY
 * when asked (`markLearned` — it crossed the line in front of us); backfilled items they
 * already knew get no fake anniversary, and an existing learned_at is never overwritten.
 */
export async function upsertRepertoireItem(
  userId: string,
  item: {
    label: string;
    status: RepertoireStatus;
    goal_id?: string | null;
    kind?: string | null;
    meta?: Record<string, unknown> | null;
    markLearned?: boolean;
  },
): Promise<RepertoireItem> {
  const learnedAt = item.markLearned ? new Date().toISOString() : null;
  const [row] = await sql<RepertoireItem[]>`
    insert into cadence.repertoire (user_id, goal_id, label, status, kind, meta, learned_at)
    values (
      ${userId}, ${item.goal_id ?? null}, ${item.label}, ${item.status},
      ${item.kind ?? null}, ${item.meta ? json(item.meta) : null}, ${learnedAt}
    )
    on conflict (user_id, lower(label)) do update set
      status = excluded.status,
      goal_id = coalesce(excluded.goal_id, cadence.repertoire.goal_id),
      kind = coalesce(excluded.kind, cadence.repertoire.kind),
      meta = coalesce(excluded.meta, cadence.repertoire.meta),
      learned_at = coalesce(cadence.repertoire.learned_at, excluded.learned_at),
      updated_at = now()
    returning item_id, user_id, goal_id, label, status, kind, meta,
              started_at::text as started_at, learned_at::text as learned_at,
              last_practiced_at::text as last_practiced_at`;
  if (!row) throw new Error('upsertRepertoireItem: no row returned');
  return row;
}

/**
 * Stamp "they worked this today" on any item whose label appears in the text — the write-back
 * that makes the rotation rotate. Case-insensitive containment, and deliberately dumb rather
 * than fuzzy: a miss costs one stale date, a false hit corrupts the rotation. Labels shorter
 * than 4 characters never match ("Air" would hit half of English). Returns the labels touched.
 */
export async function touchPracticedFromText(userId: string, text: string): Promise<string[]> {
  if (!text.trim()) return [];
  const items = await listRepertoire(userId);
  const hay = text.toLowerCase();
  const touched = items.filter((i) => {
    const full = i.label.toLowerCase().trim();
    // "A Short Story (Lichner)" must match a log that says "ran through A Short Story" — the
    // stored label carries a qualifier the user's own words never will, so the core (label with
    // parentheticals stripped) is a needle too.
    const core = full.replace(/\s*\([^)]*\)/g, '').trim();
    return [full, core].some((needle) => needle.length >= 4 && hay.includes(needle));
  });
  if (!touched.length) return [];
  await sql`
    update cadence.repertoire set last_practiced_at = now(), updated_at = now()
    where user_id = ${userId} and item_id = any(${touched.map((i) => i.item_id)})`;
  return touched.map((i) => i.label);
}
