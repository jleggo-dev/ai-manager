/**
 * Seeding a collection — client for routes/repertoire-seed.ts (design frame 1c).
 *
 * Its own module rather than a few more exports on lib/api.ts: the seed is a distinct
 * responsibility with its own screen, and this file owns the wire contract both sides are built to.
 *
 * The contract that matters is the discriminator. "I don't know that book" comes back as an empty
 * candidate list with `ok: true`; anything that BROKE — a 502 from the route, a dead socket, JSON
 * that will not parse — comes back as `ok: false` with words. A screen that renders a crash as
 * "0 pieces found" tells the person their book is not in there, confidently, and they believe it.
 */
import type { SeedStatus } from '@cadence/shared';
import { BASE, headers, timeoutSignal } from './http.ts';

/** One piece the server proposed. Nothing is stored until `confirmSeed`. */
export interface SeedCandidate {
  label: string;
  composer: string | null;
  collection: string | null;
  catalogue: string | null;
  /** 1-based position in the collection's own order. */
  rank: number;
  /** The server could not tell this title apart from another one — the row says so. */
  ambiguous: boolean;
}

/** One row the person confirmed. `status` is the shared union, so client and route cannot drift.
 *  `rank` is null for a piece with no real order (a single hand-added item, P6 "the room") — the
 *  route's own schema already accepts that (`routes/repertoire-seed.ts`'s `rank: ….nullish()`);
 *  a book expansion's rows always carry their real 1-based position instead. */
export interface SeedWriteRow {
  label: string;
  composer: string | null;
  collection: string | null;
  catalogue: string | null;
  rank: number | null;
  status: SeedStatus;
}

export type SeedExpansion =
  { ok: true; collection: string; candidates: SeedCandidate[] } | { ok: false; fault: string };

/** A row the server would not write, with the words that say what to change about it. */
export interface RefusedSeedRow {
  label: string;
  reason: string;
}

export type SeedConfirmation =
  { ok: true; written: number; labels: string[]; refused: RefusedSeedRow[] } | { ok: false; fault: string };

const EXPAND_FAULT =
  'I could not look that up just now — a fault on our side, not an empty book. Nothing was saved. Try again in a moment.';
const CONFIRM_FAULT =
  'I could not save those just now — a fault on our side. Nothing was saved. Try again in a moment.';

/** The route's own words when it has them; ours when the failure never reached a handler. */
function faultText(body: unknown, fallback: string): string {
  const error = (body as { error?: unknown } | null)?.error;
  return typeof error === 'string' && error.trim() ? error : fallback;
}

/**
 * Expand a collection into candidates. Writes nothing on the server either — this is the read.
 *
 * 60s, because this one spends a model call and a book is the longest thing it ever produces. The
 * timeout is what turns iOS's suspended-socket hang into a failure the screen can show.
 */
export async function expandCollection(collection: string): Promise<SeedExpansion> {
  const res = await fetch(`${BASE}/progress/repertoire/seed`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ collection }),
    signal: timeoutSignal(60_000),
  }).catch(() => null);
  if (!res) return { ok: false, fault: EXPAND_FAULT };
  const body = (await res.json().catch(() => null)) as { collection?: unknown; candidates?: unknown } | null;
  if (!res.ok || !Array.isArray(body?.candidates)) return { ok: false, fault: faultText(body, EXPAND_FAULT) };
  return {
    ok: true,
    collection: typeof body.collection === 'string' ? body.collection : collection,
    candidates: body.candidates as SeedCandidate[],
  };
}

/** Write the confirmed rows. `goalId` null is "no goal — just keep it". */
export async function confirmSeed(rows: SeedWriteRow[], goalId: string | null): Promise<SeedConfirmation> {
  const res = await fetch(`${BASE}/progress/repertoire/seed/confirm`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ goal_id: goalId, rows }),
    signal: timeoutSignal(30_000),
  }).catch(() => null);
  if (!res) return { ok: false, fault: CONFIRM_FAULT };
  const body = (await res.json().catch(() => null)) as {
    written?: unknown;
    labels?: unknown;
    refused?: unknown;
  } | null;
  if (!res.ok || typeof body?.written !== 'number') return { ok: false, fault: faultText(body, CONFIRM_FAULT) };
  return {
    ok: true,
    written: body.written,
    labels: Array.isArray(body.labels) ? (body.labels as string[]) : [],
    // A refusal that arrived as something other than a list must not read as "nothing refused" —
    // but the server always sends one, so an absent field is a shape change, not a silent zero.
    refused: Array.isArray(body.refused) ? (body.refused as RefusedSeedRow[]) : [],
  };
}
