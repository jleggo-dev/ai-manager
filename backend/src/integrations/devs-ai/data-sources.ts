/**
 * Data Sources — list/create/refresh/delete datasources attached to an AI.
 */

import type { DevsAiEntity, DevsAiHttp } from './types.ts';

/** List datasources attached to an AI agent. */
export async function listAiDataSources(client: DevsAiHttp, aiId: string): Promise<DevsAiEntity[]> {
  const payload = await client._request<{ data?: DevsAiEntity[] }>('GET', `/api/v1/ai/${aiId}/data-sources`);
  return Array.isArray(payload?.data) ? payload.data : [];
}

/** Delete a datasource by id. */
export async function deleteDataSource(client: DevsAiHttp, dataSourceId: string): Promise<null> {
  return client._request('DELETE', `/api/v1/data-sources/${dataSourceId}`);
}

/** Create API datasource for an AI agent. */
export async function createApiDataSource(
  client: DevsAiHttp,
  aiId: string,
  name: string,
  data: Record<string, unknown>,
): Promise<DevsAiEntity> {
  return client._request('POST', `/api/v1/ai/${aiId}/data-sources/api`, {
    name,
    data,
  });
}

/** Trigger datasource refresh/indexing. */
export async function refreshDataSource(
  client: DevsAiHttp,
  dataSourceId: string,
  forceRefresh: boolean = true,
): Promise<DevsAiEntity> {
  const force = forceRefresh ? 'true' : 'false';
  return client._request('PUT', `/api/v1/data-sources/${dataSourceId}/refresh?forceRefresh=${force}`);
}
