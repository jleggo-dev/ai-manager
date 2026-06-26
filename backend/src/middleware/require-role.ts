import type { Request, Response, NextFunction } from 'express';
import { getAuthContext } from '../db/tenant.ts';
import { getServiceSupabase } from '../db/service-supabase.ts';
import type { WorkspaceRole } from '../types.ts';

const ROLE_HIERARCHY: Record<WorkspaceRole, number> = {
  owner: 3,
  admin: 2,
  member: 1,
};

export function requireRole(...allowedRoles: WorkspaceRole[]) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const ctx = getAuthContext();
    if (!ctx?.workspaceId) {
      res.status(403).json({ error: 'Workspace context required' });
      return;
    }

    let userId: string | undefined;
    if (ctx.mode === 'jwt') {
      userId = ctx.userId;
    } else if (ctx.mode === 'api_key') {
      const keyRole: WorkspaceRole = ctx.apiKeyRole ?? 'member';
      const minRequired = Math.min(...allowedRoles.map((r) => ROLE_HIERARCHY[r] ?? 99));
      if ((ROLE_HIERARCHY[keyRole] ?? 0) < minRequired) {
        res.status(403).json({ error: `API key requires ${allowedRoles.join(' or ')} role` });
        return;
      }
      next();
      return;
    }

    if (!userId) {
      res.status(403).json({ error: 'User identity required for role check' });
      return;
    }

    const svc = getServiceSupabase();
    const { data: membership, error } = await svc
      .from('workspace_members')
      .select('role')
      .eq('workspace_id', ctx.workspaceId)
      .eq('user_id', userId)
      .maybeSingle();

    if (error || !membership) {
      res.status(403).json({ error: 'Not a member of this workspace' });
      return;
    }

    const userRole = membership.role as WorkspaceRole;
    const minRequired = Math.min(...allowedRoles.map((r) => ROLE_HIERARCHY[r] ?? 99));

    if ((ROLE_HIERARCHY[userRole] ?? 0) < minRequired) {
      res.status(403).json({ error: `Requires ${allowedRoles.join(' or ')} role` });
      return;
    }

    next();
  };
}
