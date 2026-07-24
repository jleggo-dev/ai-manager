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
  setEatbackPct,
  getPlateAdvice,
} from '../services/nutrition.ts';
import { BodyValidationError, parseBody, logMealBodySchema, macroTargetsBodySchema } from '../validation/body.ts';

const router = Router();
router.use(requireCadenceUser);

/** POST /nutrition/meals — one meal, in their words and/or a photo (Observe phase; never judged). */
router.post('/meals', async (req: Request, res: Response) => {
  const userId = req.cadenceUserId!;
  try {
    const body = parseBody(logMealBodySchema, req.body);
    res.json(
      await logMeal(userId, {
        text: body.text || undefined,
        meal: body.meal,
        photo: body.photo,
      }),
    );
  } catch (err) {
    if (err instanceof BodyValidationError) return void res.status(400).json({ error: err.message });
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
    const body = parseBody(macroTargetsBodySchema, req.body);
    res.json({ targets: await setTargets(userId, body) });
  } catch (err) {
    if (err instanceof BodyValidationError) return void res.status(400).json({ error: err.message });
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

/** POST /nutrition/plate-advice — pre-eat read on a plate photo (advice only, no log). */
router.post('/plate-advice', async (req: Request, res: Response) => {
  const userId = req.cadenceUserId!;
  const photo = (req.body as { photo?: unknown })?.photo;
  if (typeof photo !== 'string' || !photo) return void res.status(400).json({ error: 'photo required' });
  try {
    res.json(await getPlateAdvice(userId, photo));
  } catch (err) {
    console.error('[POST /nutrition/plate-advice]', err);
    res.status(502).json({ error: 'could not read the plate' });
  }
});

/** PATCH /nutrition/eatback — set the net-calorie eat-back % (0–100; how much exercise burn to eat back). */
router.patch('/eatback', async (req: Request, res: Response) => {
  const userId = req.cadenceUserId!;
  const pct = Number((req.body as { pct?: unknown })?.pct);
  if (!Number.isFinite(pct)) return void res.status(400).json({ error: 'pct must be a number 0-100' });
  try {
    res.json({ eatback_pct: await setEatbackPct(userId, pct) });
  } catch (err) {
    console.error('[PATCH /nutrition/eatback]', err);
    res.status(500).json({ error: 'failed to set eat-back' });
  }
});

export default router;
