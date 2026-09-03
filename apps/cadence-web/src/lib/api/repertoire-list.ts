/**
 * Client for the list screen's own read (routes/progress-extras.ts, P6 "the room"): the full,
 * uncapped repertoire rows — scoped to a goal, or everything they keep — plus the title collisions
 * the server already computed. Its own module rather than an addition to lib/api.ts's shared
 * re-export index: the list is a distinct responsibility with its own screen.
 *
 * Same discriminated-union contract `repertoire-seed.ts` uses: a crash comes back `ok: false` with
 * words, never `ok: true` with an empty list — a screen that cannot tell "we broke" from "you have
 * nothing on file" would tell the person the wrong one.
 */
import type { RepertoireItem } from '@cadence/shared';
import { BASE, headers } from './http.ts';

/** One title two or more pieces answer to — `{ shared, labels }` from `collidingTitles`. */
export interface RepertoireCollisionGroup {
  shared: string;
  labels: string[];
}

export type RepertoireListResult =
  | {
      ok: true;
      items: RepertoireItem[];
      collisions: RepertoireCollisionGroup[];
      /** Every collection already in use on this person's WHOLE shelf, most-used first — the names
       *  the item screen offers instead of a free-text box (owner ruling 2026-09-03). Computed by
       *  the route from the rows it already read; never narrowed by the goal scope, because a book
       *  kept under another goal is still a group this person uses. */
      collections: string[];
    }
  | { ok: false; fault: string };

const FAULT = 'I could not read your list just now — a fault on our side, not an empty shelf. Try again in a moment.';

/** The route's own words when it has them; ours when the failure never reached a handler. */
function faultText(body: unknown, fallback: string): string {
  const error = (body as { error?: unknown } | null)?.error;
  return typeof error === 'string' && error.trim() ? error : fallback;
}

/** GET /progress/repertoire/items?goal_id= — `goalId` null/omitted means everything they keep. */
export async function getRepertoireListItems(goalId: string | null): Promise<RepertoireListResult> {
  const qs = goalId ? `?goal_id=${encodeURIComponent(goalId)}` : '';
  const res = await fetch(`${BASE}/progress/repertoire/items${qs}`, { headers: headers() }).catch(() => null);
  if (!res) return { ok: false, fault: FAULT };
  const body = (await res.json().catch(() => null)) as {
    items?: unknown;
    collisions?: unknown;
    collections?: unknown;
  } | null;
  if (!res.ok || !Array.isArray(body?.items)) return { ok: false, fault: faultText(body, FAULT) };
  return {
    ok: true,
    items: body.items as RepertoireItem[],
    collisions: Array.isArray(body.collisions) ? (body.collisions as RepertoireCollisionGroup[]) : [],
    // An older API that does not send it yet reads as "no collections on file", which is the same
    // thing the screen shows for a shelf that genuinely has none — never a crash.
    collections: Array.isArray(body.collections) ? (body.collections as string[]) : [],
  };
}
