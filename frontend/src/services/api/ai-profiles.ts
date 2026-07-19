import { request } from './client';
import type { AiProfile, PaginatedResponse } from '../../types/api';

/* ── AI Profiles API ───────────────────────────────────────────── */

export function listAiProfiles(
  providerId?: string,
  params?: { cursor?: string; limit?: number },
): Promise<PaginatedResponse<AiProfile>> {
  const qs = new URLSearchParams();
  if (providerId) qs.set('provider_id', providerId);
  if (params?.cursor) qs.set('cursor', params.cursor);
  if (params?.limit) qs.set('limit', String(params.limit));
  const suffix = qs.toString() ? `?${qs}` : '';
  return request(`/api/ai-profiles${suffix}`);
}

export function createAiProfile(data: Record<string, unknown>): Promise<AiProfile> {
  return request('/api/ai-profiles', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export function updateAiProfile(id: string, data: Record<string, unknown>): Promise<AiProfile> {
  return request(`/api/ai-profiles/${id}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

export function deleteAiProfile(id: string): Promise<void> {
  return request(`/api/ai-profiles/${id}`, { method: 'DELETE' });
}

export function getDefaultAiProfile(): Promise<AiProfile> {
  return request('/api/ai-profiles/default');
}

export function setAiProfileDefault(id: string): Promise<AiProfile> {
  return request(`/api/ai-profiles/${id}`, {
    method: 'PUT',
    body: JSON.stringify({ is_default: true }),
  });
}

export function clearAiProfileDefault(id: string): Promise<AiProfile> {
  return request(`/api/ai-profiles/${id}`, {
    method: 'PUT',
    body: JSON.stringify({ is_default: false }),
  });
}

export function testAiProfileChat(
  id: string,
  message: string,
  systemPrompt?: string,
): Promise<Record<string, unknown>> {
  return request(`/api/ai-profiles/${id}/test-chat`, {
    method: 'POST',
    body: JSON.stringify({ message, systemPrompt: systemPrompt || undefined }),
  });
}

/* ── AI Profile Tools & MCP ────────────────────────────────────── */

export function listProfileTools(profileId: string): Promise<Record<string, unknown>> {
  return request(`/api/ai-profiles/${profileId}/tools`);
}

export function listProfileMcpTools(profileId: string): Promise<Record<string, unknown>> {
  return request(`/api/ai-profiles/${profileId}/tools/mcp`);
}

export function listProfileToolAuthStatus(profileId: string): Promise<Record<string, unknown>> {
  return request(`/api/ai-profiles/${profileId}/tools/auth-status`);
}

export function getToolOAuthStatus(profileId: string, toolId: string): Promise<Record<string, unknown>> {
  return request(`/api/ai-profiles/${profileId}/tools/${toolId}/oauth-status`);
}

export function initiateToolOAuth(profileId: string, toolId: string): Promise<Record<string, unknown>> {
  return request(`/api/ai-profiles/${profileId}/tools/${toolId}/oauth-initiate`, {
    method: 'POST',
  });
}

export function deleteToolOAuthToken(profileId: string, toolId: string): Promise<void> {
  return request(`/api/ai-profiles/${profileId}/tools/${toolId}/oauth-token`, {
    method: 'DELETE',
  });
}
