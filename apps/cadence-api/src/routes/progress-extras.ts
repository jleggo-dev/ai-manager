/**
 * Non-temporal Progress Engine reads (docs/cadence/PROGRESS-ENGINE.md W1-5) — a second router
 * mounted at '/progress' alongside routes/progress.ts, the same pattern '/plan' already uses for
 * three routers. Each endpoint returns either the widget's payload directly, or `{ omission }`
 * (a WidgetOmission) when nothing binds — guards report evidence, never a throw or silent null.
 */
import { Router, type Request, type Response } from 'express';
import type { ProgressWindow, RepertoireItem, RepertoireStatus, SessionFeedbackKind } from '@cadence/shared';
import { qualifierMeta } from '@cadence/shared';
import { requireCadenceUser } from '../auth/middleware.ts';
import { isMeal } from '../services/nutrition-parse.ts';
import { getShelf } from '../services/progress-nontemporal-shelf.ts';
import { getBalance } from '../services/progress-nontemporal-balance.ts';
import { getTotal } from '../services/progress-nontemporal-total.ts';
import { getVariety } from '../services/progress-nontemporal-variety.ts';
import { getStagePath, getCountToward } from '../services/progress-nontemporal-goal.ts';
import { getRepertoireCard } from '../services/progress-nontemporal-repertoire.ts';
import { getFeltWeeks } from '../services/progress-felt-weeks.ts';
import { getThenNow } from '../services/progress-then-now.ts';
import { resolveWindowRange } from '../services/window-range.ts';
import {
  deleteRepertoireItem,
  listRepertoire,
  renameRepertoireItem,
  RepertoireRenameConflictError,
  updateRepertoireItem,
} from '../repos/repertoire.ts';
import { collidingTitles, invalidateSessionsFor } from '../services/repertoire-practice.ts';
import { parseBody, patchRepertoireItemBodySchema, BodyValidationError } from '../validation/body.ts';

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

/** GET /progress/repertoire?goal_id= — `repertoire`: what they're learning or already have.
 *  `goal_id` is optional: present scopes to that goal's items, absent shows everything they keep.
 *  The card ignores the page's window control honestly — a repertoire has no time axis. */
router.get('/repertoire', async (req: Request, res: Response) => {
  const userId = req.cadenceUserId!;
  const goalId = req.query.goal_id;
  if (goalId !== undefined && (typeof goalId !== 'string' || !goalId)) {
    return void res.status(400).json({ error: 'goal_id, when given, must be a non-empty string' });
  }
  try {
    const result = await getRepertoireCard(userId, typeof goalId === 'string' ? goalId : null);
    res.json('reason' in result ? { omission: result } : result);
  } catch (err) {
    console.error('[GET /progress/repertoire]', err);
    res.status(500).json({ error: 'failed to load repertoire' });
  }
});

/** GET /progress/felt-weeks — `felt_week`: the last four weeks colored by daily check-in mood.
 *  No params: felt has no re-window (always four weeks) and no per-goal slice. */
router.get('/felt-weeks', async (req: Request, res: Response) => {
  const userId = req.cadenceUserId!;
  try {
    const result = await getFeltWeeks(userId);
    res.json('reason' in result ? { omission: result } : result);
  } catch (err) {
    console.error('[GET /progress/felt-weeks]', err);
    res.status(500).json({ error: 'failed to load felt weeks' });
  }
});

/** GET /progress/then-now — `then_now`: plain before/after pairs mined from the whole session
 *  feed. No params: "then" is the start and "now" is the last four weeks — the card has no honest
 *  re-window and no per-goal slice. */
router.get('/then-now', async (req: Request, res: Response) => {
  const userId = req.cadenceUserId!;
  try {
    const result = await getThenNow(userId);
    res.json('reason' in result ? { omission: result } : result);
  } catch (err) {
    console.error('[GET /progress/then-now]', err);
    res.status(500).json({ error: 'failed to load then and now' });
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

/**
 * GET /progress/repertoire/items?goal_id= — the list screen's own read (P6: "the room"). The
 * `repertoire` card above (`/progress/repertoire`) is a DISPLAY summary — capped, and its rows
 * carry no `item_id` — so a screen that opens an item or PATCHes its standing/rank needs the full
 * row instead. Scoped exactly like the card (`goal_id` given ⇒ that goal's own items only; omitted
 * ⇒ everything they keep, unattached material included) so the two reads can never disagree about
 * what "this goal's repertoire" means.
 *
 * Collisions are computed HERE, once, server-side, with the same `collidingTitles` the coach's own
 * render uses (`repertoire-practice.ts`) — a second, browser-side spelling of "which titles name
 * more than one piece" is exactly the matching drift CLAUDE.md warns about, so the list is handed
 * the answer rather than the ingredients to recompute it.
 */
router.get('/repertoire/items', async (req: Request, res: Response) => {
  const userId = req.cadenceUserId!;
  const goalId = req.query.goal_id;
  if (goalId !== undefined && (typeof goalId !== 'string' || !goalId)) {
    return void res.status(400).json({ error: 'goal_id, when given, must be a non-empty string' });
  }
  try {
    const all = await listRepertoire(userId);
    const items = typeof goalId === 'string' ? all.filter((i) => i.goal_id === goalId) : all;
    res.json({ items, collisions: collidingTitles(items) });
  } catch (err) {
    console.error('[GET /progress/repertoire/items]', err);
    res.status(500).json({ error: 'failed to load repertoire items' });
  }
});

/*
 * PATCH/DELETE /progress/repertoire/:id — the item screen (P2: the item, opened). Deterministic
 * throughout: no coach call, no AI. Two repo writes because the screen itself makes two
 * independent choices (label/qualifiers commit together on "Save the name"; the standing control
 * acts on its own), but the route accepts either or both in one call since the API contract is
 * "any of label, composer, collection, catalogue, status".
 */

/** PATCH /progress/repertoire/:id — rename, edit the qualifiers, and/or flip the standing. */
router.patch('/repertoire/:id', async (req: Request, res: Response) => {
  const userId = req.cadenceUserId!;
  const itemId = req.params.id as string;
  try {
    const body = parseBody(patchRepertoireItemBodySchema, req.body);
    let row: RepertoireItem | null = null;

    if (body.label !== undefined) {
      try {
        row = await renameRepertoireItem(userId, itemId, body.label);
      } catch (err) {
        if (err instanceof RepertoireRenameConflictError) {
          return void res.status(409).json({ error: err.message });
        }
        throw err;
      }
      if (!row) return void res.status(404).json({ error: 'repertoire item not found' });
    }

    const meta = qualifierMeta({
      composer: body.composer,
      collection: body.collection,
      catalogue: body.catalogue,
      rank: body.rank,
    });
    const status = body.status as RepertoireStatus | undefined;
    if (status !== undefined || Object.keys(meta).length > 0) {
      row = await updateRepertoireItem(userId, itemId, { status, meta: Object.keys(meta).length ? meta : undefined });
      if (!row) return void res.status(404).json({ error: 'repertoire item not found' });
    }
    if (!row) return void res.status(404).json({ error: 'repertoire item not found' });

    // A rename desyncs a cached prescription's text (it no longer matches the piece's new
    // spelling); a standing leaving 'known' should stop being offered as due — same invalidation
    // the coach's own write path runs after every repertoire change (repertoire-practice.ts).
    if (row.goal_id) await invalidateSessionsFor(userId, [row]).catch(() => undefined);

    res.json(row);
  } catch (err) {
    if (err instanceof BodyValidationError) return void res.status(400).json({ error: err.message });
    console.error('[PATCH /progress/repertoire/:id]', err);
    res.status(500).json({ error: 'failed to update repertoire item' });
  }
});

/** DELETE /progress/repertoire/:id — a real delete, distinct from retiring: the row is gone, its
 *  sessions and logs keep their own text, only the link disappears. */
router.delete('/repertoire/:id', async (req: Request, res: Response) => {
  const userId = req.cadenceUserId!;
  const itemId = req.params.id as string;
  try {
    const deleted = await deleteRepertoireItem(userId, itemId);
    if (!deleted) return void res.status(404).json({ error: 'repertoire item not found' });
    if (deleted.goal_id) await invalidateSessionsFor(userId, [deleted]).catch(() => undefined);
    res.json({ ok: true });
  } catch (err) {
    console.error('[DELETE /progress/repertoire/:id]', err);
    res.status(500).json({ error: 'failed to delete repertoire item' });
  }
});

export default router;
