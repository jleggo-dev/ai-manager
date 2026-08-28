import { Router, type Request, type Response } from 'express';
import { kindsExcludedByTier, kindsForTier, maxPerDayForTier } from '@cadence/shared';
import { requireCadenceUser } from '../auth/middleware.ts';
import { getNotificationPrefs, upsertNotificationPrefs } from '../repos/notifications.ts';
import { buildLocalNudgePlan } from '../services/notify/local-plan.ts';
import { BodyValidationError, parseBody } from '../validation/body.ts';
import { notificationPrefsBodySchema } from '../validation/notifications.ts';

/**
 * The user's own view of the volume dial.
 *
 * Deliberately narrow: enabled, tier, and the quiet window. Not exposed here are `kinds` (the
 * per-nudge escape hatch, which no UI sets today) and `max_per_day` (an operational guard, not a
 * preference) — a route that accepts a field nothing sends is a field that only ever moves by
 * accident.
 *
 * The response carries the RESOLVED consequences of the tier — which kinds it includes, which it
 * leaves out, and the day's cap — rather than making the client re-derive them. The catalog is
 * shared code, so the client could; having the server say it means the "MODERATE MEANS" card and
 * the gate that actually withholds a notification can never disagree about what moderate means.
 */
const router = Router();
router.use(requireCadenceUser);

function prefsPayload(prefs: Awaited<ReturnType<typeof getNotificationPrefs>>) {
  return {
    enabled: prefs.enabled,
    tier: prefs.tier,
    quietStartMin: prefs.quietStartMin,
    quietEndMin: prefs.quietEndMin,
    includes: kindsForTier(prefs.tier),
    excludes: kindsExcludedByTier(prefs.tier),
    maxPerDay: Math.min(prefs.maxPerDay, maxPerDayForTier(prefs.tier)),
  };
}

/** GET /me/notification-prefs — always 200; a user with no row reads the defaults. */
router.get('/notification-prefs', async (req: Request, res: Response) => {
  const userId = req.cadenceUserId!;
  try {
    res.json(prefsPayload(await getNotificationPrefs(userId)));
  } catch (err) {
    console.error('[GET /me/notification-prefs]', err);
    res.status(500).json({ error: 'failed to load notification preferences' });
  }
});

/**
 * PUT /me/notification-prefs — a partial patch, applied field by field.
 *
 * Returns the full resolved payload so the client renders what the server actually stored, not
 * what it hoped it stored. A dial that shows "lots" while the server holds "moderate" is worse
 * than a dial that failed to save, because nothing looks wrong.
 */
router.put('/notification-prefs', async (req: Request, res: Response) => {
  const userId = req.cadenceUserId!;
  try {
    const body = parseBody(notificationPrefsBodySchema, req.body);
    await upsertNotificationPrefs(userId, {
      ...(body.enabled !== undefined ? { enabled: body.enabled } : {}),
      ...(body.tier !== undefined ? { tier: body.tier } : {}),
      ...(body.quietStartMin !== undefined ? { quietStartMin: body.quietStartMin } : {}),
      ...(body.quietEndMin !== undefined ? { quietEndMin: body.quietEndMin } : {}),
    });
    res.json(prefsPayload(await getNotificationPrefs(userId)));
  } catch (err) {
    if (err instanceof BodyValidationError) return void res.status(400).json({ error: err.message });
    console.error('[PUT /me/notification-prefs]', err);
    res.status(500).json({ error: 'failed to save notification preferences' });
  }
});

/**
 * GET /me/local-nudges — the inputs the DEVICE needs to schedule the four local nudges.
 *
 * The suppression rules (a detour, a freeze that already covered yesterday, a goal that has passed
 * its date) need the streak state, the episode table and the goal set, so they are resolved here
 * rather than reconstructed by the client from a week view. The client still owns the scheduling
 * itself — quiet-hours clamping, tier gating and the iOS ceiling all need the device's own clock
 * and the OS's own limits.
 *
 * Always 200. This is fetched alongside the plan on every app load, and a notification problem
 * must never be a reason the plan fails to render.
 */
router.get('/local-nudges', async (req: Request, res: Response) => {
  const userId = req.cadenceUserId!;
  try {
    res.json(await buildLocalNudgePlan(userId, new Date()));
  } catch (err) {
    console.error('[GET /me/local-nudges]', err);
    res.status(500).json({ error: 'failed to build local nudges' });
  }
});

export default router;
