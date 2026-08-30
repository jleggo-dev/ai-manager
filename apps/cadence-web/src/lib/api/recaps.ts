import { BASE, headers } from './http.ts';

/**
 * `GET /me/recaps` — raw server shape, deliberately NOT the frozen `RecapRailPayload` from
 * @cadence/shared: `week_start` is plain ISO (the human "AUG 18" label is BoundWidget's own
 * formatting job, same as its other bound components), and `line` stays nullable since most rows
 * have no coach conclusion yet (honest v1, Progress Engine W2-1).
 */
export interface RecapListItem {
  week_start: string; // YYYY-MM-DD, the Monday
  facts_line: string;
  line: string | null;
  detour: boolean;
}

export interface RecapListResult {
  recaps: RecapListItem[];
}

/**
 * `POST /plan/week-review/recap` — the confirm anchor's write (Progress Engine W2-1). The server
 * takes the week from the user's OWN `pending_week_review` pointer, never from here, so this must
 * be called BEFORE `dismissPendingWeekReview` clears that pointer. Failure is swallowed by the
 * caller the same way the dismiss's is: a lost recap never blocks the confirm moment.
 */
export async function postWeekReviewRecap(line?: string): Promise<boolean> {
  const res = await fetch(`${BASE}/plan/week-review/recap`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify(line ? { line } : {}),
  });
  return res.ok;
}

/** The `recap_rail` widget's data. Rows persist at week-review confirm time; this is a plain read. */
export async function getRecaps(limit = 8): Promise<RecapListResult> {
  const res = await fetch(`${BASE}/me/recaps?limit=${limit}`, { headers: headers() });
  if (!res.ok) throw new Error(`recaps failed: ${res.status}`);
  return res.json();
}
