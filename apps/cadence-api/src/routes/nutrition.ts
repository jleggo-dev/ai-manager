import { Router, type Request, type Response } from 'express';
import { requireCadenceUser } from '../auth/middleware.ts';
import { logMeal, getNutritionSummary, listRecentMeals } from '../services/nutrition.ts';
import type { MealKind } from '@cadence/shared';

const router = Router();
router.use(requireCadenceUser);

const MEALS: MealKind[] = ['breakfast', 'lunch', 'dinner', 'snack', 'drink', 'other'];

/** POST /nutrition/meals — record one meal in the user's words (Observe phase; never judged). */
router.post('/meals', async (req: Request, res: Response) => {
  const userId = req.cadenceUserId!;
  const text = typeof req.body?.text === 'string' ? req.body.text.trim() : '';
  const meal = MEALS.includes(req.body?.meal) ? (req.body.meal as MealKind) : undefined;
  if (!text) return void res.status(400).json({ error: 'text required' });
  try {
    res.json(await logMeal(userId, { text, meal }));
  } catch (err) {
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

export default router;
