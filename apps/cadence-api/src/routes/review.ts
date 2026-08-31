import { Router, type Request, type Response } from 'express';
import type { Baseline, Goal } from '@cadence/shared';
import { requireCadenceUser } from '../auth/middleware.ts';
import {
  listGoalsByStatus,
  setGoalStatus,
  insertGoal,
  updateGoal,
  deleteGoal,
  retireGoal,
  restoreGoal,
} from '../repos/goals.ts';
import { listEquipment, insertEquipment, updateEquipment, deleteEquipment } from '../repos/equipment.ts';
import { getUser, mergeBaseline, setName } from '../repos/users.ts';
import { evaluateGuardrail } from '../services/goal-guardrail.ts';
import { assessGoal } from '../services/goal-assess.ts';
import {
  BodyValidationError,
  parseBody,
  patchGoalBodySchema,
  createGoalBodySchema,
  patchEquipmentBodySchema,
  createEquipmentBodySchema,
  patchProfileBodySchema,
  patchBaselineBodySchema,
} from '../validation/body.ts';

const router = Router();
router.use(requireCadenceUser);

/** GET /review — captured/confirmed state for the review wizard (spec §6.1, mockup 02). */
router.get('/', async (req: Request, res: Response) => {
  const userId = req.cadenceUserId!;
  try {
    const [goals, equipment, user] = await Promise.all([
      listGoalsByStatus(userId, ['captured', 'confirmed', 'committed']),
      listEquipment(userId),
      getUser(userId),
    ]);
    const guardrail = evaluateGuardrail(goals);
    const confirmable = goals.some((g) => g.status === 'captured');
    // Lock is gated only by the HARD cap (the focus budget is a soft, non-blocking signal — see
    // services/lock.ts); the weighted load still rides in `guardrail` for a gentle nudge later.
    const lockable = goals.some((g) => g.status === 'confirmed') && !guardrail.exceedsHardCap;
    res.json({
      name: user?.name ?? '',
      goals,
      equipment,
      baseline: user?.baseline ?? {},
      guardrail,
      confirmable,
      lockable,
    });
  } catch (err) {
    console.error('[GET /review]', err);
    res.status(500).json({ error: 'Failed to load review' });
  }
});

/** POST /review/confirm — flip captured goals → confirmed (spec §6.1 confirm gate). */
router.post('/confirm', async (req: Request, res: Response) => {
  const userId = req.cadenceUserId!;
  try {
    const captured = await listGoalsByStatus(userId, ['captured']);
    for (const g of captured) await setGoalStatus(userId, g.goal_id, 'confirmed');
    res.json({ confirmed: captured.length });
  } catch (err) {
    console.error('[POST /review/confirm]', err);
    res.status(500).json({ error: 'Failed to confirm' });
  }
});

/* ── Curate wizard: accept/reject/modify what the AI captured ──────────────── */

/** PATCH /review/goals/:id — edit a captured goal. */
router.patch('/goals/:id', async (req: Request, res: Response) => {
  const userId = req.cadenceUserId!;
  try {
    const body = parseBody(patchGoalBodySchema, req.body);
    await updateGoal(userId, req.params.id as string, {
      title: body.title,
      area: body.area,
      type: body.type,
      measure: body.measure as Goal['measure'],
      timeframe: body.timeframe as Goal['timeframe'],
      milestones: body.milestones as Goal['milestones'],
      plan_mode: body.plan_mode,
    });
    res.json({ ok: true });
  } catch (err) {
    if (err instanceof BodyValidationError) return void res.status(400).json({ error: err.message });
    console.error('[PATCH /review/goals]', err);
    res.status(500).json({ error: 'update failed' });
  }
});

/**
 * POST /review/goals/:id/retire — Settings' "Retire": parks the goal. It stops shaping the plan
 * from the next build (lock.ts/replan.ts never draw on 'parked'); everything it already built —
 * sessions logged, milestones hit — stays exactly as readable in Progress (progress.ts draws on
 * 'parked' on purpose). Reversible only through the coach (update_goal's 'restore' action) —
 * Settings itself never shows a retired goal again, by design.
 */
router.post('/goals/:id/retire', async (req: Request, res: Response) => {
  const userId = req.cadenceUserId!;
  try {
    const goal = await retireGoal(userId, req.params.id as string);
    if (!goal) return void res.status(404).json({ error: 'goal not found or already retired' });
    res.json({ ok: true, goal });
  } catch (err) {
    console.error('[POST /review/goals/:id/retire]', err);
    res.status(500).json({ error: 'retire failed' });
  }
});

/** POST /review/goals/:id/restore — bring a retired goal back to whatever it was before. Plumbing
 *  for the coach's restore path and any future UI; Settings' own flow never calls this today. */
router.post('/goals/:id/restore', async (req: Request, res: Response) => {
  const userId = req.cadenceUserId!;
  try {
    const goal = await restoreGoal(userId, req.params.id as string);
    if (!goal) return void res.status(404).json({ error: 'goal not found or not retired' });
    res.json({ ok: true, goal });
  } catch (err) {
    console.error('[POST /review/goals/:id/restore]', err);
    res.status(500).json({ error: 'restore failed' });
  }
});

/**
 * POST /review/goals/:id/assess — the coach's realism read on ONE goal + proposed stepping-stones
 * (spec §6.2). Suggest-only: returns the assessment; the client applies it via PATCH. 200 with the
 * assessment · 404 if the goal is gone · 502 if the coach couldn't produce a usable read.
 */
router.post('/goals/:id/assess', async (req: Request, res: Response) => {
  const userId = req.cadenceUserId!;
  try {
    const assessment = await assessGoal(userId, req.params.id as string);
    if (!assessment) return void res.status(404).json({ error: 'goal not found or assessment unavailable' });
    res.json(assessment);
  } catch (err) {
    console.error('[POST /review/goals/:id/assess]', err);
    res.status(502).json({ error: 'assessment failed' });
  }
});

/** DELETE /review/goals/:id — reject a goal. */
router.delete('/goals/:id', async (req: Request, res: Response) => {
  const userId = req.cadenceUserId!;
  try {
    await deleteGoal(userId, req.params.id as string);
    res.json({ ok: true });
  } catch (err) {
    console.error('[DELETE /review/goals]', err);
    res.status(500).json({ error: 'delete failed' });
  }
});

/** POST /review/goals — add a goal the AI missed. */
router.post('/goals', async (req: Request, res: Response) => {
  const userId = req.cadenceUserId!;
  try {
    const body = parseBody(createGoalBodySchema, req.body);
    // confirm:true → insert as CONFIRMED (Settings "manage" mode): a 'captured' goal is invisible
    // to replan and still subject to capture's merge pass, and a goal the user typed by hand in
    // Settings is neither a draft nor something the Broker gets to reword.
    const g = await insertGoal(userId, {
      title: body.title,
      area: body.area,
      type: body.type,
      measure: body.measure as Goal['measure'],
      status: body.confirm === true ? 'confirmed' : 'captured',
      source: 'manual',
    });
    res.json(g);
  } catch (err) {
    if (err instanceof BodyValidationError) return void res.status(400).json({ error: err.message });
    console.error('[POST /review/goals]', err);
    res.status(500).json({ error: 'add failed' });
  }
});

/** PATCH /review/equipment/:id — edit equipment. */
router.patch('/equipment/:id', async (req: Request, res: Response) => {
  const userId = req.cadenceUserId!;
  try {
    const body = parseBody(patchEquipmentBodySchema, req.body);
    await updateEquipment(userId, req.params.id as string, { name: body.name, category: body.category });
    res.json({ ok: true });
  } catch (err) {
    if (err instanceof BodyValidationError) return void res.status(400).json({ error: err.message });
    console.error('[PATCH /review/equipment]', err);
    res.status(500).json({ error: 'update failed' });
  }
});

/** DELETE /review/equipment/:id — reject equipment. */
router.delete('/equipment/:id', async (req: Request, res: Response) => {
  const userId = req.cadenceUserId!;
  try {
    await deleteEquipment(userId, req.params.id as string);
    res.json({ ok: true });
  } catch (err) {
    console.error('[DELETE /review/equipment]', err);
    res.status(500).json({ error: 'delete failed' });
  }
});

/** POST /review/equipment — add equipment. */
router.post('/equipment', async (req: Request, res: Response) => {
  const userId = req.cadenceUserId!;
  try {
    const body = parseBody(createEquipmentBodySchema, req.body);
    const e = await insertEquipment(userId, { name: body.name, category: body.category, owned: true });
    res.json(e);
  } catch (err) {
    if (err instanceof BodyValidationError) return void res.status(400).json({ error: err.message });
    console.error('[POST /review/equipment]', err);
    res.status(500).json({ error: 'add failed' });
  }
});

/** PATCH /review/profile — edit the user's name. */
router.patch('/profile', async (req: Request, res: Response) => {
  const userId = req.cadenceUserId!;
  try {
    const { name } = parseBody(patchProfileBodySchema, req.body);
    await setName(userId, name);
    res.json({ ok: true });
  } catch (err) {
    if (err instanceof BodyValidationError) return void res.status(400).json({ error: err.message });
    console.error('[PATCH /review/profile]', err);
    res.status(500).json({ error: 'update failed' });
  }
});

/** PATCH /review/baseline — edit "who I am": age/height/weight + what we work around. */
router.patch('/baseline', async (req: Request, res: Response) => {
  const userId = req.cadenceUserId!;
  try {
    const patch = parseBody(patchBaselineBodySchema, req.body);
    await mergeBaseline(userId, patch as Partial<Baseline>);
    res.json({ ok: true });
  } catch (err) {
    if (err instanceof BodyValidationError) return void res.status(400).json({ error: err.message });
    console.error('[PATCH /review/baseline]', err);
    res.status(500).json({ error: 'update failed' });
  }
});

export default router;
