import { Router, type Request, type Response } from 'express';
import { requireCadenceUser } from '../auth/middleware.ts';
import {
  deleteFood,
  getFood,
  insertFood,
  listFrequentFoods,
  listRecentFoods,
  searchFoods,
  updateFood,
} from '../repos/foods.ts';
import { BodyValidationError, parseBody } from '../validation/body.ts';
import { createFoodBodySchema, patchFoodBodySchema } from '../validation/food.ts';

const router = Router();
router.use(requireCadenceUser);

function limitFromQuery(raw: unknown, fallback = 20): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(50, Math.max(1, Math.trunc(n)));
}

/** GET /nutrition/foods/search?q=&limit= — own + shared, yours-first. Fast, no AI. */
router.get('/search', async (req: Request, res: Response) => {
  const userId = req.cadenceUserId!;
  const q = typeof req.query.q === 'string' ? req.query.q : '';
  try {
    res.json({ foods: await searchFoods(userId, q, limitFromQuery(req.query.limit)) });
  } catch (err) {
    console.error('[GET /nutrition/foods/search]', err);
    res.status(500).json({ error: 'failed to search foods' });
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

/** POST /nutrition/foods — create/save a food (deterministic; capture paths land later). */
router.post('/', async (req: Request, res: Response) => {
  const userId = req.cadenceUserId!;
  try {
    const body = parseBody(createFoodBodySchema, req.body);
    const food = await insertFood(userId, {
      name: body.name,
      brand: body.brand ?? null,
      source: body.source,
      off_id: body.off_id ?? null,
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
