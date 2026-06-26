import type { WorkspaceRole } from '../types.ts';

/**
 * Workspace membership roles (public.workspace_members.role).
 * Enforced in DB: CHECK (role IN ('owner', 'admin', 'member')).
 *
 * - owner: full control; at least one per workspace in practice (app logic).
 * - admin: can manage members (insert/update/delete per migration 004) and API keys (RLS).
 * - member: standard access to tenant data; cannot manage members or api_keys policies.
 */
export const WORKSPACE_ROLES: readonly WorkspaceRole[] = ['owner', 'admin', 'member'] as const;

export const WORKSPACE_ADMIN_ROLES: readonly WorkspaceRole[] = ['owner', 'admin'] as const;

export function isWorkspaceAdminRole(role: unknown): boolean {
  return WORKSPACE_ADMIN_ROLES.includes(String(role || '') as WorkspaceRole);
}
