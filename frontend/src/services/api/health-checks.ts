import { request } from './client';
import type {
  HcProviderKey,
  HcProfile,
  HcCheck,
  HcRun,
  HcIncident,
  HcDashboardItem,
  CheckUptimeHistory,
  RunListResponse,
  FailurePatterns,
} from '../../types/api';

/* ── Health Checker API ─────────────────────────────────────────── */

export function listHcProviderKeys(): Promise<{ data: HcProviderKey[] }> {
  return request('/api/health-checks/provider-keys');
}

export function createHcProviderKey(data: Record<string, unknown>): Promise<HcProviderKey> {
  return request('/api/health-checks/provider-keys', { method: 'POST', body: JSON.stringify(data) });
}

export function updateHcProviderKey(id: string, data: Record<string, unknown>): Promise<HcProviderKey> {
  return request(`/api/health-checks/provider-keys/${id}`, { method: 'PUT', body: JSON.stringify(data) });
}

export function deleteHcProviderKey(id: string): Promise<void> {
  return request(`/api/health-checks/provider-keys/${id}`, { method: 'DELETE' });
}

export function listHcProfiles(): Promise<{ data: HcProfile[] }> {
  return request('/api/health-checks/profiles');
}

export function createHcProfile(data: Record<string, unknown>): Promise<HcProfile> {
  return request('/api/health-checks/profiles', { method: 'POST', body: JSON.stringify(data) });
}

export function updateHcProfile(id: string, data: Record<string, unknown>): Promise<HcProfile> {
  return request(`/api/health-checks/profiles/${id}`, { method: 'PUT', body: JSON.stringify(data) });
}

export function deleteHcProfile(id: string): Promise<void> {
  return request(`/api/health-checks/profiles/${id}`, { method: 'DELETE' });
}

export function listHcChecks(): Promise<{ data: HcCheck[] }> {
  return request('/api/health-checks');
}

export function createHcCheck(data: Record<string, unknown>): Promise<HcCheck> {
  return request('/api/health-checks', { method: 'POST', body: JSON.stringify(data) });
}

export function backfillHcChecks(): Promise<{ success: boolean; created: number; total_profiles: number }> {
  return request('/api/health-checks/profiles/backfill-checks', { method: 'POST' });
}

export function updateHcCheck(id: string, data: Record<string, unknown>): Promise<HcCheck> {
  return request(`/api/health-checks/${id}`, { method: 'PUT', body: JSON.stringify(data) });
}

export function deleteHcCheck(id: string, deleteProfile = false): Promise<void> {
  const qs = deleteProfile ? '?deleteProfile=true' : '';
  return request(`/api/health-checks/${id}${qs}`, { method: 'DELETE' });
}

export function runHcCheck(id: string): Promise<HcRun> {
  return request(`/api/health-checks/${id}/run`, { method: 'POST' });
}

export function listHcRuns(id: string, limit = 50): Promise<{ data: HcRun[] }> {
  return request(`/api/health-checks/${id}/runs?limit=${limit}`);
}

export function listHcIncidents(id: string, limit = 20): Promise<{ data: HcIncident[] }> {
  return request(`/api/health-checks/${id}/incidents?limit=${limit}`);
}

export function getHcDashboard(): Promise<{ data: HcDashboardItem[] }> {
  return request('/api/health-checks/dashboard');
}

/* ── Uptime History ──────────────────────────────────────── */

export function getHcUptimeHistory(days = 365): Promise<{ data: CheckUptimeHistory[] }> {
  return request(`/api/health-checks/uptime-history?days=${days}`);
}

/* ── Filtered Run Listing ────────────────────────────────── */

export interface RunFilterParams {
  status?: string;
  from?: string;
  to?: string;
  offset?: number;
  limit?: number;
}

function buildRunQuery(checkId: string, base: string, params: RunFilterParams = {}): string {
  const qs = new URLSearchParams();
  if (params.status) qs.set('status', params.status);
  if (params.from) qs.set('from', params.from);
  if (params.to) qs.set('to', params.to);
  if (params.offset) qs.set('offset', String(params.offset));
  if (params.limit) qs.set('limit', String(params.limit));
  const query = qs.toString();
  return `${base}/${checkId}/runs${query ? `?${query}` : ''}`;
}

export function listHcRunsFiltered(checkId: string, params?: RunFilterParams): Promise<RunListResponse<HcRun>> {
  return request(buildRunQuery(checkId, '/api/health-checks', params));
}

/* ── Failure Patterns ────────────────────────────────────── */

export function getHcFailurePatterns(checkId: string, from?: string, to?: string): Promise<FailurePatterns> {
  const qs = new URLSearchParams();
  if (from) qs.set('from', from);
  if (to) qs.set('to', to);
  const query = qs.toString();
  return request(`/api/health-checks/${checkId}/failure-patterns${query ? `?${query}` : ''}`);
}
