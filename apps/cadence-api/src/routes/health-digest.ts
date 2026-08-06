import { Router, type Request, type Response } from 'express';
import { requireCadenceUser } from '../auth/middleware.ts';
import { insertHealthDigest, latestHealthDigest } from '../repos/health-digests.ts';
import { renderHealthDigest } from '../services/health-context.ts';
import { injectCoachContext } from '../ai/aim.ts';
import { BodyValidationError, parseBody } from '../validation/body.ts';
import { healthDigestBodySchema } from '../validation/health.ts';

const router = Router();
router.use(requireCadenceUser);

/**
 * POST /me/health-digest — store a client-built Apple Health summary (confirm-first: the
 * client only sends this after the user accepts the in-chat offer). The insert trips the
 * 0022/0024 pack_touch watermark, so the next pack build sees it via get_health_history.
 * With `sessionId`, the digest is ALSO injected into the running coach session as a
 * `<context>` turn, so the coach can use it on the very next reply — no session restart.
 */
router.post('/health-digest', async (req: Request, res: Response) => {
  const userId = req.cadenceUserId!;
  try {
    const body = parseBody(healthDigestBodySchema, req.body);
    await insertHealthDigest(userId, body.digest);
    if (body.sessionId) {
      try {
        await injectCoachContext(userId, body.sessionId, renderHealthDigest(body.digest), {
          source: 'health-digest',
          version: 1,
        });
      } catch (err) {
        // Stored fine; the registry path still surfaces it next pack build.
        console.error('[POST /me/health-digest] inject failed (digest stored)', err);
      }
    }
    res.json({ ok: true });
  } catch (err) {
    if (err instanceof BodyValidationError) return void res.status(400).json({ error: err.message });
    console.error('[POST /me/health-digest]', err);
    res.status(500).json({ error: 'failed to save health digest' });
  }
});

/** GET /me/health-digest — latest stored digest (Settings display; 200 with null when none). */
router.get('/health-digest', async (req: Request, res: Response) => {
  const userId = req.cadenceUserId!;
  try {
    const row = await latestHealthDigest(userId);
    res.json({ digest: row?.digest ?? null, created_at: row?.createdAt ?? null });
  } catch (err) {
    console.error('[GET /me/health-digest]', err);
    res.status(500).json({ error: 'failed to load health digest' });
  }
});

export default router;
