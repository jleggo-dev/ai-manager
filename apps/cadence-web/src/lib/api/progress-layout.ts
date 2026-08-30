import type { ProgressLayout } from '@cadence/shared';
import { BASE, headers } from './http.ts';

/**
 * GET /me/progress-layout — the committed layout if the user (or, from Wave 3, the coach) has set
 * one; otherwise the deterministic default composed server-side from the user's goals. Never a
 * model call (docs/cadence/PROGRESS-ENGINE.md "The layout model").
 */
export async function getProgressLayout(): Promise<ProgressLayout> {
  const res = await fetch(`${BASE}/me/progress-layout`, { headers: headers() });
  if (!res.ok) throw new Error(`progress-layout failed: ${res.status}`);
  return res.json();
}
