import { Router, type Request, type Response } from 'express';
import { requireCadenceUser } from '../auth/middleware.ts';
import { BodyValidationError, occurrenceDateBodySchema, parseBody } from '../validation/body.ts';
import {
  duplicateOccurrence,
  moveOccurrence,
  removeOccurrence,
  type OccurrenceEditResult,
} from '../services/occurrence-edit.ts';

/**
 * The trail's hold menu on the wire (2026-09-07): move a task to a day this week, copy it onto
 * one, delete it. Its own file — a distinct responsibility, and plan.ts is at the size gate.
 *
 * Every rule lives in services/occurrence-edit.ts; this file maps its answers to status codes:
 *   200 ok · 404 not this user's row (or no plan) · 409 the activity already sits on that day
 *   (body names the row, so a "do it now" can open it instead) · 422 the day is outside this week.
 */
const router = Router();
router.use(requireCadenceUser);

/** The caller's IANA zone, when the client sent one. Never trusted over the stored value. */
function tzHint(req: Request): string | null {
  const h = req.header('X-Cadence-Timezone');
  return h && h.length < 64 ? h : null;
}

function answer(res: Response, r: OccurrenceEditResult): void {
  switch (r.status) {
    case 'ok':
      return void res.json({ ok: true, occurrence_id: r.occurrence_id });
    case 'not_found':
      return void res.status(404).json({ error: 'occurrence not found' });
    case 'conflict':
      return void res.status(409).json({
        error: 'already_there',
        existing_occurrence_id: r.existing_occurrence_id,
        existing_status: r.existing_status,
      });
    case 'out_of_range':
      return void res.status(422).json({ error: 'out_of_range', from: r.from, to: r.to });
  }
}

router.post('/occurrences/:id/move', async (req: Request, res: Response) => {
  const userId = req.cadenceUserId!;
  try {
    const { date } = parseBody(occurrenceDateBodySchema, req.body);
    answer(res, await moveOccurrence(userId, req.params.id as string, date, tzHint(req)));
  } catch (err) {
    if (err instanceof BodyValidationError) return void res.status(400).json({ error: err.message });
    console.error('[POST /plan/occurrences/:id/move]', err);
    res.status(500).json({ error: 'move failed' });
  }
});

router.post('/occurrences/:id/duplicate', async (req: Request, res: Response) => {
  const userId = req.cadenceUserId!;
  try {
    const { date } = parseBody(occurrenceDateBodySchema, req.body);
    answer(res, await duplicateOccurrence(userId, req.params.id as string, date, tzHint(req)));
  } catch (err) {
    if (err instanceof BodyValidationError) return void res.status(400).json({ error: err.message });
    console.error('[POST /plan/occurrences/:id/duplicate]', err);
    res.status(500).json({ error: 'duplicate failed' });
  }
});

router.delete('/occurrences/:id', async (req: Request, res: Response) => {
  const userId = req.cadenceUserId!;
  try {
    const r = await removeOccurrence(userId, req.params.id as string);
    if (r === 'not_found') return void res.status(404).json({ error: 'occurrence not found' });
    res.json({ ok: true });
  } catch (err) {
    console.error('[DELETE /plan/occurrences/:id]', err);
    res.status(500).json({ error: 'delete failed' });
  }
});

export default router;
