import { Router, type Request, type Response } from 'express';
import { requireCadenceUser } from '../auth/middleware.ts';
import { logMeal, getNutritionSummary, listRecentMeals, getBaselineRead } from '../services/nutrition.ts';
import type { MealKind } from '@cadence/shared';

const router = Router();
router.use(requireCadenceUser);

const MEALS: MealKind[] = ['breakfast', 'lunch', 'dinner', 'snack', 'drink', 'other'];

/** POST /nutrition/meals — one meal, in their words and/or a photo (Observe phase; never judged). */
router.post('/meals', async (req: Request, res: Response) => {
  const userId = req.cadenceUserId!;
  const text = typeof req.body?.text === 'string' ? req.body.text.trim() : '';
  const meal = MEALS.includes(req.body?.meal) ? (req.body.meal as MealKind) : undefined;
  const photo = typeof req.body?.photo === 'string' && req.body.photo.startsWith('data:image/') ? req.body.photo : undefined;
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

export default router;
