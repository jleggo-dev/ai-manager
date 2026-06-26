/**
 * Routes – User Data Deletion (GDPR / CCPA compliance)
 * -----------------------------------------------------
 * Endpoints for purging user data from the workspace.
 * All operations use the service-role Supabase client to
 * bypass RLS and delete across tenant-scoped tables.
 */

import { Router, Request, Response } from 'express';
import { getServiceSupabase } from '../db/service-supabase.ts';
import { getAuthContext, effectiveUserId } from '../db/tenant.ts';

const CONFIRM_STRING = 'DELETE_USER_DATA';

const router = Router();

function resolveWorkspaceId(): string | null {
  const ctx = getAuthContext();
  return ctx?.workspaceId ?? null;
}

/**
 * Check if the authenticated caller can modify another user's credentials.
 * Per workspace trust model: credentials are "strictly isolated."
 * Only self-deletion or admin/owner role is allowed.
 */
function canDeleteCredentials(targetUserId: string): { allowed: boolean; reason?: string } {
  const ctx = getAuthContext();
  if (!ctx) return { allowed: false, reason: 'No auth context' };

  const callerId = effectiveUserId(ctx);

  if (callerId === targetUserId) return { allowed: true };

  if (ctx.mode === 'api_key') {
    const role = ctx.apiKeyRole;
    if (role === 'admin' || role === 'owner') return { allowed: true };
  }

  return { allowed: false, reason: 'Only the user themselves or an admin can delete credentials' };
}

/**
 * Validate UUID format (basic check — prevents SQL injection in `.eq()` calls).
 */
function isValidUuid(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

/* ================================================================
   DELETE /api/user-data/:userId
   Full purge — sessions, diagnostic logs, credentials.
   Body: { confirm: "DELETE_USER_DATA" }
   ================================================================ */

router.delete('/:userId', async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;
    if (!isValidUuid(userId)) {
      return res.status(400).json({ error: 'Invalid userId format (UUID expected)' });
    }

    const credCheck = canDeleteCredentials(userId);
    if (!credCheck.allowed) {
      return res.status(403).json({ error: credCheck.reason });
    }

    const { confirm } = req.body || {};
    if (confirm !== CONFIRM_STRING) {
      return res.status(400).json({
        error: `Confirmation required. Send { "confirm": "${CONFIRM_STRING}" } in the request body.`,
      });
    }

    const workspaceId = resolveWorkspaceId();
    if (!workspaceId) {
      return res.status(400).json({ error: 'Workspace context required' });
    }

    const svc = getServiceSupabase();

    const { count: sessionsCount } = await svc
      .from('chat_sessions')
      .delete({ count: 'exact' })
      .eq('user_id', userId)
      .eq('workspace_id', workspaceId);

    const { count: diagnosticLogsCount } = await svc
      .from('diagnostic_logs')
      .delete({ count: 'exact' })
      .eq('user_id', userId)
      .eq('workspace_id', workspaceId);

    const { count: credentialsCount } = await svc
      .from('user_provider_credentials')
      .delete({ count: 'exact' })
      .eq('user_id', userId)
      .eq('workspace_id', workspaceId);

    return res.json({
      deleted: {
        sessions: sessionsCount ?? 0,
        diagnosticLogs: diagnosticLogsCount ?? 0,
        credentials: credentialsCount ?? 0,
      },
    });
  } catch (err) {
    console.error('[DELETE /user-data/:userId]', err);
    return res.status(500).json({ error: 'Failed to purge user data' });
  }
});

/* ================================================================
   DELETE /api/user-data/:userId/sessions
   Selective — chat sessions + messages (cascade via FK).
   Body: { confirm: "DELETE_USER_DATA" }
   ================================================================ */

router.delete('/:userId/sessions', async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;
    if (!isValidUuid(userId)) {
      return res.status(400).json({ error: 'Invalid userId format (UUID expected)' });
    }

    const { confirm } = req.body || {};
    if (confirm !== CONFIRM_STRING) {
      return res.status(400).json({
        error: `Confirmation required. Send { "confirm": "${CONFIRM_STRING}" } in the request body.`,
      });
    }

    const workspaceId = resolveWorkspaceId();
    if (!workspaceId) {
      return res.status(400).json({ error: 'Workspace context required' });
    }

    const svc = getServiceSupabase();
    const { count } = await svc
      .from('chat_sessions')
      .delete({ count: 'exact' })
      .eq('user_id', userId)
      .eq('workspace_id', workspaceId);

    return res.json({ deleted: { sessions: count ?? 0 } });
  } catch (err) {
    console.error('[DELETE /user-data/:userId/sessions]', err);
    return res.status(500).json({ error: 'Failed to delete user sessions' });
  }
});

/* ================================================================
   DELETE /api/user-data/:userId/diagnostic-logs
   Selective — diagnostic log entries only.
   Body: { confirm: "DELETE_USER_DATA" }
   ================================================================ */

router.delete('/:userId/diagnostic-logs', async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;
    if (!isValidUuid(userId)) {
      return res.status(400).json({ error: 'Invalid userId format (UUID expected)' });
    }

    const { confirm } = req.body || {};
    if (confirm !== CONFIRM_STRING) {
      return res.status(400).json({
        error: `Confirmation required. Send { "confirm": "${CONFIRM_STRING}" } in the request body.`,
      });
    }

    const workspaceId = resolveWorkspaceId();
    if (!workspaceId) {
      return res.status(400).json({ error: 'Workspace context required' });
    }

    const svc = getServiceSupabase();
    const { count } = await svc
      .from('diagnostic_logs')
      .delete({ count: 'exact' })
      .eq('user_id', userId)
      .eq('workspace_id', workspaceId);

    return res.json({ deleted: { diagnosticLogs: count ?? 0 } });
  } catch (err) {
    console.error('[DELETE /user-data/:userId/diagnostic-logs]', err);
    return res.status(500).json({ error: 'Failed to delete user diagnostic logs' });
  }
});

/* ================================================================
   DELETE /api/user-data/:userId/credentials
   Selective — user provider credentials only.
   Body: { confirm: "DELETE_USER_DATA" }
   ================================================================ */

router.delete('/:userId/credentials', async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;
    if (!isValidUuid(userId)) {
      return res.status(400).json({ error: 'Invalid userId format (UUID expected)' });
    }

    const credCheck = canDeleteCredentials(userId);
    if (!credCheck.allowed) {
      return res.status(403).json({ error: credCheck.reason });
    }

    const { confirm } = req.body || {};
    if (confirm !== CONFIRM_STRING) {
      return res.status(400).json({
        error: `Confirmation required. Send { "confirm": "${CONFIRM_STRING}" } in the request body.`,
      });
    }

    const workspaceId = resolveWorkspaceId();
    if (!workspaceId) {
      return res.status(400).json({ error: 'Workspace context required' });
    }

    const svc = getServiceSupabase();
    const { count } = await svc
      .from('user_provider_credentials')
      .delete({ count: 'exact' })
      .eq('user_id', userId)
      .eq('workspace_id', workspaceId);

    return res.json({ deleted: { credentials: count ?? 0 } });
  } catch (err) {
    console.error('[DELETE /user-data/:userId/credentials]', err);
    return res.status(500).json({ error: 'Failed to delete user credentials' });
  }
});

export default router;
