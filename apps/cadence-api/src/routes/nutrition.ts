import { Router, type Request, type Response } from 'express';
import { requireCadenceUser } from '../auth/middleware.ts';
import {
  logMeal,
  getNutritionSummary,
  listRecentMeals,
  getBaselineRead,
  getNutritionDay,
  patchMeal,
  setTargets,
  clearTargets,
} from '../services/nutrition.ts';
import type { MealKind } from '@cadence/shared';

const router = Router();
router.use(requireCadenceUser);

const MEALS: MealKind[] = ['breakfast', 'lunch', 'dinner', 'snack', 'drink', 'other'];

/** POST /nutrition/meals — one meal, in their words and/or a photo (Observe phase; never judged). */
router.post('/meals', async (req: Request, res: Response) => {
  const userId = req.cadenceUserId!;
  const text = typeof req.body?.text === 'string' ? req.body.text.trim() : '';
  const meal = MEALS.includes(req.body?.meal) ? (req.body.meal as MealKind) : undefined;
  const photo =
    typeof req.body?.photo === 'string' && req.body.photo.startsWith('data:image/') ? req.body.photo : undefined;
  if (!text && !photo) return void res.status(400).json({ error: 'a meal needs words or a photo' });
  try {
    res.json(await logMeal(userId, { text: text || undefined, meal, photo }));
  } catch (err) {
    const msg = err instanceof Error ? err.message : '';
    if (/invalid photo/.test(msg)) return void res.status(400).json({ error: msg });
    console.error('[POST /nutrition/meals]', err);
    res.status(500).json({ error: 'failed to log meal' });
  }
});

/** GET /nutrition/recent?days=7 — meals newest-first (the sheet's today/this-week list). */
router.get('/recent', async (req: Request, res: Response) => {
  const userId = req.cadenceUserId!;
  const days = Math.min(31, Math.max(1, Number(req.query.days) || 7));
  try {
    res.json({ meals: await listRecentMeals(userId, days) });
  } catch (err) {
    console.error('[GET /nutrition/recent]', err);
    res.status(500).json({ error: 'failed to list meals' });
  }
});

/** GET /nutrition/summary?days=7 — the deterministic Observe-phase read (phase signal included). */
router.get('/summary', async (req: Request, res: Response) => {
  const userId = req.cadenceUserId!;
  const days = Math.min(31, Math.max(1, Number(req.query.days) || 7));
  try {
    res.json(await getNutritionSummary(userId, days));
  } catch (err) {
    console.error('[GET /nutrition/summary]', err);
    res.status(500).json({ error: 'failed to summarize' });
  }
});

/** GET /nutrition/day?date=YYYY-MM-DD — one day's meals + deterministic totals (confirmed vs
 *  provisional) + targets/left when the user has confirmed targets (N3). Defaults to today. */
router.get('/day', async (req: Request, res: Response) => {
  const userId = req.cadenceUserId!;
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.date ?? '')) ? String(req.query.date) : undefined;
  try {
    res.json(await getNutritionDay(userId, date));
  } catch (err) {
    console.error('[GET /nutrition/day]', err);
    res.status(500).json({ error: 'failed to build the day' });
  }
});

/** PATCH /nutrition/meals/:id — tap-to-confirm/correct. The user's word wins: any correction
 *  (or a bare confirm) graduates the row into the day's totals. */
router.patch('/meals/:id', async (req: Request, res: Response) => {
  const userId = req.cadenceUserId!;
  try {
    const row = await patchMeal(userId, String(req.params.id), {
      meal: req.body?.meal,
      items: req.body?.items,
      macros: req.body?.macros,
      confirm: req.body?.confirm === true,
    });
    if (!row) return void res.status(404).json({ error: 'meal not found (or nothing to change)' });
    res.json(row);
  } catch (err) {
    console.error('[PATCH /nutrition/meals/:id]', err);
    res.status(500).json({ error: 'failed to update meal' });
  }
});

/**
 * POST /nutrition/baseline — the Baseline moment: the coach's pattern read + ONE gradual change.
 * Deterministically gated on 7+ observed days (200 with ready:false below the gate — the UI shows
 * progress, not an error). POST because it runs a coach-tier LLM call.
 */
router.post('/baseline', async (req: Request, res: Response) => {
  const userId = req.cadenceUserId!;
  try {
    res.json(await getBaselineRead(userId));
  } catch (err) {
    console.error('[POST /nutrition/baseline]', err);
    res.status(500).json({ error: 'failed to build the read' });
  }
});

/** PUT /nutrition/targets — confirm/edit daily macro targets (the user's tap; unlocks "left"). */
router.put('/targets', async (req: Request, res: Response) => {
  const userId = req.cadenceUserId!;
  try {
    res.json({ targets: await setTargets(userId, req.body) });
  } catch (err) {
    const msg = err instanceof Error ? err.message : '';
    if (/no valid targets/.test(msg)) return void res.status(400).json({ error: 'no valid targets' });
    console.error('[PUT /nutrition/targets]', err);
    res.status(500).json({ error: 'failed to set targets' });
  }
});

/** DELETE /nutrition/targets — remove targets (back to observe-style; no rings, no "left"). */
router.delete('/targets', async (req: Request, res: Response) => {
  const userId = req.cadenceUserId!;
  try {
    await clearTargets(userId);
    res.json({ ok: true });
  } catch (err) {
    console.error('[DELETE /nutrition/targets]', err);
    res.status(500).json({ error: 'failed to clear targets' });
  }
});

export default router;
