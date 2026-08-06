import { Router, type Request, type Response } from 'express';
import { requireCadenceUser } from '../auth/middleware.ts';
import { cadenceConfig } from '../config.ts';
import { resetUserData } from '../services/dev-reset.ts';
import { clearTrace } from '../services/dev-trace.ts';
import { apnsConfigured, sendPushToUser } from '../services/push-apns.ts';

const router = Router();
router.use(requireCadenceUser);

/**
 * POST /dev/reset — DEV ONLY: wipe the current account's cadence data (goals, plan, chat,
 * baseline) so it can be re-onboarded from zero. Powers the in-app "Reset" button next to
 * the account switcher. Disabled once real auth lands (no CADENCE_DEV_USER_ID) so a real
 * signed-in user can never nuke their own data through this dev seam.
 */
router.post('/reset', async (req: Request, res: Response) => {
  if (!cadenceConfig.devUserId) {
    return void res.status(403).json({ error: 'dev reset is disabled outside dev mode' });
  }
  const userId = req.cadenceUserId!;
  try {
    await resetUserData(userId);
    clearTrace(userId); // also drop the in-memory X-ray trace, else it shows pre-reset activity
    res.json({ ok: true, userId });
  } catch (err) {
    console.error('[POST /dev/reset]', err);
    res.status(500).json({ error: 'reset failed' });
  }
});

/**
 * POST /dev/push-test — DEV ONLY: send a test push to the current account's registered devices.
 * Proves the APNs path end-to-end (token → provider JWT → delivery) before anything schedules
 * real pushes. Same dev gate as /reset.
 */
router.post('/push-test', async (req: Request, res: Response) => {
  if (!cadenceConfig.devUserId) {
    return void res.status(403).json({ error: 'push test is disabled outside dev mode' });
  }
  if (!apnsConfigured()) {
    return void res.status(503).json({ error: 'APNs is not configured' });
  }
  const userId = req.cadenceUserId!;
  try {
    const results = await sendPushToUser(userId, 'Cadence', 'Test push — the path works.');
    res.json({ ok: true, results });
  } catch (err) {
    console.error('[POST /dev/push-test]', err);
    res.status(500).json({ error: 'push test failed' });
  }
});

export default router;
