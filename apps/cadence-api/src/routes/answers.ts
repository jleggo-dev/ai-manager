import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { requireCadenceUser } from '../auth/middleware.ts';
import {
  readAnswerStatus,
  runKept,
  type KeptAnswerKind,
  type KeptAnswerStatus,
  type KeptFault,
} from '../services/kept-answers.ts';

/**
 * GET /answers/:request_id — the answer to a long request the client could not stay for
 * (services/kept-answers.ts). The client minted the id and sent it with the request; here it
 * asks what became of it. Always a 200 with a `status`: `done` carries the answer as the route
 * would have sent it, `failed` the fault it refused with, `running` means keep waiting, `lost`
 * means the run died, `unknown` means the request never arrived (re-send it). The client's
 * next move is decided by that word, never by an HTTP status it would have to guess at.
 */
const router = Router();
router.use(requireCadenceUser);

const requestIdSchema = z.string().uuid();

router.get('/:request_id', async (req: Request, res: Response) => {
  const userId = req.cadenceUserId!;
  const parsed = requestIdSchema.safeParse(req.params.request_id);
  if (!parsed.success) return void res.status(400).json({ error: 'request_id must be a uuid' });
  try {
    res.json(await readAnswerStatus(userId, parsed.data));
  } catch (err) {
    console.error('[GET /answers/:request_id]', err);
    res.status(500).json({ error: 'could not look that answer up' });
  }
});

export default router;

/**
 * Answer a long request under its client-made id, for a sibling route: without an id the work
 * answers as it always did; with one, its outcome is kept on the row before the answer goes out,
 * and a second request under the same id is answered from the row instead of run again.
 *
 * Throws the work's own error (the fault already kept), so the route's catch answers the live
 * client with the same status and line it would have sent anyway — `faultOf` is that catch's rule.
 */
export async function answerKept<T>(
  res: Response,
  ask: { userId: string; requestId: string | undefined; kind: KeptAnswerKind },
  work: () => Promise<T>,
  faultOf: (err: unknown) => KeptFault,
): Promise<void> {
  if (!ask.requestId) {
    res.json(await work());
    return;
  }
  const run = await runKept(ask.userId, ask.requestId, ask.kind, work, faultOf);
  if (run.owner) {
    res.json(run.answer);
    return;
  }
  answerFromStatus(res, run.status);
}

/** The second request under an id another run holds: told where that run stands. */
function answerFromStatus(res: Response, s: KeptAnswerStatus): void {
  switch (s.status) {
    case 'done':
      res.json(s.answer);
      return;
    case 'failed':
      res.status(s.fault.status).json({ error: s.fault.error });
      return;
    case 'running':
      res.status(202).json({ status: 'running', started_at: s.started_at });
      return;
    default:
      // A claim takes over a lost run and inserts an unknown id, so neither reaches here; if one
      // does, say so rather than start a read the client cannot see.
      res.status(500).json({ error: 'the earlier run of that request was lost' });
  }
}
