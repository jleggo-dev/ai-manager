import { Router, type Request, type Response } from 'express';
import { requireCadenceUser } from '../auth/middleware.ts';
import {
  deleteFood,
  getFood,
  getFoodByOffId,
  insertFood,
  listFrequentFoods,
  listRecentFoods,
  updateFood,
  upsertSharedOffFood,
} from '../repos/foods.ts';
import { estimateFood, identifyFood, parseNutritionLabel } from '../services/food-capture.ts';
import { importUsdaFood, searchFoodsWithUsda } from '../services/food-sources/usda-enrich.ts';
import { isUsdaConfigured, searchUsdaFoods, UsdaConfigError, UsdaHttpError } from '../services/food-sources/usda.ts';
import { resolveFoods } from '../services/food-resolver.ts';
import { isMeal } from '../services/nutrition-parse.ts';
import { usualAtSlot } from '../services/food-usual-slot.ts';
import { BodyValidationError, parseBody } from '../validation/body.ts';
import {
  createFoodBodySchema,
  estimateFoodBodySchema,
  identifyFoodBodySchema,
  importOffFoodBodySchema,
  importUsdaBodySchema,
  parseLabelBodySchema,
  patchFoodBodySchema,
  resolveFoodBodySchema,
} from '../validation/food.ts';

const router = Router();
router.use(requireCadenceUser);

function limitFromQuery(raw: unknown, fallback = 20): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(50, Math.max(1, Math.trunc(n)));
}

function photoErrorStatus(err: unknown): number | null {
  const msg = err instanceof Error ? err.message : '';
  if (/invalid photo/.test(msg)) return 400;
  return null;
}

/** GET /nutrition/foods/search?q=&limit= — own + shared, yours-first; USDA on cache-miss. */
router.get('/search', async (req: Request, res: Response) => {
  const userId = req.cadenceUserId!;
  const q = typeof req.query.q === 'string' ? req.query.q : '';
  try {
    res.json({ foods: await searchFoodsWithUsda(userId, q, limitFromQuery(req.query.limit)) });
  } catch (err) {
    console.error('[GET /nutrition/foods/search]', err);
    res.status(500).json({ error: 'failed to search foods' });
  }
});

/**
 * GET /nutrition/foods/usda/search?q= — external USDA search (auth'd). Does not cache by itself;
 * use POST …/usda/import to persist. Prefer /search which enriches + caches on miss.
 */
router.get('/usda/search', async (req: Request, res: Response) => {
  const q = typeof req.query.q === 'string' ? req.query.q : '';
  try {
    if (!isUsdaConfigured()) {
      return void res.status(503).json({ error: 'USDA FoodData Central is not configured' });
    }
    const foods = await searchUsdaFoods(q, { pageSize: limitFromQuery(req.query.limit, 5) });
    res.json({ foods });
  } catch (err) {
    if (err instanceof UsdaConfigError) {
      return void res.status(503).json({ error: 'USDA FoodData Central is not configured' });
    }
    if (err instanceof UsdaHttpError && err.status === 429) {
      return void res.status(429).json({ error: 'USDA rate limit exceeded — try again shortly' });
    }
    console.error('[GET /nutrition/foods/usda/search]', err);
    res.status(502).json({ error: 'failed to search USDA foods' });
  }
});

/** POST /nutrition/foods/usda/import — fetch by fdc_id and cache as shared food (auth'd). */
router.post('/usda/import', async (req: Request, res: Response) => {
  try {
    const body = parseBody(importUsdaBodySchema, req.body);
    const food = await importUsdaFood(body.fdc_id);
    res.status(201).json(food);
  } catch (err) {
    if (err instanceof BodyValidationError) return void res.status(400).json({ error: err.message });
    if (err instanceof UsdaConfigError) {
      return void res.status(503).json({ error: 'USDA FoodData Central is not configured' });
    }
    if (err instanceof UsdaHttpError && err.status === 429) {
      return void res.status(429).json({ error: 'USDA rate limit exceeded — try again shortly' });
    }
    if (err instanceof UsdaHttpError && err.status === 404) {
      return void res.status(404).json({ error: 'USDA food not found' });
    }
    console.error('[POST /nutrition/foods/usda/import]', err);
    res.status(502).json({ error: 'failed to import USDA food' });
  }
});

/** GET /nutrition/foods/recents — empty-search default list (food_usage). */
router.get('/recents', async (req: Request, res: Response) => {
  const userId = req.cadenceUserId!;
  try {
    res.json({ foods: await listRecentFoods(userId, limitFromQuery(req.query.limit)) });
  } catch (err) {
    console.error('[GET /nutrition/foods/recents]', err);
    res.status(500).json({ error: 'failed to list recent foods' });
  }
});

/** GET /nutrition/foods/frequents — empty-search frequents list (food_usage). */
router.get('/frequents', async (req: Request, res: Response) => {
  const userId = req.cadenceUserId!;
  try {
    res.json({ foods: await listFrequentFoods(userId, limitFromQuery(req.query.limit)) });
  } catch (err) {
    console.error('[GET /nutrition/foods/frequents]', err);
    res.status(500).json({ error: 'failed to list frequent foods' });
  }
});

/**
 * GET /nutrition/foods/usual?meal=&limit= — what they usually have AT THAT SLOT, counted.
 * Recents are day-wide; this is the quick-add sheet's slot-aware list (design 05a).
 */
router.get('/usual', async (req: Request, res: Response) => {
  const userId = req.cadenceUserId!;
  const meal = req.query.meal;
  if (!isMeal(meal)) return res.status(400).json({ error: 'meal must be a meal kind' });
  try {
    res.json({ items: await usualAtSlot(userId, meal, limitFromQuery(req.query.limit, 6)) });
  } catch (err) {
    console.error('[GET /nutrition/foods/usual]', err);
    res.status(500).json({ error: 'failed to list usual foods' });
  }
});

/** POST /nutrition/foods/parse-label — label photo → unsaved Food candidate (AIM vision). */
router.post('/parse-label', async (req: Request, res: Response) => {
  const userId = req.cadenceUserId!;
  try {
    const body = parseBody(parseLabelBodySchema, req.body);
    res.json(await parseNutritionLabel(userId, body));
  } catch (err) {
    if (err instanceof BodyValidationError) return void res.status(400).json({ error: err.message });
    const photoStatus = photoErrorStatus(err);
    if (photoStatus) return void res.status(photoStatus).json({ error: (err as Error).message });
    console.error('[POST /nutrition/foods/parse-label]', err);
    res.status(502).json({ error: 'failed to parse nutrition label' });
  }
});

/** POST /nutrition/foods/estimate — describe text → unsaved Food candidate (AIM). */
router.post('/estimate', async (req: Request, res: Response) => {
  const userId = req.cadenceUserId!;
  try {
    const body = parseBody(estimateFoodBodySchema, req.body);
    res.json({ candidate: await estimateFood(userId, body.text) });
  } catch (err) {
    if (err instanceof BodyValidationError) return void res.status(400).json({ error: err.message });
    console.error('[POST /nutrition/foods/estimate]', err);
    res.status(502).json({ error: 'failed to estimate food' });
  }
});

/** POST /nutrition/foods/identify — front-of-pack photo → name + brand (AIM vision). */
router.post('/identify', async (req: Request, res: Response) => {
  const userId = req.cadenceUserId!;
  try {
    const body = parseBody(identifyFoodBodySchema, req.body);
    res.json(await identifyFood(userId, body));
  } catch (err) {
    if (err instanceof BodyValidationError) return void res.status(400).json({ error: err.message });
    const photoStatus = photoErrorStatus(err);
    if (photoStatus) return void res.status(photoStatus).json({ error: (err as Error).message });
    console.error('[POST /nutrition/foods/identify]', err);
    res.status(502).json({ error: 'failed to identify food' });
  }
});

/**
 * POST /nutrition/foods/resolve — deterministic resolve (WS-R).
 * Ranked candidates + optional preselected (serving + inferred qty). "new" → capture hooks.
 * Confirm → POST /nutrition/meals { food_id, serving_index, quantity }.
 */
router.post('/resolve', async (req: Request, res: Response) => {
  const userId = req.cadenceUserId!;
  try {
    const body = parseBody(resolveFoodBodySchema, req.body ?? {});
    const result = await resolveFoods(userId, {
      text: body.text ?? '',
      ...(body.photo ? { photo: body.photo } : {}),
    });
    res.json(result);
  } catch (err) {
    if (err instanceof BodyValidationError) return void res.status(400).json({ error: err.message });
    console.error('[POST /nutrition/foods/resolve]', err);
    res.status(500).json({ error: 'failed to resolve food' });
  }
});

/**
 * GET /nutrition/foods/by-off/:offId — shared OFF cache hit (prefer before browser → OFF).
 * Must stay above /:id.
 */
router.get('/by-off/:offId', async (req: Request, res: Response) => {
  try {
    const offId = String(req.params.offId ?? '').replace(/\D/g, '');
    if (offId.length < 8 || offId.length > 14) {
      return void res.status(400).json({ error: 'off_id must be an 8–14 digit barcode' });
    }
    const food = await getFoodByOffId(offId);
    if (!food) return void res.status(404).json({ error: 'food not found' });
    res.json(food);
  } catch (err) {
    console.error('[GET /nutrition/foods/by-off/:offId]', err);
    res.status(500).json({ error: 'failed to load off food' });
  }
});

/**
 * POST /nutrition/foods/import-off — upsert shared Food from a browser-mapped OFF product.
 * Does NOT call Open Food Facts (avoids shared egress ban risk). Auth'd; validates shape.
 */
router.post('/import-off', async (req: Request, res: Response) => {
  try {
    const body = parseBody(importOffFoodBodySchema, req.body);
    const { food, cached } = await upsertSharedOffFood({
      name: body.name,
      brand: body.brand ?? null,
      off_id: body.off_id,
      base_unit: body.base_unit,
      macros_per_base: body.macros_per_base,
      servings: body.servings,
      default_serving: body.default_serving,
      confidence: body.confidence ?? null,
      photo_ref: body.photo_ref ?? null,
    });
    console.info('[POST /nutrition/foods/import-off]', {
      off_id: body.off_id,
      food_id: food.food_id,
      cached,
    });
    res.status(cached ? 200 : 201).json({ food, cached });
  } catch (err) {
    if (err instanceof BodyValidationError) return void res.status(400).json({ error: err.message });
    console.error('[POST /nutrition/foods/import-off]', err);
    res.status(500).json({ error: 'failed to import off food' });
  }
});

/** GET /nutrition/foods/:id — one food the user can see. */
router.get('/:id', async (req: Request, res: Response) => {
  const userId = req.cadenceUserId!;
  try {
    const food = await getFood(userId, String(req.params.id));
    if (!food) return void res.status(404).json({ error: 'food not found' });
    res.json(food);
  } catch (err) {
    console.error('[GET /nutrition/foods/:id]', err);
    res.status(500).json({ error: 'failed to load food' });
  }
});

/** POST /nutrition/foods — create/save a food (from capture confirm or manual). */
router.post('/', async (req: Request, res: Response) => {
  const userId = req.cadenceUserId!;
  try {
    const body = parseBody(createFoodBodySchema, req.body);
    const food = await insertFood(userId, {
      name: body.name,
      brand: body.brand ?? null,
      source: body.source,
      off_id: body.off_id ?? null,
      fdc_id: body.fdc_id ?? null,
      base_unit: body.base_unit,
      macros_per_base: body.macros_per_base,
      servings: body.servings,
      default_serving: body.default_serving,
      confidence: body.confidence ?? null,
      photo_ref: body.photo_ref ?? null,
      visibility: body.visibility,
    });
    res.status(201).json(food);
  } catch (err) {
    if (err instanceof BodyValidationError) return void res.status(400).json({ error: err.message });
    console.error('[POST /nutrition/foods]', err);
    res.status(500).json({ error: 'failed to create food' });
  }
});

/** PATCH /nutrition/foods/:id — edit a food the user owns. */
router.patch('/:id', async (req: Request, res: Response) => {
  const userId = req.cadenceUserId!;
  try {
    const body = parseBody(patchFoodBodySchema, req.body);
    const food = await updateFood(userId, String(req.params.id), body);
    if (!food) return void res.status(404).json({ error: 'food not found' });
    res.json(food);
  } catch (err) {
    if (err instanceof BodyValidationError) return void res.status(400).json({ error: err.message });
    console.error('[PATCH /nutrition/foods/:id]', err);
    res.status(500).json({ error: 'failed to update food' });
  }
});

/** DELETE /nutrition/foods/:id — remove a food the user owns. */
router.delete('/:id', async (req: Request, res: Response) => {
  const userId = req.cadenceUserId!;
  try {
    const ok = await deleteFood(userId, String(req.params.id));
    if (!ok) return void res.status(404).json({ error: 'food not found' });
    res.json({ ok: true });
  } catch (err) {
    console.error('[DELETE /nutrition/foods/:id]', err);
    res.status(500).json({ error: 'failed to delete food' });
  }
});

export default router;
