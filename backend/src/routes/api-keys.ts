import crypto from 'node:crypto';
import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { tenantFrom, tenantInsertPayload, getAuthContext } from '../db/tenant.ts';
import { hashApiKeySecret } from '../middleware/auth.ts';
import { validateBody } from '../middleware/validate.ts';

const createApiKeySchema = z.object({
  name: z.string().min(1).max(200),
  role: z.enum(['owner', 'admin', 'member']).optional(),
});

const TABLE = 'api_keys';
const KEY_PREFIX = 'aim_sk_';

const router = Router();

router.get('/', async (req: Request, res: Response) => {
  try {
    const ctx = getAuthContext();
    if (ctx?.mode === 'api_key') {
      res.status(403).json({ error: 'Listing API keys requires a user session (JWT)' });
      return;
    }

    const { data, error } = await tenantFrom(TABLE)
      .select('id, name, key_prefix, created_at, last_used_at, created_by')
      .order('created_at', { ascending: false });
    if (error) throw new Error(error.message);
    res.json({ apiKeys: data || [] });
  } catch (e) {
    console.error('GET /api/api-keys', e);
    res.status(500).json({ error: 'Failed to list API keys' });
  }
});

/**
 * Create an API key. Returns the secret once in `secret` — store it safely.
 * Requires workspace admin/owner (RLS).
 */
router.post('/', validateBody(createApiKeySchema), async (req: Request, res: Response) => {
  try {
    const ctx = getAuthContext();
    if (ctx?.mode === 'api_key') {
      res.status(403).json({ error: 'Creating API keys requires a user session (JWT)' });
      return;
    }

    const name = req.body.name.trim();
    const role = (req.body.role || 'admin') as string;

    const raw = `${KEY_PREFIX}${crypto.randomBytes(24).toString('base64url')}`;
    const keyHash = hashApiKeySecret(raw);
    const keyPrefix = raw.slice(0, 16);

    const { data: row, error } = await tenantFrom(TABLE)
      .insert(
        tenantInsertPayload({
          name,
          key_prefix: keyPrefix,
          key_hash: keyHash,
          role,
          created_by: ctx?.userId,
          updated_at: new Date().toISOString(),
        }),
      )
      .select('id, name, key_prefix, role, created_at')
      .single();
    if (error) throw new Error(error.message);

    res.status(201).json({ apiKey: row, secret: raw });
  } catch (e) {
    console.error('POST /api/api-keys', e);
    res.status(500).json({ error: 'Failed to create API key' });
  }
});

router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const ctx = getAuthContext();
    if (ctx?.mode === 'api_key') {
      res.status(403).json({ error: 'Revoking API keys requires a user session (JWT)' });
      return;
    }

    const { error } = await tenantFrom(TABLE).delete().eq('id', req.params.id);
    if (error) throw new Error(error.message);
    res.status(204).send();
  } catch (e) {
    console.error('DELETE /api/api-keys/:id', e);
    res.status(500).json({ error: 'Failed to delete API key' });
  }
});

export default router;
