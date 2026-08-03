import type { NowMenuItem } from '@cadence/shared';
import { BASE, headers } from './http.ts';

/**
 * GET /me/now-menu — the ＋ sheet's present-tense section. Composed server-side ahead of the tap
 * and cached, so this is a fast read. An empty list is a legitimate answer that hides the section,
 * not an error to surface: a failure here must cost the log section nothing.
 */
export async function getNowMenu(): Promise<NowMenuItem[]> {
  try {
    const res = await fetch(`${BASE}/me/now-menu`, { headers: headers() });
    if (!res.ok) return [];
    const body = (await res.json()) as { items?: NowMenuItem[] };
    return Array.isArray(body.items) ? body.items : [];
  } catch {
    return [];
  }
}
