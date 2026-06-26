import crypto from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import { createUserSupabase, runWithAuth } from '../db/tenant.ts';
import { getServiceSupabase } from '../db/service-supabase.ts';
import { errorMessage } from '../lib/error-message.ts';
import type { RequestAuthContext, WorkspaceRole } from '../types.ts';

const API_KEY_PREFIX = 'aim_sk_';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function normalisedPath(req: Request): string {
  let p = (req.originalUrl || req.url || '').split('?')[0] ?? '';
  if (p.length > 1 && p.endsWith('/')) p = p.slice(0, -1);
  return p;
}

function parseBearer(req: Request): string | null {
  const h = req.headers.authorization;
  if (!h || typeof h !== 'string' || !h.startsWith('Bearer ')) return null;
  return h.slice(7).trim();
}

function workspaceHeader(req: Request): string {
  const w = req.headers['x-workspace-id'];
  if (w == null || w === '') return '';
  return String(w).trim();
}

export function hashApiKeySecret(raw: string): string {
  return crypto.createHash('sha256').update(raw, 'utf8').digest('hex');
}

function isPublicPath(p: string): boolean {
  return p === '/api/health' || p.startsWith('/api/auth/');
}

function workspaceHeaderOptional(p: string, method: string): boolean {
  return p === '/api/workspaces' && method === 'GET';
}

/** Resolve when the HTTP response is done so AsyncLocalStorage stays active for the whole request. */
function waitForResponseEnd(res: Response): Promise<void> {
  return new Promise((resolve) => {
    if (res.writableEnded) {
      resolve();
      return;
    }
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    res.once('finish', done);
    res.once('close', done);
  });
}

/**
 * Express middleware: Bearer JWT (Supabase) or API key (`aim_sk_…`), workspace scope, AsyncLocalStorage auth.
 * Keeps auth context until `res` finishes so async routes can `await` and still use tenantFrom().
 */
export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  const p = normalisedPath(req);
  if (isPublicPath(p)) {
    next();
    return;
  }

  (async () => {
    const token = parseBearer(req);
    if (!token) {
      res.status(401).json({ error: 'Authorization: Bearer token required' });
      return;
    }

    const headerWorkspaceId = workspaceHeader(req);
    const optionalWs = workspaceHeaderOptional(p, req.method);

    if (token.startsWith(API_KEY_PREFIX)) {
      const hash = hashApiKeySecret(token);
      const svc = getServiceSupabase();
      const { data: keyRow, error: keyErr } = await svc.from('api_keys').select('*').eq('key_hash', hash).maybeSingle();

      if (keyErr || !keyRow) {
        console.warn(`[auth] Invalid API key from ${req.ip}`);
        res.status(401).json({ error: 'Invalid API key' });
        return;
      }

      if (headerWorkspaceId && headerWorkspaceId !== keyRow.workspace_id) {
        res.status(403).json({ error: 'X-Workspace-Id does not match this API key' });
        return;
      }

      svc
        .from('api_keys')
        .update({ last_used_at: new Date().toISOString() })
        .eq('id', keyRow.id)
        .then(null, (err: unknown) => console.warn('[auth] last_used_at update failed:', errorMessage(err)));

      if (!keyRow?.workspace_id || !keyRow?.id) {
        res.status(500).json({ error: 'Invalid API key record' });
        return;
      }

      const rawForwarded = ((req.headers['x-forwarded-user-id'] as string) || '').trim();
      if (rawForwarded && !UUID_RE.test(rawForwarded)) {
        res.status(400).json({ error: 'X-Forwarded-User-Id must be a valid UUID' });
        return;
      }
      const forwardedUserId = rawForwarded || null;
      if (forwardedUserId) {
        console.info(`[auth] API key ${keyRow.id} forwarding user identity: ${forwardedUserId}`);
      }

      const ctx: RequestAuthContext = {
        mode: 'api_key',
        workspaceId: keyRow.workspace_id,
        apiKeyId: keyRow.id,
        userId: (keyRow.created_by as string) || undefined,
        forwardedUserId,
        apiKeyRole: (keyRow.role as WorkspaceRole) || 'member',
        callingApplicationId: (keyRow.calling_application_id as string) || null,
      };

      await runWithAuth(ctx, async () => {
        const done = waitForResponseEnd(res);
        next();
        await done;
      });
      return;
    }

    let userClient;
    try {
      userClient = createUserSupabase(token);
    } catch (e: unknown) {
      console.error('[auth] createUserSupabase failed:', errorMessage(e));
      res.status(500).json({ error: 'Auth configuration error' });
      return;
    }

    let user;
    let userErr: unknown;
    try {
      const out = await userClient.auth.getUser();
      user = out.data?.user;
      userErr = out.error;
    } catch (err: unknown) {
      userErr = err;
    }
    if (userErr || !user) {
      console.warn(`[auth] Invalid JWT from ${req.ip}`);
      res.status(401).json({ error: 'Invalid or expired session' });
      return;
    }

    if (!optionalWs && !headerWorkspaceId) {
      res.status(400).json({ error: 'X-Workspace-Id header is required' });
      return;
    }

    if (headerWorkspaceId && !UUID_RE.test(headerWorkspaceId)) {
      res.status(400).json({ error: 'X-Workspace-Id must be a valid UUID' });
      return;
    }

    const workspaceId = headerWorkspaceId || null;

    const jwtCtx: RequestAuthContext = {
      mode: 'jwt',
      workspaceId,
      userId: user.id,
      userClient,
    };

    await runWithAuth(jwtCtx, async () => {
      const done = waitForResponseEnd(res);
      next();
      await done;
    });
  })().catch((err: unknown) => {
    console.error('authMiddleware', err);
    if (!res.headersSent) next(err);
  });
}
