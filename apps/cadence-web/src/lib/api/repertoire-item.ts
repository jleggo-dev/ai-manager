/**
 * Client for the item screen's two write routes (routes/progress-extras.ts, P2 "the item,
 * opened"): PATCH for the name fields/qualifiers/standing, DELETE for a real remove. Its own
 * module rather than an addition to lib/api.ts — that file is the shared re-export index, owned
 * by a different parcel in this wave.
 *
 * Deliberately thin: every field is optional so a caller can PATCH the standing alone, or the
 * name fields alone, exactly as the item screen's own two independent actions do.
 */
import type { RepertoireItem, RepertoireStatus } from '@cadence/shared';
import { BASE, headers } from './http.ts';

export interface RepertoireItemPatch {
  label?: string;
  composer?: string;
  collection?: string;
  catalogue?: string;
  status?: RepertoireStatus;
  /** 1-based position for a drag-ordered standing (the Up next group, P6 "the room"). */
  rank?: number;
  /** WHERE THE WORK IS, right now — "bars 9-16", "p. 240", "first stanza", "for 5th kyu" (P8). */
  note?: string;
}

async function readError(res: Response, fallback: string): Promise<Error> {
  const body = (await res.json().catch(() => ({}))) as { error?: string };
  return new Error(body.error ?? fallback);
}

/**
 * PATCH /progress/repertoire/:id. The screen sends the name fields together on "Save the name"
 * and the standing alone from the standing control, but this accepts either or both — the route
 * does too. On a rename collision the server refuses with 409 and a message naming the other
 * piece; that message rides straight through as this promise's rejection.
 */
export async function patchRepertoireItem(itemId: string, patch: RepertoireItemPatch): Promise<RepertoireItem> {
  const res = await fetch(`${BASE}/progress/repertoire/${encodeURIComponent(itemId)}`, {
    method: 'PATCH',
    headers: headers(),
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw await readError(res, `patchRepertoireItem failed: ${res.status}`);
  return res.json();
}

/** DELETE /progress/repertoire/:id — a real delete, gone for good (sessions and logs keep their
 *  own text; only the link disappears). Resolves on success; throws otherwise. */
export async function deleteRepertoireItem(itemId: string): Promise<void> {
  const res = await fetch(`${BASE}/progress/repertoire/${encodeURIComponent(itemId)}`, {
    method: 'DELETE',
    headers: headers(),
  });
  if (!res.ok) throw await readError(res, `deleteRepertoireItem failed: ${res.status}`);
}
