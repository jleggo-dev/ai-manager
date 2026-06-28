import { Router, Request, Response } from 'express';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createUserSupabase } from '../db/tenant.ts';
import { getServiceSupabase } from '../db/service-supabase.ts';
import { ensureProfileRow } from '../models/profiles.ts';
import type { AccountStatus } from '../constants/account-status.ts';

const router = Router();

/** Best-effort display name from Supabase Auth (e.g. Google OAuth user_metadata). */
function displayNameFromUser(user: {
  user_metadata?: Record<string, string>;
  raw_user_meta_data?: Record<string, string>;
}): string | null {
  const m = user?.user_metadata || {};
  const raw = user?.raw_user_meta_data || {};
  const combined = [m.given_name, m.family_name].filter(Boolean).join(' ').trim();
  return m.full_name || m.name || m.display_name || combined || raw.full_name || raw.name || raw.display_name || null;
}

/**
 * Ensure a `user_settings` row exists (service role). Does not overwrite an existing row on insert.
 * Refreshes `display_name` from the IdP when non-empty (so Google name changes propagate).
 */
async function ensureUserSettingsRow(
  svc: SupabaseClient,
  userId: string,
  defaultWorkspaceId: string,
  displayName: string | null,
): Promise<void> {
  const { error: upErr } = await svc.from('user_settings').upsert(
    {
      user_id: userId,
      default_workspace_id: defaultWorkspaceId,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id', ignoreDuplicates: true },
  );
  if (upErr) throw new Error(upErr.message);
  if (displayName) {
    const { error: patchErr } = await svc
      .from('user_settings')
      .update({
        display_name: displayName,
        updated_at: new Date().toISOString(),
      })
      .eq('user_id', userId);
    if (patchErr) throw new Error(patchErr.message);
  }
}

async function userPayloadForResponse(
  svc: SupabaseClient,
  user: { id: string; email?: string | null },
  idpDisplayName: string | null,
) {
  const { data, error } = await svc.from('user_settings').select('display_name').eq('user_id', user.id).maybeSingle();
  if (error) throw new Error(error.message);
  return {
    id: user.id,
    email: user.email ?? null,
    display_name: data?.display_name ?? idpDisplayName ?? null,
  };
}

function bootstrapResponseForStatus(
  res: Response,
  userPayload: { id: string; email: string | null; display_name: string | null },
  status: AccountStatus,
) {
  const approved = status === 'approved';
  res.json({
    user: userPayload,
    status,
    approved,
    workspaces: approved ? undefined : [],
  });
}

/**
 * Ensures profile + (when approved) workspace membership and user_settings.
 * Call after sign-in. Requires `Authorization: Bearer <supabase_access_token>`.
 * Pending/suspended users receive status only — no workspace bootstrap.
 */
router.post('/bootstrap', async (req: Request, res: Response) => {
  try {
    const h = req.headers.authorization;
    if (!h?.startsWith('Bearer ')) {
      res.status(401).json({ error: 'Bearer token required' });
      return;
    }
    const token = h.slice(7).trim();
    const userClient = createUserSupabase(token);
    const {
      data: { user },
      error: uErr,
    } = await userClient.auth.getUser();
    if (uErr || !user) {
      res.status(401).json({ error: 'Invalid token' });
      return;
    }

    const svc = getServiceSupabase();
    const idpName = displayNameFromUser(user);
    const profile = await ensureProfileRow(user.id, user.email ?? null, idpName);

    const userPayload = await userPayloadForResponse(svc, user, idpName);

    if (profile.status !== 'approved') {
      bootstrapResponseForStatus(res, userPayload, profile.status);
      return;
    }

    const { data: memberships, error: mErr } = await svc
      .from('workspace_members')
      .select('workspace_id, role')
      .eq('user_id', user.id);
    if (mErr) throw new Error(mErr.message);

    if (memberships?.length) {
      const firstMembership = memberships[0];
      if (!firstMembership) throw new Error('Expected at least one membership');
      const defaultWsId = firstMembership.workspace_id;
      await ensureUserSettingsRow(svc, user.id, defaultWsId, idpName);

      const wsIds = [...new Set(memberships.map((m: { workspace_id: string }) => m.workspace_id))];
      const { data: wss } = await svc.from('workspaces').select('id, slug, name, created_at').in('id', wsIds);
      const byId = Object.fromEntries((wss || []).map((w: { id: string }) => [w.id, w]));
      res.json({
        user: userPayload,
        status: profile.status,
        approved: true,
        workspaces: memberships.map((m: { workspace_id: string; role: string }) => ({
          ...m,
          workspace: byId[m.workspace_id] || null,
        })),
        bootstrapped: false,
      });
      return;
    }

    const { data: defWs, error: wErr } = await svc
      .from('workspaces')
      .select('id, slug, name, created_at')
      .eq('slug', 'default')
      .maybeSingle();
    if (wErr) throw new Error(wErr.message);
    if (!defWs) {
      res.status(503).json({ error: 'Default workspace missing — apply migration 003 in Supabase' });
      return;
    }

    const { error: insErr } = await svc.from('workspace_members').insert({
      workspace_id: defWs.id,
      user_id: user.id,
      role: 'member',
    });
    if (insErr) throw new Error(insErr.message);

    await ensureUserSettingsRow(svc, user.id, defWs.id, idpName);

    res.json({
      user: userPayload,
      status: profile.status,
      approved: true,
      workspaces: [{ workspace_id: defWs.id, role: 'member', workspace: defWs }],
      bootstrapped: true,
    });
  } catch (e) {
    console.error('POST /api/auth/bootstrap', e);
    res.status(500).json({ error: 'Bootstrap failed' });
  }
});

export default router;
