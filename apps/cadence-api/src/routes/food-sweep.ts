/**
 * The Sunday sweep's routes (S3/S4), mounted under /nutrition — path shapes match
 * apps/cadence-web/src/lib/api/meal-draft.ts exactly (that file is the contract):
 *   GET  /nutrition/sweep              → { sweep: PendingFoodSweep | null }
 *   POST /nutrition/sweep/commit       { accept: string[] } → { saved, tidy }
 *   POST /nutrition/sweep/tidy        { proposal_ids: string[] } → { tidied }
 *   POST /nutrition/sweep/tidy/revert  → { reverted }
 *   POST /nutrition/sweep/dismiss      → { ok: true }
 */
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { requireCadenceUser } from '../auth/middleware.ts';
import { commitSweep, dismissSweep, readFoodSweep } from '../services/food-sweep.ts';
import { tidyApply, tidyRevert } from '../services/food-sweep-tidy.ts';

const router = Router();
router.use(requireCadenceUser);

const commitBody = z.object({ accept: z.array(z.string().min(1)).max(10) });
const tidyBody = z.object({ proposal_ids: z.array(z.string().min(1)).max(10) });

/** Parse a body or answer 400 — local to this router by design (validation/body.ts is shared). */
function parse<T>(schema: z.ZodType<T>, body: unknown, res: Response): T | null {
  const out = schema.safeParse(body);
  if (out.success) return out.data;
  res.status(400).json({ error: out.error.issues[0]?.message ?? 'invalid body' });
  return null;
}

router.get('/sweep', async (req: Request, res: Response) => {
  const userId = req.cadenceUserId!;
  try {
    res.json({ sweep: await readFoodSweep(userId) });
  } catch (err) {
    console.error('[GET /nutrition/sweep]', err);
    res.status(500).json({ error: 'failed to read the sweep' });
  }
});

/** One commit for the toggled subset — never per-proposal accepts, never auto-applied. */
router.post('/sweep/commit', async (req: Request, res: Response) => {
  const userId = req.cadenceUserId!;
  const body = parse(commitBody, req.body, res);
  if (!body) return;
  try {
    res.json(await commitSweep(userId, body.accept));
  } catch (err) {
    console.error('[POST /nutrition/sweep/commit]', err);
    res.status(500).json({ error: 'failed to save' });
  }
});

/** The retro tidy — opt-in; brackets matching past logs, changes no numbers. */
router.post('/sweep/tidy', async (req: Request, res: Response) => {
  const userId = req.cadenceUserId!;
  const body = parse(tidyBody, req.body, res);
  if (!body) return;
  try {
    res.json(await tidyApply(userId, body.proposal_ids));
  } catch (err) {
    console.error('[POST /nutrition/sweep/tidy]', err);
    res.status(500).json({ error: 'failed to tidy' });
  }
});

router.post('/sweep/tidy/revert', async (req: Request, res: Response) => {
  const userId = req.cadenceUserId!;
  try {
    res.json(await tidyRevert(userId));
  } catch (err) {
    console.error('[POST /nutrition/sweep/tidy/revert]', err);
    res.status(500).json({ error: 'failed to revert' });
  }
});

router.post('/sweep/dismiss', async (req: Request, res: Response) => {
  const userId = req.cadenceUserId!;
  try {
    await dismissSweep(userId);
    res.json({ ok: true });
  } catch (err) {
    console.error('[POST /nutrition/sweep/dismiss]', err);
    res.status(500).json({ error: 'failed to dismiss' });
  }
});

export default router;
