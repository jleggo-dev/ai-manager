import { Router, type Request, type Response } from 'express';
import { requireCadenceUser } from '../auth/middleware.ts';
import { deleteDeviceToken, upsertDeviceToken } from '../repos/device-tokens.ts';

/**
 * Device push-token registration (native shell). Mounted under /me alongside the other
 * account-scoped routes. The shell calls register after the user says yes to notifications;
 * sign-out (or a revoked permission) deletes the token.
 */
const router = Router();
router.use(requireCadenceUser);

const TOKEN_RE = /^[0-9a-f]{16,512}$/i; // APNs tokens are hex; length varies by generation

router.post('/push-token', async (req: Request, res: Response) => {
  const userId = req.cadenceUserId!;
  const token = String((req.body as { token?: unknown })?.token ?? '').trim();
  if (!TOKEN_RE.test(token)) {
    res.status(400).json({ error: 'invalid device token' });
    return;
  }
  try {
    await upsertDeviceToken(userId, token);
    res.json({ ok: true });
  } catch (err) {
    console.error('[POST /me/push-token]', err);
    res.status(500).json({ error: 'failed to register device' });
  }
});

router.delete('/push-token', async (req: Request, res: Response) => {
  const userId = req.cadenceUserId!;
  const token = String((req.body as { token?: unknown })?.token ?? '').trim();
  if (!TOKEN_RE.test(token)) {
    res.status(400).json({ error: 'invalid device token' });
    return;
  }
  try {
    await deleteDeviceToken(userId, token);
    res.json({ ok: true });
  } catch (err) {
    console.error('[DELETE /me/push-token]', err);
    res.status(500).json({ error: 'failed to remove device' });
  }
});

export default router;
