/**
 * Routes – User Provider Credentials
 * ------------------------------------
 * Lets authenticated users store/retrieve/delete their personal
 * API keys for LLM providers. This enables per-user MCP OAuth
 * (e.g. Google, Slack) via Devs.ai.
 */

import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { getAuthContext, effectiveUserId, tenantFrom } from '../db/tenant.ts';
import {
  upsertUserCredential,
  listUserCredentials,
  deleteUserCredential,
} from '../models/user-provider-credentials.ts';
import { safeStatusError } from '../lib/safe-error.ts';
import { validateBody } from '../middleware/validate.ts';

const createUserCredentialSchema = z.object({
  providerId: z.string().uuid(),
  apiKey: z.string().min(1).max(500),
  label: z.string().max(200).optional(),
});

const router = Router();

/**
 * Resolve the effective user ID for credential operations.
 * - JWT auth: uses the authenticated Supabase user ID.
 * - API key auth with X-Forwarded-User-Id: uses the forwarded ID (trusted
 *   because the aim_sk_ key is a server-side secret).
 */
function requireUserId(): string {
  const ctx = getAuthContext();
  const userId = effectiveUserId(ctx);
  if (!userId) {
    throw Object.assign(
      new Error('User identity required. Use JWT auth or pass X-Forwarded-User-Id with an API key.'),
      { status: 401 },
    );
  }
  return userId;
}

/* ================================================================
   GET /api/user-credentials
   List the current user's provider credentials (keys are masked).
   ================================================================ */

router.get('/', async (req: Request, res: Response) => {
  try {
    const userId = requireUserId();
    const rows = await listUserCredentials(userId);
    return res.json(rows);
  } catch (err) {
    console.error('[GET /user-credentials]', err);
    const status = (err as { status?: number }).status || 500;
    return res.status(status).json({ error: safeStatusError(err, status, 'Failed to list credentials') });
  }
});

/* ================================================================
   POST /api/user-credentials
   Create or update a credential for the current user + provider.
   Body: { providerId, apiKey, label? }
   ================================================================ */

router.post('/', validateBody(createUserCredentialSchema), async (req: Request, res: Response) => {
  try {
    const userId = requireUserId();
    const { providerId, apiKey, label } = req.body;

    const trimmed = apiKey.trim();
    if (trimmed.length < 8) {
      return res.status(400).json({ error: 'API key is too short (minimum 8 characters).' });
    }
    if (trimmed.length > 500) {
      return res.status(400).json({ error: 'API key is too long (maximum 500 characters).' });
    }
    if (/\s/.test(trimmed)) {
      return res.status(400).json({
        error: 'API key contains whitespace characters. Ensure you pasted only the key without surrounding text.',
      });
    }

    const row = await upsertUserCredential({
      user_id: userId,
      provider_id: providerId,
      api_key: trimmed,
      label: label || null,
    });

    const { api_key: _hidden, ...safe } = row;
    return res.status(201).json(safe);
  } catch (err) {
    console.error('[POST /user-credentials]', err);
    const status = (err as { status?: number }).status || 500;
    return res.status(status).json({ error: safeStatusError(err, status, 'Failed to save credential') });
  }
});

/* ================================================================
   DELETE /api/user-credentials/:id
   Remove a credential belonging to the current user.
   ================================================================ */

router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const ctx = getAuthContext();
    const userId = effectiveUserId(ctx);
    if (!userId) {
      return res.status(403).json({ error: 'User identity required' });
    }

    const { data: cred } = await tenantFrom('user_provider_credentials')
      .select('id, user_id')
      .eq('id', req.params.id as string)
      .maybeSingle();

    if (!cred) {
      return res.status(404).json({ error: 'Credential not found' });
    }
    if (cred.user_id !== userId) {
      return res.status(403).json({ error: 'You can only delete your own credentials' });
    }

    await deleteUserCredential(req.params.id as string);
    return res.status(204).end();
  } catch (err: unknown) {
    console.error('[DELETE /user-credentials]', err);
    const status = (err as { status?: number }).status || 500;
    return res.status(status).json({ error: safeStatusError(err, status, 'Failed to delete credential') });
  }
});

export default router;
