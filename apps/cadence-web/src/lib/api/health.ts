import type { HealthDigest } from '@cadence/shared';
import { BASE, headers } from './http.ts';

/**
 * POST the confirm-first health digest. `sessionId` (when the coach session is already
 * open) lets the server inject it into the running conversation immediately.
 */
export async function postHealthDigest(digest: HealthDigest, sessionId?: string | null): Promise<boolean> {
  const res = await fetch(`${BASE}/me/health-digest`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ digest, ...(sessionId ? { sessionId } : {}) }),
  });
  return res.ok;
}
