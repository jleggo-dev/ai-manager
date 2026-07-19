import { request } from './client';
import type { Provider, AiProfile, LlmModel, SyncModelsResult, PaginatedResponse } from '../../types/api';

/* ── Providers API ─────────────────────────────────────────────── */

export function listProviders(params?: { cursor?: string; limit?: number }): Promise<PaginatedResponse<Provider>> {
  const qs = new URLSearchParams();
  if (params?.cursor) qs.set('cursor', params.cursor);
  if (params?.limit) qs.set('limit', String(params.limit));
  const suffix = qs.toString() ? `?${qs}` : '';
  return request(`/api/providers${suffix}`);
}

export function createProvider(data: Record<string, unknown>): Promise<Provider> {
  return request('/api/providers', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export function updateProvider(id: string, data: Record<string, unknown>): Promise<Provider> {
  return request(`/api/providers/${id}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

export function deleteProvider(id: string): Promise<void> {
  return request(`/api/providers/${id}`, { method: 'DELETE' });
}

export function testProvider(id: string): Promise<Record<string, unknown>> {
  return request(`/api/providers/${id}/test`, { method: 'POST' });
}

export function listProviderAis(id: string, scope?: string): Promise<AiProfile[]> {
  const qs = scope ? `?scope=${scope}` : '';
  return request(`/api/providers/${id}/ais${qs}`);
}

/* ── LLM Models (per-provider model registry) ──────────────────── */

export function listProviderModels(providerId: string): Promise<LlmModel[]> {
  return request(`/api/providers/${providerId}/models`);
}

export function syncProviderModels(providerId: string): Promise<SyncModelsResult> {
  return request(`/api/providers/${providerId}/models/sync`, {
    method: 'POST',
  });
}

export function addProviderModel(providerId: string, data: Record<string, unknown>): Promise<LlmModel> {
  return request(`/api/providers/${providerId}/models`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export function bulkAddProviderModels(providerId: string, models: Record<string, unknown>[]): Promise<LlmModel[]> {
  return request(`/api/providers/${providerId}/models`, {
    method: 'POST',
    body: JSON.stringify({ models }),
  });
}

export function updateProviderModel(
  providerId: string,
  modelId: string,
  data: Record<string, unknown>,
): Promise<LlmModel> {
  return request(`/api/providers/${providerId}/models/${modelId}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

export function deleteProviderModel(providerId: string, modelId: string): Promise<void> {
  return request(`/api/providers/${providerId}/models/${modelId}`, { method: 'DELETE' });
}
