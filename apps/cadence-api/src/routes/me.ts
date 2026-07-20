import { Router, type Request, type Response } from 'express';
import { requireCadenceUser } from '../auth/middleware.ts';
import { resetUserData } from '../services/dev-reset.ts';
import { clearTrace } from '../services/dev-trace.ts';
import { AimError, purgeUserAiData } from '../ai/aim.ts';

const router = Router();
router.use(requireCadenceUser);

/**
 * DELETE /me/data — "Start over": wipe THIS user's Cadence data (goals, plan, chat, logs,
 * baseline). Real-auth allowed (unlike the dev-gated /dev/reset). Guarded server-side by a
 * typed confirmation phrase — the client can't fat-finger this into existence. Order matters:
 * purge provider-side chats FIRST (a mid-flight failure then leaves local data intact and the
 * whole thing retryable, rather than local-wiped with provider copies retained). This is NOT
 * account deletion — the Supabase login survives; the UI copy says so.
 */
router.delete('/data', async (req: Request, res: Response) => {
  const userId = req.cadenceUserId!;
  if (req.body?.confirm !== 'start over') {
    return void res.status(400).json({ error: 'confirmation phrase required' });
  }
  try {
    await purgeUserAiData(userId);
    await resetUserData(userId);
    clearTrace(userId);
    res.json({ ok: true });
  } catch (err) {
    const aim = AimError.fromUnknown(err);
    console.error('[DELETE /me/data]', aim.kind, aim.message);
    res.status(aim.httpStatus).json({
      error: 'start over failed — nothing was partially deleted locally; try again',
      kind: aim.kind,
    });
  }
});

export default router;
