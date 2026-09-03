/**
 * Collections — client for routes/repertoire-collections.ts (P11, migration 0056).
 *
 * Its own module rather than more exports on lib/api.ts's shared re-export index: a collection is a
 * distinct responsibility with its own screen, the same reason the seed and the list have their own.
 *
 * Same discriminated-union contract every other repertoire client uses: a crash comes back
 * `ok: false` WITH WORDS, never `ok: true` with an empty list — a screen that cannot tell "we broke"
 * from "you have no collections" will tell the person the wrong one. Where the server has its own
 * sentence — a duplicate name naming the spelling already on file — that sentence rides through
 * unchanged, because it is the only one that knows which collection they collided with.
 */
import type { RepertoireCollection } from '@cadence/shared';
import { BASE, headers } from './http.ts';

export type CollectionsResult = { ok: true; collections: RepertoireCollection[] } | { ok: false; fault: string };

export type CollectionResult = { ok: true; collection: RepertoireCollection } | { ok: false; fault: string };

export type CollectionRemoval = { ok: true } | { ok: false; fault: string };

const READ_FAULT =
  'I could not read your collections just now — a fault on our side, not an empty list. Try again in a moment.';
const ADD_FAULT = 'That did not save — a fault on our side. Try again in a moment.';
const RENAME_FAULT = 'That rename did not save — a fault on our side. Try again in a moment.';
const REMOVE_FAULT = 'That did not come off the list — a fault on our side. Try again in a moment.';

/** The route's own words when it has them; ours when the failure never reached a handler. */
function faultText(body: unknown, fallback: string): string {
  const error = (body as { error?: unknown } | null)?.error;
  return typeof error === 'string' && error.trim() ? error : fallback;
}

const url = (path = ''): string => `${BASE}/progress/repertoire/collections${path}`;

/** One collection off the wire, or null when the body is not one — an older server, or a shape
 *  change, must read as a fault rather than a row with an undefined name in it. */
function asCollection(body: unknown): RepertoireCollection | null {
  const row = body as { collection_id?: unknown; name?: unknown; item_count?: unknown } | null;
  if (typeof row?.collection_id !== 'string' || typeof row.name !== 'string') return null;
  return {
    collection_id: row.collection_id,
    name: row.name,
    item_count: typeof row.item_count === 'number' ? row.item_count : 0,
  };
}

/** GET /progress/repertoire/collections — every collection this person has, most-used first. */
export async function getCollections(): Promise<CollectionsResult> {
  const res = await fetch(url(), { headers: headers() }).catch(() => null);
  if (!res) return { ok: false, fault: READ_FAULT };
  const body = (await res.json().catch(() => null)) as { collections?: unknown } | null;
  if (!res.ok || !Array.isArray(body?.collections)) return { ok: false, fault: faultText(body, READ_FAULT) };
  return { ok: true, collections: body.collections as RepertoireCollection[] };
}

/** POST — make one. A name they already have comes back as the server's own sentence naming the
 *  spelling on file, so the person can pick that one instead of watching nothing happen. */
export async function addCollection(name: string): Promise<CollectionResult> {
  const res = await fetch(url(), { method: 'POST', headers: headers(), body: JSON.stringify({ name }) }).catch(
    () => null,
  );
  if (!res) return { ok: false, fault: ADD_FAULT };
  const body = (await res.json().catch(() => null)) as unknown;
  const collection = asCollection(body);
  if (!res.ok || !collection) return { ok: false, fault: faultText(body, ADD_FAULT) };
  return { ok: true, collection };
}

/** PATCH — rename in place. The row is the identity, so every item in it reads the new name. */
export async function renameCollection(id: string, name: string): Promise<CollectionResult> {
  const res = await fetch(url(`/${encodeURIComponent(id)}`), {
    method: 'PATCH',
    headers: headers(),
    body: JSON.stringify({ name }),
  }).catch(() => null);
  if (!res) return { ok: false, fault: RENAME_FAULT };
  const body = (await res.json().catch(() => null)) as unknown;
  const collection = asCollection(body);
  if (!res.ok || !collection) return { ok: false, fault: faultText(body, RENAME_FAULT) };
  return { ok: true, collection };
}

/** DELETE — the collection goes; every item in it stays on the list, ungrouped. */
export async function removeCollection(id: string): Promise<CollectionRemoval> {
  const res = await fetch(url(`/${encodeURIComponent(id)}`), { method: 'DELETE', headers: headers() }).catch(
    () => null,
  );
  if (!res) return { ok: false, fault: REMOVE_FAULT };
  if (!res.ok) return { ok: false, fault: faultText(await res.json().catch(() => null), REMOVE_FAULT) };
  return { ok: true };
}
