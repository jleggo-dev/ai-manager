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
import { getUser, setPendingRepertoireReview } from '../repos/users.ts';

const router = Router();
router.use(requireCadenceUser);

/* ── Body schemas (local on purpose — validation/body.ts is a contention point, and
      routes/nutrition-draft.ts sets the precedent for keeping a router's own shapes here) ─ */

const seedBodySchema = z.object({
  collection: z.string().trim().min(1, 'collection is required').max(120),
  /** The coach's door only (P7): the piece she heard them say they are on, in their own words.
   *  Resolved SERVER-SIDE against the book this call produces (`resolveHereRank`) — the browser
   *  gets a rank, never a matching rule of its own. Absent for the person's own add door. */
  where_you_are: z.string().trim().max(120).nullish(),
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

/**
 * POST /progress/repertoire/seed — a collection's name in, candidates out. Writes nothing.
 *
 * `here_rank` rides the same response rather than a second call: the rank only means anything
 * against THIS list of candidates, and two calls could not be sure they were talking about the
 * same book. Always present, null when nothing was heard or when what was heard names more than
 * one piece.
 */
router.post('/repertoire/seed', async (req: Request, res: Response) => {
  const userId = req.cadenceUserId!;
  try {
    const { collection, where_you_are } = parseBody(seedBodySchema, req.body);
    // '' and null are one case here — nothing was heard — so neither reaches the resolver as text.
    const result = await expandCollection(userId, collection, where_you_are?.trim() || null);
    if (!result.ok) return void res.status(502).json({ error: result.fault });
    res.json({ collection: result.collection, candidates: result.candidates, here_rank: result.here_rank ?? null });
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

/* ── The coach's door (design frame 1e) ──────────────────────────────────────
   She may OFFER the review and pre-mark it; she may not write a row from it. So her tool stores a
   POINTER (`offer_repertoire_review` → cadence.users.pending_repertoire_review) and these two
   routes are the client's whole view of it: read what is offered, and clear it once the person has
   answered. Neither one writes a piece — the confirm above is still the only writer, for both
   doors. Filed here rather than in a router of their own because they are the same feature as the
   two POSTs above; splitting them would put one screen's contract in two files. */

/**
 * GET /progress/repertoire/seed/offer — the collection she last offered to lay out, if the person
 * has not answered yet. A card is not worth a broken conversation, so a failed read answers "no
 * offer" (200) rather than a status the chat surface would have to handle: the prose already said
 * she was putting it up, and the honest fallback is a missing card, not an error over the thread.
 */
router.get('/repertoire/seed/offer', async (req: Request, res: Response) => {
  const userId = req.cadenceUserId!;
  try {
    const offer = (await getUser(userId))?.pending_repertoire_review ?? null;
    res.json({ offer });
  } catch (err) {
    console.error('[GET /progress/repertoire/seed/offer]', err);
    res.json({ offer: null });
  }
});

/**
 * POST /progress/repertoire/seed/offer/clear — the person answered. Both answers land here: "Not
 * now" clears it having opened nothing, and a finished review clears it having written its rows
 * through `/seed/confirm`. Nothing else was ever stored by offering, so there is nothing else to
 * undo — and a failure is reported rather than swallowed, because a clear that quietly did nothing
 * puts the same offer back on the next turn after they declined it.
 */
router.post('/repertoire/seed/offer/clear', async (req: Request, res: Response) => {
  const userId = req.cadenceUserId!;
  try {
    await setPendingRepertoireReview(userId, null);
    res.json({ ok: true });
  } catch (err) {
    console.error('[POST /progress/repertoire/seed/offer/clear]', err);
    res.status(500).json({ error: 'clear failed' });
  }
});

export default router;
