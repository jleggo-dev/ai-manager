import { request } from './client';
import type {
  HealthCheckResult,
  WorkspaceMembership,
  ApiKey,
  CreateApiKeyResponse,
  WorkspaceMember,
} from '../../types/api';

/* ── Health / Workspaces / API Keys ────────────────────────────── */

export function healthCheck(): Promise<HealthCheckResult> {
  return request('/api/health');
}

export function listWorkspaces(): Promise<{ workspaces: WorkspaceMembership[] }> {
  return request('/api/workspaces', { skipWorkspaceHeader: true });
}

export function listApiKeys(): Promise<{ apiKeys: ApiKey[] }> {
  return request('/api/api-keys');
}

export function createApiKey(name: string): Promise<CreateApiKeyResponse> {
  return request('/api/api-keys', {
    method: 'POST',
    body: JSON.stringify({ name }),
  });
}

export function deleteApiKey(id: string): Promise<void> {
  return request(`/api/api-keys/${id}`, { method: 'DELETE' });
}

export function listWorkspaceMembers(workspaceId: string): Promise<{ members: WorkspaceMember[] }> {
  return request(`/api/workspaces/${workspaceId}/members`);
}

export function updateWorkspaceMemberRole(
  workspaceId: string,
  memberUserId: string,
  role: string,
): Promise<WorkspaceMember> {
  return request(`/api/workspaces/${workspaceId}/members/${memberUserId}`, {
    method: 'PATCH',
    body: JSON.stringify({ role }),
  });
}
