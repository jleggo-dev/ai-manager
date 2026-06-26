import { Router, Request, Response } from 'express';
import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getAuthContext } from '../db/tenant.ts';
import { getServiceSupabase } from '../db/service-supabase.ts';
import { WORKSPACE_ROLES } from '../constants/workspace-roles.ts';
import { validateBody } from '../middleware/validate.ts';
import type { RequestAuthContext, WorkspaceRole } from '../types.ts';

const updateMemberRoleSchema = z.object({
  role: z.enum(['owner', 'admin', 'member']),
});

const router = Router();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function requireJwtWorkspaceMatch(
  req: Request,
  res: Response,
): (RequestAuthContext & { userClient: SupabaseClient; userId: string }) | null {
  const ctx = getAuthContext();
  if (ctx?.mode !== 'jwt' || !ctx.userClient || !ctx.userId) {
    res.status(403).json({ error: 'Workspace members require a Supabase user session (JWT)' });
    return null;
  }
  const wid = req.params.workspaceId as string;
  if (!UUID_RE.test(wid)) {
    res.status(404).json({ error: 'Not found' });
    return null;
  }
  if (ctx.workspaceId !== wid) {
    res.status(403).json({ error: 'X-Workspace-Id must match the workspace in the URL' });
    return null;
  }
  return ctx as RequestAuthContext & { userClient: SupabaseClient; userId: string };
}

/** List workspaces the current JWT user belongs to. */
router.get('/', async (req: Request, res: Response) => {
  try {
    const ctx = getAuthContext();
    if (ctx?.mode !== 'jwt' || !ctx.userClient || !ctx.userId) {
      res.status(403).json({ error: 'Workspace list requires a Supabase user session (JWT), not an API key' });
      return;
    }

    const { data: memberships, error: mErr } = await ctx.userClient
      .from('workspace_members')
      .select('workspace_id, role')
      .eq('user_id', ctx.userId);
    if (mErr) throw new Error(mErr.message);

    const wsIds = [...new Set((memberships || []).map((m: { workspace_id: string }) => m.workspace_id))];
    if (wsIds.length === 0) {
      res.json({ workspaces: [] });
      return;
    }

    const { data: wss, error: wErr } = await ctx.userClient
      .from('workspaces')
      .select('id, slug, name, created_at')
      .in('id', wsIds);
    if (wErr) throw new Error(wErr.message);

    const byId = Object.fromEntries((wss || []).map((w: { id: string }) => [w.id, w]));
    res.json({
      workspaces: (memberships || []).map((m: { workspace_id: string; role: string }) => ({
        workspace_id: m.workspace_id,
        role: m.role,
        workspace: byId[m.workspace_id] || null,
      })),
    });
  } catch (e) {
    console.error('GET /api/workspaces', e);
    res.status(500).json({ error: 'Failed to list workspaces' });
  }
});

/** List members of a workspace (names from user_settings when RLS allows). */
router.get('/:workspaceId/members', async (req: Request, res: Response) => {
  try {
    const ctx = requireJwtWorkspaceMatch(req, res);
    if (!ctx) return;

    const { workspaceId } = req.params;
    const { data: members, error: mErr } = await ctx.userClient
      .from('workspace_members')
      .select('user_id, role, created_at')
      .eq('workspace_id', workspaceId)
      .order('created_at', { ascending: true });
    if (mErr) throw new Error(mErr.message);

    const ids = [...new Set((members || []).map((m: { user_id: string }) => m.user_id))];
    let byUserId: Record<string, { user_id: string; display_name?: string | null }> = {};
    if (ids.length > 0) {
      const { data: settings, error: sErr } = await ctx.userClient
        .from('user_settings')
        .select('user_id, display_name')
        .in('user_id', ids);
      if (sErr) throw new Error(sErr.message);
      byUserId = Object.fromEntries(
        (settings || []).map((s: { user_id: string; display_name?: string | null }) => [s.user_id, s]),
      );
    }

    let lastSignInById: Record<string, string | null> = {};
    try {
      const svc = getServiceSupabase();
      const { data: authData } = await svc.auth.admin.listUsers({ perPage: 1000 });
      if (authData?.users) {
        for (const u of authData.users) {
          if (ids.includes(u.id)) {
            lastSignInById[u.id] = u.last_sign_in_at ?? null;
          }
        }
      }
    } catch {
      /* auth admin unavailable — return members without last_sign_in_at */
    }

    res.json({
      members: (members || []).map((m: { user_id: string; role: string; created_at: string }) => ({
        user_id: m.user_id,
        role: m.role,
        created_at: m.created_at,
        display_name: byUserId[m.user_id]?.display_name ?? null,
        last_sign_in_at: lastSignInById[m.user_id] ?? null,
      })),
    });
  } catch (e) {
    console.error('GET /api/workspaces/:id/members', e);
    res.status(500).json({ error: 'Failed to list members' });
  }
});

/** Update a member role (RLS: owner/admin only). */
router.patch(
  '/:workspaceId/members/:memberUserId',
  validateBody(updateMemberRoleSchema),
  async (req: Request, res: Response) => {
    try {
      const ctx = requireJwtWorkspaceMatch(req, res);
      if (!ctx) return;

      const { workspaceId, memberUserId } = req.params;
      if (!UUID_RE.test(memberUserId as string)) {
        res.status(404).json({ error: 'Not found' });
        return;
      }

      const role = req.body?.role;
      if (!role || !WORKSPACE_ROLES.includes(String(role) as WorkspaceRole)) {
        res.status(400).json({ error: `role must be one of: ${WORKSPACE_ROLES.join(', ')}` });
        return;
      }

      if (memberUserId === ctx.userId) {
        res.status(400).json({ error: 'Use another admin to change your own role' });
        return;
      }

      const { data: row, error: uErr } = await ctx.userClient
        .from('workspace_members')
        .update({ role: String(role) })
        .eq('workspace_id', workspaceId)
        .eq('user_id', memberUserId)
        .select('user_id, role, created_at')
        .maybeSingle();
      if (uErr) throw new Error(uErr.message);
      if (!row) {
        res.status(403).json({ error: 'Not allowed or member not found' });
        return;
      }

      const { data: us } = await ctx.userClient
        .from('user_settings')
        .select('display_name')
        .eq('user_id', memberUserId)
        .maybeSingle();

      res.json({
        member: {
          ...row,
          display_name: us?.display_name ?? null,
        },
      });
    } catch (e) {
      console.error('PATCH /api/workspaces/:id/members/:userId', e);
      res.status(500).json({ error: 'Failed to update member' });
    }
  },
);

export default router;
