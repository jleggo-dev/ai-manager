/**
 * The Changes sheet's own routes — split into a NEW file rather than grown inside routes/plan.ts,
 * which is already at its size gate (same reasoning as routes/week.ts and routes/week-review.ts).
 * Mounted under /plan so the URLs read as if they lived there: POST /plan/pending-change/toggles,
 * GET /plan/pending-change/detail. The existing GET /plan/pending-change and its /dismiss stay in
 * plan.ts untouched — this file only adds the two the sheet needed.
 */
import { Router, type Request, type Response } from 'express';
import { requireCadenceUser } from '../auth/middleware.ts';
import { getUser, setPendingPlan } from '../repos/users.ts';
import { BodyValidationError, parseBody, pendingChangeTogglesBodySchema } from '../validation/body.ts';
import { buildPendingChangeDetail } from '../services/plan-change-detail.ts';

const router = Router();
router.use(requireCadenceUser);

/**
 * POST /plan/pending-change/toggles — the sheet's per-card flips, persisted so they survive to the
 * funnel: `propose_plan_change` already writes `enabled` onto the stored proposal, and
 * `resolveToggledActivities` (plan-partial-apply.ts) reads it at commit — this route is the one
 * thing between the two that lets the USER'S taps reach that same field. 409 with nothing pending
 * to toggle; 400 on an index outside the stored array (stale — the array moved since the sheet
 * fetched it, so acting on it would touch the wrong row).
 */
router.post('/pending-change/toggles', async (req: Request, res: Response) => {
  const userId = req.cadenceUserId!;
  try {
    const { toggles } = parseBody(pendingChangeTogglesBodySchema, req.body);
    const pending = (await getUser(userId))?.pending_plan;
    if (!pending?.activities?.length) return void res.status(409).json({ error: 'no pending change' });

    const activities = pending.activities;
    const outOfRange = toggles.find((t) => t.index >= activities.length);
    if (outOfRange) {
      return void res
        .status(400)
        .json({ error: `toggle index ${outOfRange.index} is out of range (0-${activities.length - 1})` });
    }

    for (const t of toggles) {
      const row = activities[t.index];
      if (row) row.enabled = t.enabled;
    }
    await setPendingPlan(userId, pending);
    res.json({ ok: true });
  } catch (err) {
    if (err instanceof BodyValidationError) return void res.status(400).json({ error: err.message });
    console.error('[POST /plan/pending-change/toggles]', err);
    res.status(500).json({ error: 'toggle failed' });
  }
});

/**
 * GET /plan/pending-change/detail — the FULL per-item view the Changes sheet renders (title,
 * reason, enabled, NOW → NEXT WEEK). See services/plan-change-detail.ts. Nothing pending is 200
 * with an empty list, matching /plan/pending-change's own convention — the sheet only ever opens
 * after something has already confirmed a change is there, so this is a detail fetch, not the
 * existence check.
 */
router.get('/pending-change/detail', async (req: Request, res: Response) => {
  const userId = req.cadenceUserId!;
  try {
    res.json(await buildPendingChangeDetail(userId));
  } catch (err) {
    console.error('[GET /plan/pending-change/detail]', err);
    res.status(500).json({ error: 'failed to load change detail' });
  }
});

export default router;
