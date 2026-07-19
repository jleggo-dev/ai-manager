import type { Request, Response, NextFunction } from 'express';
import { cadenceUserClient } from '../db/supabase.ts';
import { cadenceConfig } from '../config.ts';
import { ensureUser } from '../repos/users.ts';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      cadenceUserId?: string;
    }
  }
}

/**
 * Resolve the Cadence user for a request. Real Supabase JWT auth and the dev/test accounts
 * COEXIST — they are not mutually exclusive:
 *
 * - Dev accounts: available ONLY when CADENCE_DEV_USER_ID is configured (local dev) AND the
 *   request explicitly carries a valid `X-Cadence-Dev-User` slug. The web app sends that header
 *   only in dev mode (`?dev=1`). A request WITHOUT the header falls through to JWT validation, so
 *   the real login flow can be exercised locally too. In production the env var is unset, so this
 *   branch is dead and the header is ignored entirely — no auth bypass ships.
 * - Real auth: validate the Cadence Supabase JWT (auth.getUser), then lazily ensure a
 *   cadence.users row exists for that Supabase user id (their first request provisions it — no
 *   signup DB trigger needed). The id is forwarded to AI Admin for per-user session scoping.
 */
export async function requireCadenceUser(req: Request, res: Response, next: NextFunction) {
  if (cadenceConfig.devUserId) {
    const slug = String(req.headers['x-cadence-dev-user'] ?? '')
      .trim()
      .toLowerCase();
    if (slug && cadenceConfig.devAccounts[slug]) {
      req.cadenceUserId = cadenceConfig.devAccounts[slug];
      next();
      return;
    }
    // no/unknown dev header → fall through to real JWT auth (don't default to a dev account)
  }

  const header = req.headers.authorization;
  const token = header?.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) {
    res.status(401).json({ error: 'Missing bearer token' });
    return;
  }
  try {
    const { data, error } = await cadenceUserClient(token).auth.getUser();
    if (error || !data.user) {
      res.status(401).json({ error: 'Invalid token' });
      return;
    }
    await ensureUser(data.user.id, data.user.email ?? null);
    req.cadenceUserId = data.user.id;
    next();
  } catch (e) {
    console.error('[auth] token validation failed', e);
    res.status(401).json({ error: 'Auth failed' });
  }
}
