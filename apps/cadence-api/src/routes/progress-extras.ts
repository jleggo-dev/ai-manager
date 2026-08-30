/**
 * Non-temporal Progress Engine reads (docs/cadence/PROGRESS-ENGINE.md W1-5) — a second router
 * mounted at '/progress' alongside routes/progress.ts, the same pattern '/plan' already uses for
 * three routers. Each endpoint returns either the widget's payload directly, or `{ omission }`
 * (a WidgetOmission) when nothing binds — guards report evidence, never a throw or silent null.
 */
import { Router, type Request, type Response } from 'express';
import type { ProgressWindow, SessionFeedbackKind } from '@cadence/shared';
import { requireCadenceUser } from '../auth/middleware.ts';
import { isMeal } from '../services/nutrition-parse.ts';
import { getShelf } from '../services/progress-nontemporal-shelf.ts';
import { getBalance } from '../services/progress-nontemporal-balance.ts';
import { getTotal } from '../services/progress-nontemporal-total.ts';
import { getVariety } from '../services/progress-nontemporal-variety.ts';
import { getStagePath, getCountToward } from '../services/progress-nontemporal-goal.ts';
import { resolveWindowRange } from '../services/window-range.ts';

const router = Router();
router.use(requireCadenceUser);

const WINDOWS: ProgressWindow[] = ['week', 'month', 'all'];
const isWindow = (v: unknown): v is ProgressWindow => WINDOWS.includes(v as ProgressWindow);
const windowFromQuery = (v: unknown): ProgressWindow => (isWindow(v) ? v : 'month');

const FEEDBACK_KINDS: SessionFeedbackKind[] = ['movement', 'mind'];
const isFeedbackKind = (v: unknown): v is SessionFeedbackKind => FEEDBACK_KINDS.includes(v as SessionFeedbackKind);

const isIsoDate = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);

/** GET /progress/events?from&to — `shelf`: bests & firsts from goal_events in the range. */
router.get('/events', async (req: Request, res: Response) => {
  const userId = req.cadenceUserId!;
  const { from, to } = req.query;
  if (!isIsoDate(from) || !isIsoDate(to)) {
    return void res.status(400).json({ error: 'from and to (YYYY-MM-DD) are required' });
  }
  try {
    const result = await getShelf(userId, from, to);
    res.json('reason' in result ? { omission: result } : result);
  } catch (err) {
    console.error('[GET /progress/events]', err);
    res.status(500).json({ error: 'failed to load events' });
  }
});

/** GET /progress/balance?kind=&window= — `balance`: felt-state proportion from session_feedback. */
router.get('/balance', async (req: Request, res: Response) => {
  const userId = req.cadenceUserId!;
  const { kind } = req.query;
  if (!isFeedbackKind(kind)) return void res.status(400).json({ error: 'kind must be movement or mind' });
  const { from, to } = resolveWindowRange(windowFromQuery(req.query.window));
  try {
    const result = await getBalance(userId, kind, from, to);
    res.json('reason' in result ? { omission: result } : result);
  } catch (err) {
    console.error('[GET /progress/balance]', err);
    res.status(500).json({ error: 'failed to load balance' });
  }
});

/** GET /progress/totals?goal_id=&window= — `total`: presence, from counted log units. */
router.get('/totals', async (req: Request, res: Response) => {
  const userId = req.cadenceUserId!;
  const goalId = req.query.goal_id;
  if (typeof goalId !== 'string' || !goalId) return void res.status(400).json({ error: 'goal_id is required' });
  const { days, label } = resolveWindowRange(windowFromQuery(req.query.window));
  try {
    const result = await getTotal(userId, goalId, days, label);
    res.json('reason' in result ? { omission: result } : result);
  } catch (err) {
    console.error('[GET /progress/totals]', err);
    res.status(500).json({ error: 'failed to load totals' });
  }
});

/**
 * GET /progress/variety?window=&meal= — `variety`: distinct foods for a (window × meal) slice.
 * `meal` is not in the W1-5 brief's endpoint list but the widget itself is explicitly windowXmeal
 * — defaults to 'dinner' (the doc's own example) when omitted; validated against MealKind otherwise.
 */
router.get('/variety', async (req: Request, res: Response) => {
  const userId = req.cadenceUserId!;
  const mealParam = req.query.meal;
  if (mealParam !== undefined && !isMeal(mealParam)) {
    return void res.status(400).json({ error: 'meal must be a meal kind' });
  }
  const meal = isMeal(mealParam) ? mealParam : 'dinner';
  const { from, to, label } = resolveWindowRange(windowFromQuery(req.query.window));
  try {
    const result = await getVariety(userId, meal, from, to, label);
    res.json('reason' in result ? { omission: result } : result);
  } catch (err) {
    console.error('[GET /progress/variety]', err);
    res.status(500).json({ error: 'failed to load variety' });
  }
});

/** GET /progress/stage-path?goal_id= — `stage_path`: stage chips from a goal's milestones. */
router.get('/stage-path', async (req: Request, res: Response) => {
  const userId = req.cadenceUserId!;
  const goalId = req.query.goal_id;
  if (typeof goalId !== 'string' || !goalId) return void res.status(400).json({ error: 'goal_id is required' });
  try {
    const result = await getStagePath(userId, goalId);
    res.json('reason' in result ? { omission: result } : result);
  } catch (err) {
    console.error('[GET /progress/stage-path]', err);
    res.status(500).json({ error: 'failed to load stage path' });
  }
});

/** GET /progress/count?goal_id= — `count_toward`: n of target from a count-measure goal. */
router.get('/count', async (req: Request, res: Response) => {
  const userId = req.cadenceUserId!;
  const goalId = req.query.goal_id;
  if (typeof goalId !== 'string' || !goalId) return void res.status(400).json({ error: 'goal_id is required' });
  try {
    const result = await getCountToward(userId, goalId);
    res.json('reason' in result ? { omission: result } : result);
  } catch (err) {
    console.error('[GET /progress/count]', err);
    res.status(500).json({ error: 'failed to load count' });
  }
});

export default router;
