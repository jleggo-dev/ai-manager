import { Router, Request, Response } from 'express';
import { getAuthContext } from '../db/tenant.ts';
import { requireRole } from '../middleware/require-role.ts';
import { validateBody } from '../middleware/validate.ts';
import { parsePagination } from '../lib/pagination.ts';
import { updateUserStatusSchema } from '../schemas/admin-users.ts';
import {
  enrichProfilesWithAuthMeta,
  ensureDefaultWorkspaceMembership,
  listProfiles,
  setProfileStatus,
} from '../models/profiles.ts';
import type { AccountStatus } from '../constants/account-status.ts';
import { isAccountStatus } from '../constants/account-status.ts';

const router = Router();

router.use(requireRole('owner', 'admin'));

/** List all platform users (profiles) with optional status filter and search. */
router.get('/', async (req: Request, res: Response) => {
  try {
    const ctx = getAuthContext();
    if (ctx?.mode !== 'jwt') {
      res.status(403).json({ error: 'User management requires a Supabase user session (JWT)' });
      return;
    }

    const statusRaw = (req.query.status as string) || '';
    const status = statusRaw && isAccountStatus(statusRaw) ? (statusRaw as AccountStatus) : undefined;
    const search = (req.query.search as string) || undefined;
    const pagination = parsePagination(req);

    const page = await listProfiles({ status, search, pagination });
    const enriched = await enrichProfilesWithAuthMeta(page.data);

    res.json({
      users: enriched,
      pagination: page.pagination,
    });
  } catch (e) {
    console.error('GET /api/admin/users', e);
    res.status(500).json({ error: 'Failed to list users' });
  }
});

/** Approve, suspend, or reset a user to pending. */
router.patch('/:userId', validateBody(updateUserStatusSchema), async (req: Request, res: Response) => {
  try {
    const ctx = getAuthContext();
    if (ctx?.mode !== 'jwt' || !ctx.userId) {
      res.status(403).json({ error: 'User management requires a Supabase user session (JWT)' });
      return;
    }

    const targetUserId = req.params.userId as string;
    const { status } = req.body as { status: AccountStatus };

    if (targetUserId === ctx.userId && status !== 'approved') {
      res.status(400).json({ error: 'You cannot suspend or pend your own account' });
      return;
    }

    const updated = await setProfileStatus(targetUserId, status, ctx.userId);

    if (status === 'approved') {
      await ensureDefaultWorkspaceMembership(targetUserId);
    }

    res.json({ user: updated });
  } catch (e) {
    console.error('PATCH /api/admin/users/:userId', e);
    res.status(500).json({ error: 'Failed to update user status' });
  }
});

export default router;
