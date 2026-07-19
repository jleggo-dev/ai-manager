import { request } from './client';
import type { AppSetting, UserCredential } from '../../types/api';

/* ── App Settings ──────────────────────────────────────────────── */

export function listSettings(): Promise<AppSetting[]> {
  return request('/api/settings');
}

export function getSettingByKey(key: string): Promise<AppSetting> {
  return request(`/api/settings/${encodeURIComponent(key)}`);
}

export function upsertSetting(key: string, value: unknown, description?: string): Promise<AppSetting> {
  return request(`/api/settings/${encodeURIComponent(key)}`, {
    method: 'PUT',
    body: JSON.stringify({ value, description }),
  });
}

export function deleteSettingByKey(key: string): Promise<void> {
  return request(`/api/settings/${encodeURIComponent(key)}`, { method: 'DELETE' });
}

/* ── User Provider Credentials ─────────────────────────────────── */

export function listUserCredentials(): Promise<UserCredential[]> {
  return request('/api/user-credentials');
}

export function upsertUserCredential(providerId: string, apiKey: string, label?: string): Promise<UserCredential> {
  return request('/api/user-credentials', {
    method: 'POST',
    body: JSON.stringify({ providerId, apiKey, label: label || undefined }),
  });
}

export function deleteUserCredential(id: string): Promise<void> {
  return request(`/api/user-credentials/${id}`, { method: 'DELETE' });
}

/* ── User Data Deletion (GDPR / CCPA compliance) ──────────────── */

export type UserDataScope = 'all' | 'sessions' | 'diagnostic-logs' | 'credentials';

export interface UserDataDeletionResult {
  deleted: {
    sessions?: number;
    diagnosticLogs?: number;
    credentials?: number;
  };
}

export function deleteUserData(userId: string, scope: UserDataScope): Promise<UserDataDeletionResult> {
  const path = scope === 'all' ? `/api/user-data/${userId}` : `/api/user-data/${userId}/${scope}`;
  return request(path, {
    method: 'DELETE',
    body: JSON.stringify({ confirm: 'DELETE_USER_DATA' }),
  });
}
