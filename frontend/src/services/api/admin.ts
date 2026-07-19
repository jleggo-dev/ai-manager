import { request } from './client';
import type { PaginatedResponse } from '../../types/api';

/* ── Admin user management ───────────────────────────────── */

export type AccountStatus = 'pending' | 'approved' | 'suspended';

export interface AdminUser {
  id: string;
  email: string | null;
  display_name: string | null;
  status: AccountStatus;
  approved_by: string | null;
  approved_at: string | null;
  created_at: string;
  updated_at: string;
  last_sign_in_at: string | null;
  auth_created_at: string | null;
}

export interface ListAdminUsersResponse {
  users: AdminUser[];
  pagination: PaginatedResponse<AdminUser>['pagination'];
}

export function listAdminUsers(params?: {
  status?: AccountStatus;
  search?: string;
  cursor?: string;
  limit?: number;
}): Promise<ListAdminUsersResponse> {
  const qs = new URLSearchParams();
  if (params?.status) qs.set('status', params.status);
  if (params?.search) qs.set('search', params.search);
  if (params?.cursor) qs.set('cursor', params.cursor);
  if (params?.limit) qs.set('limit', String(params.limit));
  const suffix = qs.toString() ? `?${qs}` : '';
  return request(`/api/admin/users${suffix}`);
}

export function updateUserStatus(userId: string, status: AccountStatus): Promise<{ user: AdminUser }> {
  return request(`/api/admin/users/${userId}`, {
    method: 'PATCH',
    body: JSON.stringify({ status }),
  });
}
