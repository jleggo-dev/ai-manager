import { Router, type Request, type Response } from 'express';
import { timingSafeEqual } from 'node:crypto';
import { cadenceConfig } from '../config.ts';
import { runTick } from '../services/notify/tick.ts';

/**
 * Machine-to-machine endpoints. NOT mounted under the user auth middleware — the caller is a
 * cron with no Supabase session — so this file owns its own gate, and that gate is the only
 * thing standing between the internet and a user's notification budget.
 */
const router = Router();

/** Constant-time compare that tolerates length differences without leaking them via early exit. */
function secretMatches(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) {
    // Still burn a comparison so a wrong-length guess is not measurably faster than a
    // right-length one; compare b against itself to keep the timing shape identical.
    timingSafeEqual(b, b);
    return false;
  }
  return timingSafeEqual(a, b);
}

/**
 * Fails CLOSED when the secret is unconfigured. The tempting alternative — "no secret set, so
 * allow it" — turns a missing env var in one environment into a public endpoint, which is
 * precisely the deployment slip most likely to happen.
 */
function requireCronSecret(req: Request, res: Response): boolean {
  const expected = cadenceConfig.cronSecret;
  if (!expected) {
    console.error('[internal] CADENCE_CRON_SECRET is not set — refusing.');
    res.status(503).json({ error: 'scheduler not configured' });
    return false;
  }
  const header = req.get('authorization') ?? '';
  const provided = header.startsWith('Bearer ') ? header.slice(7) : (req.get('x-cron-secret') ?? '');
  if (!provided || !secretMatches(provided, expected)) {
    res.status(401).json({ error: 'unauthorized' });
    return false;
  }
  return true;
}

/**
 * POST /internal/notifications/tick — run one scheduler pass.
 *
 * Idempotent by construction: every candidate is deduped on (user, kind, target) inside
 * `notify()`, so a cron that double-fires, retries, or overlaps a slow run cannot double-send.
 * That is what makes it safe to call this on a short interval, or by hand while debugging.
 *
 * Always 200 with a summary when authorised — including when producers failed. A cron that sees
 * 500 will retry, and retrying a partially-complete tick is exactly the situation the dedupe
 * key exists to survive; reporting the errors in the body is more useful than a status code
 * nobody is watching.
 */
router.post('/notifications/tick', async (req: Request, res: Response) => {
  if (!requireCronSecret(req, res)) return;
  try {
    const result = await runTick(new Date());
    if (result.candidates > 0 || result.errors.length > 0) {
      console.log('[tick]', JSON.stringify(result));
    }
    res.json({ ok: true, ...result });
  } catch (err) {
    console.error('[POST /internal/notifications/tick]', err);
    res.status(500).json({ error: 'tick failed' });
  }
});

export default router;
