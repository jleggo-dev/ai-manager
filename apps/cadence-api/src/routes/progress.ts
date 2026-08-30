import { Router, type Request, type Response } from 'express';
import { requireCadenceUser } from '../auth/middleware.ts';
import { buildProgress } from '../services/progress.ts';
import { parseProgressWindow } from '../services/progress-window.ts';
import { resolveRhythm } from '../services/progress-rhythm.ts';
import { insertGoalEvent } from '../repos/goal-events.ts';
import { getGoal } from '../repos/goals.ts';
import { listOccurrences } from '../repos/occurrences.ts';
import { listCheckInDays } from '../repos/check-ins.ts';
import { listEpisodeRanges } from '../repos/episodes.ts';
import { BodyValidationError, parseBody, progressEventBodySchema } from '../validation/body.ts';

const router = Router();
router.use(requireCadenceUser);
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_HISTORY_SPAN_DAYS = 400;

/**
 * GET /progress?window=week|month|all — the deterministic dashboard: goal cards + activity
 * trends + history. `window` OMITTED is exactly the original behavior (backwards compatible);
 * an unrecognized value is a 400, never a silent fallback (see progress-window.ts).
 */
router.get('/', async (req: Request, res: Response) => {
  const userId = req.cadenceUserId!;
  const windowRaw = req.query.window;
  if (windowRaw !== undefined && parseProgressWindow(windowRaw) === undefined) {
    return void res.status(400).json({ error: 'window must be week, month, or all' });
  }
  try {
    res.json(await buildProgress(userId, parseProgressWindow(windowRaw)));
  } catch (err) {
    console.error('[GET /progress]', err);
    res.status(500).json({ error: 'failed to build progress' });
  }
});

/**
 * GET /progress/history?from=YYYY-MM-DD&to=YYYY-MM-DD — the rhythm widget's raw inputs (occurrence
 * statuses, check-in days, episode ranges over the LITERAL requested span) alongside the already-
 * assembled `RhythmPayload` (week-aligned — see resolveRhythm — so the client needs no re-derivation).
 */
router.get('/history', async (req: Request, res: Response) => {
  const userId = req.cadenceUserId!;
  const from = typeof req.query.from === 'string' ? req.query.from : '';
  const to = typeof req.query.to === 'string' ? req.query.to : '';
  if (!ISO_DATE_RE.test(from) || !ISO_DATE_RE.test(to)) {
    return void res.status(400).json({ error: 'from/to are required as YYYY-MM-DD' });
  }
  if (to < from) return void res.status(400).json({ error: 'to must not be before from' });
  const spanDays = Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000) + 1;
  if (spanDays > MAX_HISTORY_SPAN_DAYS) {
    return void res.status(400).json({ error: `span too large (max ${MAX_HISTORY_SPAN_DAYS} days)` });
  }
  try {
    const [occRows, checkIns, episodes, rhythm] = await Promise.all([
      listOccurrences(userId, from, to),
      listCheckInDays(userId, from, to),
      listEpisodeRanges(userId, from, to),
      resolveRhythm(userId, from, to),
    ]);
    res.json({
      from,
      to,
      occurrences: occRows.map((o) => ({ date: new Date(o.date).toISOString().slice(0, 10), status: o.status })),
      check_ins: checkIns,
      episodes,
      rhythm,
    });
  } catch (err) {
    console.error('[GET /progress/history]', err);
    res.status(500).json({ error: 'failed to load history' });
  }
});

/**
 * POST /progress/events — the manual "+1" on a count card ("finished Dune"). goal_id is
 * validated as the user's own; label required. (The other write path is parse-session-log.)
 */
router.post('/events', async (req: Request, res: Response) => {
  const userId = req.cadenceUserId!;
  try {
    const { label, goal_id: goalId } = parseBody(progressEventBodySchema, req.body);
    if (goalId && !(await getGoal(userId, goalId))) {
      return void res.status(404).json({ error: 'goal not found' });
    }
    const ev = await insertGoalEvent(userId, { goal_id: goalId, kind: 'completion', label });
    res.json(ev);
  } catch (err) {
    if (err instanceof BodyValidationError) return void res.status(400).json({ error: err.message });
    console.error('[POST /progress/events]', err);
    res.status(500).json({ error: 'failed to record' });
  }
});

export default router;
