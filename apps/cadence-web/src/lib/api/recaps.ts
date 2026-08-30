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

/** The `recap_rail` widget's data. Rows persist at week-review confirm time; this is a plain read. */
export async function getRecaps(limit = 8): Promise<RecapListResult> {
  const res = await fetch(`${BASE}/me/recaps?limit=${limit}`, { headers: headers() });
  if (!res.ok) throw new Error(`recaps failed: ${res.status}`);
  return res.json();
}
