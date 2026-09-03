/**
 * Collections — the groups a person files their material into (migration 0056).
 *
 * A collection is a ROW here, not a name copied onto every item (owner ruling 2026-09-03: *"a
 * collection only works if it's not free-text"*). Three things were impossible while it was a
 * name: renaming it in one place, having one before its first item, and telling two spellings of
 * one name apart from two real groups. The unique index on `(user_id, lower(name))` is what makes
 * the third true, and it is the SAME rule item labels already follow.
 *
 * Nothing here is domain-specific. A collection is a book, a syllabus, a reading list, a set of
 * poems, a grading ladder — there is no `kind` column and no order flag, because order already
 * lives on the item (`meta.rank`).
 *
 * Deleting one never deletes an item: the foreign key is `on delete set null`, so its items stay
 * on the person's list, ungrouped.
 */
import { sql } from '../db/sql.ts';
import type { RepertoireCollection } from '@cadence/shared';

/** Longest a name may be — the table's own check constraint, restated so a bad name is refused
 *  here with words rather than reaching Postgres as a constraint violation. */
export const COLLECTION_NAME_MAX = 120;

/**
 * The key two names are compared on: trimmed and lower-cased, and deliberately nothing else.
 *
 * This is the TypeScript spelling of the unique index (`lower(name)`) — a SPELLING guard, never a
 * matcher. Anything fuzzier ("Suzuki 2" ≈ "Suzuki Book 2") would file an item under a group the
 * person did not choose, which is worse than a second group they can see and merge. Exported so
 * the rule is table-tested in one place rather than re-derived at each call site.
 */
export const collectionKey = (name: string): string => name.trim().toLowerCase();

/** Names are stored NFC-normalized and trimmed, the same treatment item labels get: iOS text paths
 *  emit NFD ("École" as E + combining accent) and the unique index compares bytes. */
const clean = (name: string): string => name.normalize('NFC').trim().slice(0, COLLECTION_NAME_MAX);

/**
 * Refused create or rename: this person already has a collection with this name, ignoring case.
 * Carries the EXISTING spelling so the caller can say which one it collided with — the same shape
 * `RepertoireRenameConflictError` uses for items, and for the same reason: "conflict" alone gives
 * the person nothing to act on.
 */
export class RepertoireCollectionConflictError extends Error {
  constructor(public readonly existingName: string) {
    super(`You already have a collection called "${existingName}".`);
    this.name = 'RepertoireCollectionConflictError';
  }
}

const SELECT_COLS = () => sql`
  c.collection_id, c.name,
  (select count(*)::int from cadence.repertoire r where r.collection_id = c.collection_id) as item_count`;

/**
 * Every collection this person has, most-used first with the name breaking a tie.
 *
 * That order is the item screen's picker order (P10 offered the shelf's own vocabulary first), and
 * it is stable between reads, so the collections screen and the picker never disagree about which
 * row comes first. A collection with no items counts zero and still appears — it exists because
 * they made it, not because something points at it.
 */
export async function listCollections(userId: string): Promise<RepertoireCollection[]> {
  return sql<RepertoireCollection[]>`
    select ${SELECT_COLS()}
    from cadence.repertoire_collections c
    where c.user_id = ${userId}
    order by item_count desc, lower(c.name)
    limit 300`;
}

/** The row whose name matches, ignoring case, or null. The read half of `resolveCollectionByName`,
 *  and what a refused write reads back to name the spelling already on file. */
async function findByName(userId: string, name: string): Promise<RepertoireCollection | null> {
  const [row] = await sql<RepertoireCollection[]>`
    select ${SELECT_COLS()}
    from cadence.repertoire_collections c
    where c.user_id = ${userId} and lower(c.name) = ${collectionKey(name)}
    limit 1`;
  return row ?? null;
}

/** One row by id, scoped to its owner — an id from a request body is not proof of ownership. */
async function findById(userId: string, id: string): Promise<RepertoireCollection | null> {
  const [row] = await sql<RepertoireCollection[]>`
    select ${SELECT_COLS()}
    from cadence.repertoire_collections c
    where c.user_id = ${userId} and c.collection_id = ${id}
    limit 1`;
  return row ?? null;
}

const isDuplicate = (err: unknown): boolean => err instanceof sql.PostgresError && err.code === '23505';

/**
 * Make one, in the spelling they typed. A name this person already has — ignoring case — is
 * REFUSED rather than folded onto silently: they asked for a new collection and would otherwise
 * watch nothing happen. `resolveCollectionByName` is the folding door, for the writers (the coach,
 * the seed) that are naming a collection rather than making one.
 */
export async function createCollection(userId: string, name: string): Promise<RepertoireCollection> {
  const next = clean(name);
  try {
    const [row] = await sql<{ collection_id: string; name: string }[]>`
      insert into cadence.repertoire_collections (user_id, name)
      values (${userId}, ${next})
      returning collection_id, name`;
    if (!row) throw new Error('createCollection: no row returned');
    return { collection_id: row.collection_id, name: row.name, item_count: 0 };
  } catch (err) {
    if (!isDuplicate(err)) throw err;
    const existing = await findByName(userId, next);
    throw new RepertoireCollectionConflictError(existing?.name ?? next);
  }
}

/**
 * Rename in place. The row is the identity, never the name, so every item stays pointed at it and
 * the new name appears everywhere at once — the whole reason a collection became a row.
 *
 * Changing only the CASE of its own name is a legitimate rename and passes: the unique index does
 * not collide a row with itself. A name another of their collections already holds is refused,
 * naming that one. Returns null when this user has no such collection.
 */
export async function renameCollection(userId: string, id: string, name: string): Promise<RepertoireCollection | null> {
  const next = clean(name);
  try {
    const [row] = await sql<{ collection_id: string }[]>`
      update cadence.repertoire_collections set name = ${next}, updated_at = now()
      where user_id = ${userId} and collection_id = ${id}
      returning collection_id`;
    if (!row) return null;
    return findById(userId, id);
  } catch (err) {
    if (!isDuplicate(err)) throw err;
    const [clash] = await sql<{ name: string }[]>`
      select name from cadence.repertoire_collections
      where user_id = ${userId} and lower(name) = ${collectionKey(next)} and collection_id != ${id}
      limit 1`;
    throw new RepertoireCollectionConflictError(clash?.name ?? next);
  }
}

/**
 * Remove the collection. THE ITEMS IN IT ARE NOT TOUCHED — the foreign key is `on delete set
 * null`, so each one keeps its row, its history and its standing, and simply stops being grouped.
 * Returns false when this user has no such collection, so the route can 404 rather than report a
 * delete that deleted nothing.
 */
export async function deleteCollection(userId: string, id: string): Promise<boolean> {
  const rows = await sql<{ collection_id: string }[]>`
    delete from cadence.repertoire_collections
    where user_id = ${userId} and collection_id = ${id}
    returning collection_id`;
  return rows.length > 0;
}

/**
 * The collection this NAME means for this person: the one already on file whose name matches
 * ignoring case, or a new one in the spelling given.
 *
 * The door for every writer that names a collection instead of choosing one — the coach's
 * `update_repertoire`, and the seed confirm. Trim plus lower-case equality and nothing else, the
 * same guard `collectionKey` describes.
 *
 * A concurrent create losing the race reads the winner back rather than failing: two writes of one
 * name must land on one collection, which is the entire point of the row.
 */
export async function resolveCollectionByName(userId: string, name: string): Promise<RepertoireCollection> {
  const next = clean(name);
  const existing = await findByName(userId, next);
  if (existing) return existing;
  try {
    return await createCollection(userId, next);
  } catch (err) {
    if (!(err instanceof RepertoireCollectionConflictError)) throw err;
    const raced = await findByName(userId, next);
    if (!raced) throw err;
    return raced;
  }
}
