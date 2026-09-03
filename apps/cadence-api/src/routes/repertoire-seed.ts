/**
 * Seeding a collection — the two POSTs behind the review screen (design frame 1c).
 *
 * Its own router, mounted at '/progress' beside routes/progress.ts and progress-extras.ts, the
 * same pattern '/plan' already uses for several: a seed is a distinct responsibility with its own
 * service, and progress.ts sits near the size cap.
 *
 * Read first, write second, and never in one call. `/seed` spends a model call and stores nothing;
 * `/seed/confirm` stores exactly the rows that came back from the screen. A fault answers 502 with
 * text, never 200 with an empty list — a client that cannot tell "we broke" from "no such book"
 * will tell the person the wrong one.
 */
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { MAX_SEED_ITEMS, SEED_STATUSES } from '@cadence/shared';
import { requireCadenceUser } from '../auth/middleware.ts';
import { BodyValidationError, parseBody } from '../validation/body.ts';
import { confirmSeed, expandCollection } from '../services/repertoire-seed.ts';

const router = Router();
router.use(requireCadenceUser);

/* ── Body schemas (local on purpose — validation/body.ts is a contention point, and
      routes/nutrition-draft.ts sets the precedent for keeping a router's own shapes here) ─ */

const seedBodySchema = z.object({
  collection: z.string().trim().min(1, 'collection is required').max(120),
});

/** One confirmed row. `status` is the shared union, so the door and the writer cannot drift. */
const seedRowSchema = z.object({
  label: z.string().trim().min(1).max(120),
  composer: z.string().trim().max(120).nullish(),
  collection: z.string().trim().max(120).nullish(),
  catalogue: z.string().trim().max(120).nullish(),
  rank: z.number().int().min(1).max(MAX_SEED_ITEMS).nullish(),
  status: z.enum(SEED_STATUSES, { message: `status must be one of ${SEED_STATUSES.join(', ')}` }),
});

const confirmBodySchema = z.object({
  goal_id: z.string().uuid({ message: 'goal_id must be a uuid' }).nullish(),
  rows: z.array(seedRowSchema).min(1, 'rows is required').max(MAX_SEED_ITEMS),
});

/** POST /progress/repertoire/seed — a collection's name in, candidates out. Writes nothing. */
router.post('/repertoire/seed', async (req: Request, res: Response) => {
  const userId = req.cadenceUserId!;
  try {
    const { collection } = parseBody(seedBodySchema, req.body);
    const result = await expandCollection(userId, collection);
    if (!result.ok) return void res.status(502).json({ error: result.fault });
    res.json({ collection: result.collection, candidates: result.candidates });
  } catch (err) {
    if (err instanceof BodyValidationError) return void res.status(400).json({ error: err.message });
    console.error('[POST /progress/repertoire/seed]', err);
    res.status(500).json({ error: 'failed to expand collection' });
  }
});

/** POST /progress/repertoire/seed/confirm — write the confirmed rows. The only write in this file. */
router.post('/repertoire/seed/confirm', async (req: Request, res: Response) => {
  const userId = req.cadenceUserId!;
  try {
    const { goal_id, rows } = parseBody(confirmBodySchema, req.body);
    const result = await confirmSeed(userId, rows, goal_id ?? null);
    if (!result.ok) return void res.status(502).json({ error: result.fault });
    res.json({ written: result.written, labels: result.labels, refused: result.refused });
  } catch (err) {
    if (err instanceof BodyValidationError) return void res.status(400).json({ error: err.message });
    console.error('[POST /progress/repertoire/seed/confirm]', err);
    res.status(500).json({ error: 'failed to save the collection' });
  }
});

export default router;
