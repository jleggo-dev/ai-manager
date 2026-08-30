import { Router, type Request, type Response } from 'express';
import { requireCadenceUser } from '../auth/middleware.ts';
import { listGoalsByStatus } from '../repos/goals.ts';
import { getCommitted, getLatestDraft, getDraftById, commitDraft, dismissDraft } from '../repos/progress-layouts.ts';
import { defaultLayout } from '../services/progress-layout.ts';
import { BodyValidationError, parseBody, progressLayoutDraftIdBodySchema } from '../validation/body.ts';

const router = Router();
router.use(requireCadenceUser);

/**
 * GET /me/progress-layout — the committed layout if the user (or, from Wave 3, the coach via the
 * progress talk) has set one; otherwise the deterministic default composed from their goals right
 * now. Never a model call — docs/cadence/PROGRESS-ENGINE.md "The layout model".
 */
router.get('/progress-layout', async (req: Request, res: Response) => {
  const userId = req.cadenceUserId!;
  try {
    const committed = await getCommitted(userId);
    if (committed) return void res.json(committed.layout);
    // Same goal statuses buildProgress uses: confirmed AND committed — a count goal is trackable
    // even before it produces plan activities, and replan-era goals can sit at confirmed indefinitely.
    const goals = await listGoalsByStatus(userId, ['confirmed', 'committed']);
    res.json(defaultLayout(goals));
  } catch (err) {
    console.error('[GET /me/progress-layout]', err);
    res.status(500).json({ error: 'failed to build progress layout' });
  }
});

/**
 * GET /me/progress-layout/draft — the coach's current proposal, if `propose_progress_layout` (the
 * progress talk) has put one up and it is still awaiting a tap. Polled the same way the client
 * already polls `pending_plan`/`pending_week_review` — a tool call never reaches the browser
 * directly, so this IS how the client learns a card is due.
 */
router.get('/progress-layout/draft', async (req: Request, res: Response) => {
  const userId = req.cadenceUserId!;
  try {
    const draft = await getLatestDraft(userId);
    res.json({ draft: draft ? { draft_id: draft.id, layout: draft.layout } : null });
  } catch (err) {
    console.error('[GET /me/progress-layout/draft]', err);
    res.status(500).json({ error: 'failed to read progress layout draft' });
  }
});

/**
 * POST /me/progress-layout/commit — accept the proposal: the draft becomes the committed layout
 * (supersedes whatever was committed before). 404 when `draft_id` is unknown or no longer a live
 * draft (already committed or dismissed) — looked up first so a stale id never reaches
 * `commitDraft`'s own not-found throw.
 */
router.post('/progress-layout/commit', async (req: Request, res: Response) => {
  const userId = req.cadenceUserId!;
  try {
    const { draft_id } = parseBody(progressLayoutDraftIdBodySchema, req.body);
    const draft = await getDraftById(userId, draft_id);
    if (!draft) return void res.status(404).json({ error: 'unknown or already-resolved draft' });
    const committed = await commitDraft(userId, draft_id);
    res.json({ layout: committed.layout });
  } catch (err) {
    if (err instanceof BodyValidationError) return void res.status(400).json({ error: err.message });
    console.error('[POST /me/progress-layout/commit]', err);
    res.status(500).json({ error: 'failed to commit progress layout' });
  }
});

/**
 * POST /me/progress-layout/dismiss — decline the proposal; their page is untouched, and the next
 * `propose_progress_layout` call starts fresh. 404 when `draft_id` is unknown or already resolved.
 */
router.post('/progress-layout/dismiss', async (req: Request, res: Response) => {
  const userId = req.cadenceUserId!;
  try {
    const { draft_id } = parseBody(progressLayoutDraftIdBodySchema, req.body);
    const dismissed = await dismissDraft(userId, draft_id);
    if (!dismissed) return void res.status(404).json({ error: 'unknown or already-resolved draft' });
    res.json({ ok: true });
  } catch (err) {
    if (err instanceof BodyValidationError) return void res.status(400).json({ error: err.message });
    console.error('[POST /me/progress-layout/dismiss]', err);
    res.status(500).json({ error: 'failed to dismiss progress layout draft' });
  }
});

export default router;
