import { Router, type Request, type Response } from 'express';
import { requireCadenceUser } from '../auth/middleware.ts';
import {
  clearTargets,
  getBaselineRead,
  getNutritionDay,
  getNutritionInsight,
  getNutritionSummary,
  getPlateAdvice,
  listRecentMeals,
  logMeal,
  patchMeal,
  previewMealParse,
  removeMeal,
  setEatbackPct,
  setTargets,
} from '../services/nutrition.ts';
import { readMealPhoto, logMealFromReading } from '../services/meal-photo-read.ts';
import { logWater } from '../services/water.ts';
import { mergeItems, reachBackToPin, renameItem } from '../services/meal-corrections.ts';
import { findNutritionLog } from '../repos/nutrition.ts';
import { enrichMeal } from '../services/meal-enrich.ts';
import { kickFoodSweep } from '../services/food-sweep.ts';
import {
  BodyValidationError,
  parseBody,
  logMealBodySchema,
  macroTargetsBodySchema,
  previewMealBodySchema,
  waterBodySchema,
  readPhotoBodySchema,
  logFromReadingBodySchema,
} from '../validation/body.ts';

const router = Router();
router.use(requireCadenceUser);

/** POST /nutrition/meals — words/photo (AI) or food_id / recipe_id (deterministic). */
router.post('/meals', async (req: Request, res: Response) => {
  const userId = req.cadenceUserId!;
  try {
    const body = parseBody(logMealBodySchema, req.body);
    res.json(
      await logMeal(userId, {
        text: body.text || undefined,
        meal: body.meal,
        photo: body.photo,
        food_id: body.food_id,
        recipe_id: body.recipe_id,
        serving_index: body.serving_index,
        quantity: body.quantity,
        items: body.items,
        parsed: body.parsed as Parameters<typeof logMeal>[1]['parsed'],
        date: body.date,
      }),
    );
  } catch (err) {
    if (err instanceof BodyValidationError) return void res.status(400).json({ error: err.message });
    const msg = err instanceof Error ? err.message : '';
    if (/invalid photo/.test(msg)) return void res.status(400).json({ error: msg });
    if (/food not found|recipe not found/.test(msg)) return void res.status(404).json({ error: msg });
    console.error('[POST /nutrition/meals]', err);
    res.status(500).json({ error: 'failed to log meal' });
  }
});

/**
 * Two-stage photo logging — split into two calls ON PURPOSE.
 *
 * The pipeline costs 40–70s end to end, and a minute of spinner is not a feature. Owner's fix, and
 * it is the right one: don't hide the wait, narrate it. "Any LLM message takes time; the boredom is
 * alleviated usually by seeing the stream of reasoning." The client rotates its own copy during
 * each call and shows the real reading in between.
 *
 * Two calls rather than SSE because the seam buys something a stream cannot: the user can CORRECT
 * the reading before any number is computed from it. That is the confirm the brand asks for
 * ("here's what I heard — did I get it right?"), arriving for free instead of bolted on.
 *
 * POST /nutrition/photo/read — step 1. Uploads the photo, returns PROSE. Writes no meal row, so a
 * read the user abandons leaves nothing behind.
 */
router.post('/photo/read', async (req: Request, res: Response) => {
  const userId = req.cadenceUserId!;
  try {
    const body = parseBody(readPhotoBodySchema, req.body);
    res.json(await readMealPhoto(userId, { photo: body.photo, caption: body.caption, date: body.date }));
  } catch (err) {
    if (err instanceof BodyValidationError) return void res.status(400).json({ error: err.message });
    const msg = err instanceof Error ? err.message : '';
    if (/invalid photo/.test(msg)) return void res.status(400).json({ error: msg });
    console.error('[POST /nutrition/photo/read]', err);
    res.status(500).json({ error: 'failed to read the photo' });
  }
});

/**
 * POST /nutrition/photo/log — step 2. The reading (possibly EDITED by the user) becomes numbers and
 * a row. `reading` may be empty: a failed or skipped step 1 must still be able to log the meal from
 * the caption, because a meal never vanishes because a model did.
 */
router.post('/photo/log', async (req: Request, res: Response) => {
  const userId = req.cadenceUserId!;
  try {
    const body = parseBody(logFromReadingBodySchema, req.body);
    res.json(
      await logMealFromReading(userId, {
        photo_ref: body.photo_ref,
        reading: body.reading,
        caption: body.caption,
        meal: body.meal,
        date: body.date,
      }),
    );
  } catch (err) {
    if (err instanceof BodyValidationError) return void res.status(400).json({ error: err.message });
    console.error('[POST /nutrition/photo/log]', err);
    res.status(500).json({ error: 'failed to log the meal' });
  }
});

/** POST /nutrition/water — one pour, ml. No confirm step: the stated amount IS the data. */
router.post('/water', async (req: Request, res: Response) => {
  const userId = req.cadenceUserId!;
  try {
    const body = parseBody(waterBodySchema, req.body);
    res.json(await logWater(userId, body.ml, body.date));
  } catch (err) {
    if (err instanceof BodyValidationError) return void res.status(400).json({ error: err.message });
    console.error('[POST /nutrition/water]', err);
    res.status(500).json({ error: 'failed to log water' });
  }
});

/**
 * POST /nutrition/meals/preview — parse the words into an itemized meal WITHOUT logging it.
 * The confirm-first read: the client renders items + estimates, and the user's confirm posts the
 * same payload back to /meals as `parsed`, which inserts it verbatim.
 */
router.post('/meals/preview', async (req: Request, res: Response) => {
  const userId = req.cadenceUserId!;
  try {
    const body = parseBody(previewMealBodySchema, req.body);
    res.json(await previewMealParse(userId, body.text, body.meal));
  } catch (err) {
    if (err instanceof BodyValidationError) return void res.status(400).json({ error: err.message });
    console.error('[POST /nutrition/meals/preview]', err);
    res.status(500).json({ error: 'failed to read that meal' });
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
    // Sunday-sweep piggyback (S3) — rides the day read like assessIfDue rides GET /plan; the
    // timezone is what anchors "Sunday" to the user's own week rather than the server's.
    kickFoodSweep(userId, req.header('X-Cadence-Timezone'));
    res.json(await getNutritionDay(userId, date));
  } catch (err) {
    console.error('[GET /nutrition/day]', err);
    res.status(500).json({ error: 'failed to build the day' });
  }
});

/**
 * GET /nutrition/insight?date=YYYY-MM-DD — Req 5 WS-I insight card payload.
 * Deterministic macro/pattern/variety copy grounded in day totals + Observe summary.
 */
router.get('/insight', async (req: Request, res: Response) => {
  const userId = req.cadenceUserId!;
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.date ?? '')) ? String(req.query.date) : undefined;
  try {
    res.json(await getNutritionInsight(userId, date));
  } catch (err) {
    console.error('[GET /nutrition/insight]', err);
    res.status(500).json({ error: 'failed to build insight' });
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
 * POST /nutrition/meals/:id/enrich — the slow lookup, after the meal is already safely on the day.
 *
 * The client fires this the moment a log lands carrying `flags.needs_enrich`, does not block on
 * it, and re-reads the day when it resolves. It is a REQUEST rather than post-response work
 * because this API has no `waitUntil` on Vercel — anything started after the response can be
 * frozen when the function returns, which would leave the meal permanently half-priced with
 * nothing to say so.
 *
 * Safe to call twice (it marks itself done), and safe never to call: the meal already carries the
 * parse's numbers, which is precisely what it had before any of this existed.
 */
router.post('/meals/:id/enrich', async (req: Request, res: Response) => {
  const userId = req.cadenceUserId!;
  try {
    const out = await enrichMeal(userId, String(req.params.id));
    if (!out.meal) return void res.status(404).json({ error: 'meal not found' });
    res.json({ meal: out.meal, improved: out.improved });
  } catch (err) {
    console.error('[POST /nutrition/meals/:id/enrich]', err);
    // The meal is untouched and still correct — say so rather than implying the log is damaged.
    res.status(500).json({ error: 'could not improve those numbers just now' });
  }
});

/**
 * PATCH /nutrition/meals/:id/items — the repairs a logged meal actually needs.
 *
 * `rename` keeps every number and fixes only the label, on the log and — when the item is backed
 * by a food this user pinned — on that food too, so the wrong name stops resolving tomorrow.
 * `merge` folds one item into another, nutrients included. `drop` removes one that never happened.
 * All three recompute the meal's totals from the surviving items on the way out.
 */
router.patch('/meals/:id/items', async (req: Request, res: Response) => {
  const userId = req.cadenceUserId!;
  const logId = String(req.params.id);
  try {
    const meal = await findNutritionLog(userId, logId);
    if (!meal) return void res.status(404).json({ error: 'meal not found' });

    const op = String(req.body?.op ?? '');
    const index = Number(req.body?.index);
    if (!Number.isInteger(index) || index < 0 || index >= meal.items.length) {
      return void res.status(400).json({ error: 'index is not an item on this meal' });
    }

    let items = meal.items;
    let pinRenamed = false;
    if (op === 'rename') {
      const name = String(req.body?.name ?? '').trim();
      if (!name) return void res.status(400).json({ error: 'a rename needs a name' });
      const brand = req.body?.brand === undefined ? undefined : req.body.brand;
      items = renameItem(items, index, name, brand);
      pinRenamed = await reachBackToPin(userId, meal.items[index], name, brand);
    } else if (op === 'merge') {
      const into = Number(req.body?.into);
      if (!Number.isInteger(into) || into < 0 || into >= items.length || into === index) {
        return void res.status(400).json({ error: 'merge needs a different item to merge into' });
      }
      items = mergeItems(items, index, into);
    } else if (op === 'drop') {
      items = items.filter((_, i) => i !== index);
    } else {
      return void res.status(400).json({ error: 'op must be rename, merge or drop' });
    }

    /**
     * Nothing left on the meal means the meal did not happen — so it comes off the day rather than
     * lingering as an empty husk reading "0 items · 0 kcal". Taking the last item off IS saying the
     * meal was not eaten; making the user then find a second, differently-worded delete would be
     * asking them to say it twice.
     */
    if (items.length === 0) {
      await removeMeal(userId, logId);
      return void res.json({ meal_removed: true, pin_renamed: pinRenamed });
    }

    const row = await patchMeal(userId, logId, { items, confirm: true });
    if (!row) return void res.status(404).json({ error: 'meal not found' });
    res.json({ ...row, pin_renamed: pinRenamed });
  } catch (err) {
    console.error('[PATCH /nutrition/meals/:id/items]', err);
    res.status(500).json({ error: 'failed to correct meal' });
  }
});

/**
 * DELETE /nutrition/meals/:id — take a meal back off the day.
 *
 * For a meal that did not happen: a mis-tap, a double log, a parse that invented a food. A meal
 * that DID happen and was written down wrong is a PATCH, not this.
 */
router.delete('/meals/:id', async (req: Request, res: Response) => {
  const userId = req.cadenceUserId!;
  try {
    const ok = await removeMeal(userId, String(req.params.id));
    if (!ok) return void res.status(404).json({ error: 'meal not found' });
    res.json({ ok: true });
  } catch (err) {
    console.error('[DELETE /nutrition/meals/:id]', err);
    res.status(500).json({ error: 'failed to remove meal' });
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

/** POST /nutrition/plate-advice — pre-eat read on a plate PHOTO or a described meal (no log). */
router.post('/plate-advice', async (req: Request, res: Response) => {
  const userId = req.cadenceUserId!;
  const body = (req.body ?? {}) as { photo?: unknown; meal?: unknown };
  const photo = typeof body.photo === 'string' && body.photo ? body.photo : undefined;
  const meal = typeof body.meal === 'string' && body.meal.trim() ? body.meal : undefined;
  if (!photo && !meal) return void res.status(400).json({ error: 'photo or meal required' });
  try {
    res.json(await getPlateAdvice(userId, { photo, meal }));
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
