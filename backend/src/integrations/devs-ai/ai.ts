/**
 * AI Management — list/get agents and available model IDs.
 */

import type { DevsAiEntity, DevsAiHttp } from './types.ts';
import { normalizeModelListPayload } from './normalize-models.ts';

/** List all AIs visible to the authenticated user. */
export async function listAIs(client: DevsAiHttp, scope: 'ALL' | 'OWNED' | 'SHARED' = 'ALL'): Promise<DevsAiEntity[]> {
  return client._request<DevsAiEntity[]>('GET', `/api/v1/me/ai?scope=${scope}`);
}

/**
 * Attempt to list available model IDs from Devs.ai.
 * Tries common model-list endpoints and normalizes responses.
 */
export async function listModels(client: DevsAiHttp): Promise<string[]> {
  const paths = ['/api/v1/models', '/v1/models'];
  let lastErr: Error | null = null;

  for (const path of paths) {
    try {
      const payload = await client._request('GET', path);
      return normalizeModelListPayload(payload);
    } catch (err: unknown) {
      lastErr = err as Error;
    }
  }

  throw lastErr || new Error('Unable to list models from Devs.ai');
}

/** Get details for a specific AI. */
export async function getAI(client: DevsAiHttp, aiId: string): Promise<DevsAiEntity> {
  return client._request('GET', `/api/v1/ai/${aiId}`);
}
