import { sql, json } from '../db/sql.ts';
import { type MetronomeSpec, type RepertoireItem, type RepertoireStatus, tempoMeta } from '@cadence/shared';

// Timestamps cast to text — postgres.js Date-object trap (same as recipes/foods/nutrition): the
// shared type, the rotation math and every renderer expect ISO strings. A FUNCTION, not a
// module-level fragment: suites that mock db/sql import this module transitively, and a fragment
// built at import time calls the mock before it is callable (plan-fanout.test.ts found this).
const cols = () => sql`
  item_id, user_id, goal_id, label, status, kind, meta,
  started_at::text as started_at, learned_at::text as learned_at,
  last_practiced_at::text as last_practiced_at`;

/** Labels are stored NFC-normalized: iOS text paths routinely emit NFD ("École" as E + combining
 *  accent), and the unique index compares bytes — without this, the exact "Écossaise" the feature
 *  was built around could exist twice. */
const nfc = (s: string): string => s.normalize('NFC').trim();

/** Bounded: a render caps what it shows, but the query should not ship a pathological table. */
export async function listRepertoire(userId: string): Promise<RepertoireItem[]> {
  return sql<RepertoireItem[]>`
    select ${cols()} from cadence.repertoire
    where user_id = ${userId} order by status, lower(label) limit 300`;
}

/**
 * The distinct goal ids that have at least one item at all — plus null when unattached items
 * exist. Feeds the Progress page's availability/derivation ("does this goal have a repertoire card
 * to show") without shipping the whole table for that yes/no.
 *
 * No standing is excluded. It used to skip 'parked'; under the four standings there is no such
 * thing, and each of the four earns a place on the card — retired counts as learned, queued as not
 * started. A goal whose shelf is entirely finished material still has something to show.
 */
export async function listRepertoireGoalIds(userId: string): Promise<(string | null)[]> {
  const rows = await sql<{ goal_id: string | null }[]>`
    select distinct goal_id from cadence.repertoire where user_id = ${userId}`;
  return rows.map((r) => r.goal_id);
}

/**
 * One row per thing they can name: upsert on (user, lower(label)), so re-mentioning a piece
 * updates its standing instead of duplicating it. Two guards are load-bearing:
 *
 *  - **An omitted `status` keeps the existing one.** A bare re-mention ("played Blackbird again")
 *    must never demote a known piece out of the rotation pool; only a new row defaults to
 *    'working'. Every column here coalesces for the same reason.
 *  - **`learnedNow` reports whether THIS call stamped `learned_at`.** An already-learned piece
 *    re-mentioned as learned keeps its original date and reports false, so the caller writes the
 *    accomplishment to the goal history exactly once — never once per mention.
 */
/**
 * Insert or update one item, keyed on `lower(label)` by the table's unique index.
 *
 * **Callers must resolve the label first** — `canonicalLabel()` in repertoire-practice.ts. This
 * conflict target is Postgres `lower()`, which does not fold accents, so "Écossaise" and
 * "Ecossaise" reach it as two different keys and would become two rows for one piece. The
 * normalization that knows they are the same lives in TypeScript (`normTitle`), and is not
 * expressible in this index without duplicating the rule in SQL — so it is enforced above, and
 * this is the note saying so.
 */
export async function upsertRepertoireItem(
  userId: string,
  item: {
    label: string;
    status?: RepertoireStatus;
    goal_id?: string | null;
    kind?: string | null;
    meta?: Record<string, unknown> | null;
    markLearned?: boolean;
  },
): Promise<{ item: RepertoireItem; learnedNow: boolean }> {
  const learnedAt = item.markLearned ? new Date().toISOString() : null;
  const [row] = await sql<(RepertoireItem & { learned_now: boolean | null })[]>`
    insert into cadence.repertoire (user_id, goal_id, label, status, kind, meta, learned_at)
    values (
      ${userId}, ${item.goal_id ?? null}, ${nfc(item.label)}, ${item.status ?? 'working'},
      ${item.kind ?? null}, ${item.meta ? json(item.meta) : null}, ${learnedAt}
    )
    on conflict (user_id, lower(label)) do update set
      status = coalesce(${item.status ?? null}::text, cadence.repertoire.status),
      goal_id = coalesce(excluded.goal_id, cadence.repertoire.goal_id),
      kind = coalesce(excluded.kind, cadence.repertoire.kind),
      -- MERGE, never replace. meta is shared room (composer, book, settled tempo) written by
      -- different paths at different times; a plain coalesce made the last writer win and
      -- silently drop everything the others had put there.
      meta = coalesce(cadence.repertoire.meta, '{}'::jsonb) || coalesce(excluded.meta, '{}'::jsonb),
      learned_at = coalesce(cadence.repertoire.learned_at, excluded.learned_at),
      updated_at = now()
    returning ${cols()},
      (${item.markLearned ?? false} and learned_at = ${learnedAt}::timestamptz) as learned_now`;
  if (!row) throw new Error('upsertRepertoireItem: no row returned');
  const { learned_now, ...rest } = row;
  return { item: rest as RepertoireItem, learnedNow: learned_now === true };
}

/**
 * Record the tempo someone actually practises an item at. Merges into `meta` rather than writing
 * it whole, for the reason the upsert above now does too: the composer stored last month must
 * survive tonight's tempo change.
 *
 * Scoped by user_id as well as item_id — an id from a request body is not proof of ownership.
 */
export async function setSettledTempo(userId: string, itemId: string, spec: MetronomeSpec): Promise<void> {
  await sql`
    update cadence.repertoire
    -- Explicit ::jsonb on the bind: the concat operator is jsonb-only, and how the driver types a
    -- JSON parameter is not something this query should be depending on.
    set meta = coalesce(meta, '{}'::jsonb) || ${json(tempoMeta(spec))}::jsonb,
        updated_at = now()
    where user_id = ${userId} and item_id = ${itemId}`;
}

/** Stamp "they worked this" on the given rows. `at` lets a log recorded days later stamp the
 *  session's own date instead of today's — the rotation orders by when practice HAPPENED. Never
 *  moves a stamp backwards: re-logging an old session must not resurface a freshly-played piece. */
export async function stampPracticed(userId: string, itemIds: string[], at?: string): Promise<void> {
  if (!itemIds.length) return;
  await sql`
    update cadence.repertoire
    set last_practiced_at = greatest(coalesce(last_practiced_at, 'epoch'::timestamptz),
                                     coalesce(${at ?? null}::timestamptz, now())),
        updated_at = now()
    where user_id = ${userId} and item_id = any(${itemIds})`;
}

/**
 * Drop the cached session prescriptions a repertoire change makes stale. Sessions are generated
 * once and cached on the occurrence (`setOccurrenceSessionIfEmpty`), so without this a week
 * warmed in one burst names the same DUE NEXT piece all week, and occurrences warmed before a
 * repertoire write never see it at all. Scoped to the goal's own pending, future, user-kind rows
 * — each cleared row costs one regeneration on next open, bounded by that goal's week.
 */
export async function clearPendingSessionsForGoal(userId: string, goalId: string): Promise<number> {
  const rows = await sql<{ occurrence_id: string }[]>`
    update cadence.occurrences o
    set session = null
    from cadence.activities a
    where o.activity_id = a.activity_id
      and o.user_id = ${userId} and a.goal_id = ${goalId} and a.kind = 'user'
      and o.status = 'pending' and o.date >= current_date and o.session is not null
    returning o.occurrence_id`;
  return rows.length;
}

/* ── The item screen (P2: the item, opened) ───────────────────────────────────────────────────
   Rename, edit the qualifiers, flip the standing, or remove the row for good — the four writes
   the opened item makes. Kept as three separate functions rather than one big "patch" so the
   screen's own two independent actions ("Save the name" vs the standing control, which acts on
   its own) map onto two independent calls; the route decides which to run. */

/** Refused rename: another row already claims this exact `lower(label)` — the table's own unique
 *  key (`repertoire_user_label_uidx`). Carries the OTHER row's own label so the caller can say
 *  which piece it collided with, never a bare "conflict". */
export class RepertoireRenameConflictError extends Error {
  constructor(public readonly otherLabel: string) {
    super(`"${otherLabel}" already has this name`);
    this.name = 'RepertoireRenameConflictError';
  }
}

/**
 * Rename in place. The row (`item_id`) is the identity, never the label, so this is the one write
 * that changes NOTHING but the words — sessions, `meta` (settled tempo + qualifiers), `learned_at`
 * and `last_practiced_at` all ride the same row, untouched. NFC-normalized like every other write
 * to this column (`upsertRepertoireItem`'s `nfc()`, same reasoning: an NFD "École" from iOS must
 * land on the same key as its NFC spelling).
 *
 * A rename that would collide with another row's `lower(label)` is refused outright
 * (`RepertoireRenameConflictError`, naming the other piece) rather than merged into it or
 * silently suffixed — that row is a DIFFERENT piece with its own history, and nothing here is
 * allowed to guess otherwise. Scoped by user_id: an item_id from a request is not proof of
 * ownership. Returns null (not a throw) when no row matches this user + item_id.
 */
export async function renameRepertoireItem(
  userId: string,
  itemId: string,
  label: string,
): Promise<RepertoireItem | null> {
  const nextLabel = nfc(label);
  try {
    const [row] = await sql<RepertoireItem[]>`
      update cadence.repertoire set label = ${nextLabel}, updated_at = now()
      where user_id = ${userId} and item_id = ${itemId}
      returning ${cols()}`;
    return row ?? null;
  } catch (err) {
    if (err instanceof sql.PostgresError && err.code === '23505') {
      const [clash] = await sql<{ label: string }[]>`
        select label from cadence.repertoire
        where user_id = ${userId} and lower(label) = lower(${nextLabel}) and item_id != ${itemId}
        limit 1`;
      throw new RepertoireRenameConflictError(clash?.label ?? nextLabel);
    }
    throw err;
  }
}

/**
 * Standing + qualifiers, in one write. `meta` is MERGED with `||`, exactly as `setSettledTempo`
 * does — a tempo settled last night, or a composer typed in last week, must survive a standing
 * flip made today. `status` never writes `learned_at`: crossing into Keeping up "in front of us"
 * is the coach's `learned` verb alone (`upsertRepertoireItem`'s `markLearned`), so a standing
 * chosen from this screen is silent, the same as every other status change here (retiring,
 * re-queueing, backfilling known).
 *
 * Scoped by user_id. Returns null when no row matches — a wrong id is not nothing to report, but
 * it is nothing THIS caller may change.
 */
export async function updateRepertoireItem(
  userId: string,
  itemId: string,
  patch: { status?: RepertoireStatus; meta?: Record<string, unknown> | null },
): Promise<RepertoireItem | null> {
  const [row] = await sql<RepertoireItem[]>`
    update cadence.repertoire
    set status = coalesce(${patch.status ?? null}::text, status),
        meta = coalesce(meta, '{}'::jsonb) || coalesce(${patch.meta ? json(patch.meta) : null}::jsonb, '{}'::jsonb),
        updated_at = now()
    where user_id = ${userId} and item_id = ${itemId}
    returning ${cols()}`;
  return row ?? null;
}

/**
 * A real delete — distinct from retiring: the row is gone, not kept as "Learned". Sessions and
 * logs that named it keep their own text; only this link disappears, so nothing else needs to
 * change. Scoped by user_id; returns the deleted row's `goal_id` (so a caller can invalidate that
 * goal's cached sessions) or null when there was no such row for this user to delete.
 */
export async function deleteRepertoireItem(
  userId: string,
  itemId: string,
): Promise<{ item_id: string; goal_id: string | null } | null> {
  const [row] = await sql<{ item_id: string; goal_id: string | null }[]>`
    delete from cadence.repertoire where user_id = ${userId} and item_id = ${itemId}
    returning item_id, goal_id`;
  return row ?? null;
}
